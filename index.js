// dsh-freereply-ui
// Copyright 2026 蝠羽科技 (fuyu-technology)  —  https://github.com/fuyu-technology
//
// Licensed under the Apache License, Version 2.0 (the "License");
// you may not use this file except in compliance with the License.
// You may obtain a copy of the License at
//
//     http://www.apache.org/licenses/LICENSE-2.0
//
// Unless required by applicable law or agreed to in writing, software
// distributed under the License is distributed on an "AS IS" BASIS,
// WITHOUT WARRANTIES OR CONDITIONS OF ANY KIND, either express or implied.
// See the License for the specific language governing permissions and
// limitations under the License.
//
// 允许二次修改与再分发，但必须保留上述署名与版权声明，不得删除或改写。
// 详见 LICENSE 与 NOTICE。
//

// dsh-freereply-ui · 宿主侧
//
// 职责：把「免 token 自动回复」的规则表暴露成 HTTP API，供设置页里的面板读写。
//
// 核心概念
// --------
// 「免 token 自动回复」= 命中规则时，**桥接直接把预设话术发出去**，
// 完全不经过 DSH / LLM，因此**不消耗任何 token**。
//
// 数据落在 qq-bridge 的 config.json 里（键名 `freeReply`），由桥接自己读：
//   freeReply: {
//     enabled: true,                 // 总开关
//     defaultReply: '……',           // 没命中具体规则时的兜底话术
//     groups:   { '123456789': { enabled, reply, keywords: [...] } },
//     privates: { '123456789': { enabled, reply, keywords: [...] } }
//   }
//
// 为什么数据不进 DSH settings 命名空间？
//   DSH 的 settings 只能存标量/简单结构（schemastery schema），而这里要存
//   「群号 → 规则」的动态表；而且这份数据真正的消费者是 **qq-bridge 进程**，
//   不是 DSH。放在 config.json 里，桥接重启即生效、桥接自己就是唯一权威。
//
// 为什么插件不直接算路径？
//   qq-bridge 与本插件**不在同一棵目录树**（插件在 ~/.dsh/plugins/ 下，
//   桥接在 D:\大肥鱼\qq-bridge\ 下），必须用绝对路径。
//   绝对路径可用 QQ_BRIDGE_DIR 覆盖，方便搬到别的机器上。

import fs from 'node:fs'
import path from 'node:path'
import crypto from 'node:crypto'
import { fileURLToPath } from 'node:url'

const NS = 'dsh-freereply-ui'
const API_BASE = '/dsh-freereply'

const HERE = path.dirname(fileURLToPath(import.meta.url))
// qq-bridge 的实际位置。绝对路径，不能用 ../.. 推算（会算到 ~/.dsh 底下去）。
const BRIDGE_DIR = process.env.QQ_BRIDGE_DIR || 'D:\\大肥鱼\\qq-bridge'
const CONFIG_FILE = path.join(BRIDGE_DIR, 'config.json')

// 规则条目的字段上限（防止有人往 config.json 里塞几 MB 的东西把桥接拖死）
const MAX_RULES_PER_KIND = 200
const MAX_REPLY_CHARS = 2000
const MAX_KEYWORDS = 50
const MAX_KEYWORD_CHARS = 100

/**
 * 读 config.json，并保证拿到一个**可安全改写的普通对象**。
 *
 * 宁可抛错也不回写：顶层不是对象时回写会把整份配置替换掉，
 * 用户的白名单、令牌、模型配置全被抹掉。
 */
function readConfigObject() {
  let raw
  try {
    raw = fs.readFileSync(CONFIG_FILE, 'utf8')
  } catch (error) {
    throw new Error(`读不到 ${CONFIG_FILE}：${error?.message ?? error}`)
  }
  const parsed = JSON.parse(String(raw).replace(/^\uFEFF/, ''))
  if (!parsed || typeof parsed !== 'object' || Array.isArray(parsed)) {
    const kind = parsed === null ? 'null' : Array.isArray(parsed) ? '数组' : typeof parsed
    throw new Error(`config.json 顶层不是对象（实际是 ${kind}），已拒绝改写以免覆盖整份配置`)
  }
  return parsed
}

/**
 * 原子替换：先写唯一临时文件再 rename。
 * Windows 上 rename 覆盖「正被别人打开」的目标会抛 EPERM（Defender / 编辑器 /
 * 资源管理器预览都可能），所以退避重试几次。
 */
function renameWithRetry(from, to, attempts = 4) {
  let lastError
  for (let i = 0; i < attempts; i += 1) {
    try {
      fs.renameSync(from, to)
      return
    } catch (error) {
      lastError = error
      if (error?.code !== 'EPERM' && error?.code !== 'EBUSY' && error?.code !== 'EACCES') throw error
      try { Atomics.wait(new Int32Array(new SharedArrayBuffer(4)), 0, 0, 40 * (i + 1)) } catch {}
    }
  }
  throw lastError
}

/** 原子写 JSON（**绝不写 BOM**：DSH profile 的 package.json 带 BOM 会让 DSH 启动即崩） */
function atomicWriteJson(file, obj) {
  fs.mkdirSync(path.dirname(file), { recursive: true })
  const tmp = `${file}.${process.pid}.${crypto.randomBytes(6).toString('hex')}.tmp`
  try {
    fs.writeFileSync(tmp, JSON.stringify(obj, null, 2) + '\n', { encoding: 'utf8', mode: 0o600 })
    renameWithRetry(tmp, file)
  } catch (error) {
    try { fs.unlinkSync(tmp) } catch {}
    throw error
  }
}

/** 只接受正整数 QQ 号 / 群号 */
function normalizeId(value) {
  const raw = String(value ?? '').trim()
  if (!/^\d+$/.test(raw)) return null
  const n = Number(raw)
  if (!Number.isSafeInteger(n) || n <= 0) return null
  return String(n)
}

/** 归一化一条规则 */
function normalizeRule(input) {
  const out = { enabled: true, reply: '', keywords: [] }
  if (!input || typeof input !== 'object') return out
  out.enabled = input.enabled !== false
  out.reply = String(input.reply ?? '').trim().slice(0, MAX_REPLY_CHARS)
  const kws = Array.isArray(input.keywords) ? input.keywords : []
  out.keywords = [...new Set(
    kws
      .map((k) => String(k ?? '').trim())
      .filter((k) => k.length > 0)
      .map((k) => k.slice(0, MAX_KEYWORD_CHARS))
  )].slice(0, MAX_KEYWORDS)
  return out
}

/** 归一化整张规则表 */
function normalizeTable(input) {
  const table = {}
  if (!input || typeof input !== 'object' || Array.isArray(input)) return table
  const entries = Object.entries(input).slice(0, MAX_RULES_PER_KIND)
  for (const [rawId, rawRule] of entries) {
    const id = normalizeId(rawId)
    if (!id) continue
    table[id] = normalizeRule(rawRule)
  }
  return table
}

/** 归一化整个 freeReply 节点 */
function normalizeFreeReply(input) {
  const src = input && typeof input === 'object' && !Array.isArray(input) ? input : {}
  return {
    enabled: src.enabled !== false,
    defaultReply: String(src.defaultReply ?? '').trim().slice(0, MAX_REPLY_CHARS),
    groups: normalizeTable(src.groups),
    privates: normalizeTable(src.privates)
  }
}

/** 读当前规则（已归一化） */
function loadFreeReply() {
  const file = readConfigObject()
  return normalizeFreeReply(file.freeReply)
}

/** 写回规则：读整份 config → 改 freeReply 节点 → 原子写回 */
function saveFreeReply(next) {
  const file = readConfigObject()
  file.freeReply = normalizeFreeReply(next)
  atomicWriteJson(CONFIG_FILE, file)
  return file.freeReply
}

/** 统计信息（给面板显示） */
function buildSummary(rules) {
  const count = (t) => Object.keys(t || {}).length
  const enabled = (t) => Object.values(t || {}).filter((r) => r?.enabled).length
  return {
    groups: count(rules.groups),
    groupsEnabled: enabled(rules.groups),
    privates: count(rules.privates),
    privatesEnabled: enabled(rules.privates),
    total: count(rules.groups) + count(rules.privates)
  }
}

function sendJson(res, code, obj) {
  res.writeHead(code, { 'content-type': 'application/json; charset=utf-8', 'cache-control': 'no-store' })
  res.end(JSON.stringify(obj))
}

function readBody(req) {
  return new Promise((resolve) => {
    let buf = ''
    req.on('data', (c) => { buf += c; if (buf.length > 2e6) req.destroy() })
    req.on('end', () => { try { resolve(JSON.parse(buf || '{}')) } catch { resolve({}) } })
    req.on('error', () => resolve({}))
  })
}

/**
 * 校验一次提交。
 *
 * 提交体形态：
 *   { enabled, defaultReply, groups: { id: {enabled, reply, keywords} }, privates: {...} }
 * 非法 ID 直接 400 而不是静默丢弃，否则用户会以为规则存上了其实没有。
 */
function validatePayload(body) {
  const errors = []
  const next = {
    enabled: body.enabled !== false,
    defaultReply: String(body.defaultReply ?? '').trim(),
    privates: {},
    groups: {}
  }
  if (next.defaultReply.length > MAX_REPLY_CHARS) {
    errors.push(`兜底话术超过 ${MAX_REPLY_CHARS} 字`)
  }
  for (const [kind, field] of [['private', 'privates'], ['group', 'groups']]) {
    const raw = body[field]
    if (raw === undefined || raw === null) continue
    if (typeof raw !== 'object' || Array.isArray(raw)) {
      errors.push(`${field} 必须是一个对象（形如 { "123456": { reply: "…" } }）`)
      continue
    }
    const entries = Object.entries(raw)
    if (entries.length > MAX_RULES_PER_KIND) {
      errors.push(`${field} 规则条数超过上限 ${MAX_RULES_PER_KIND}`)
    }
    for (const [rawId, rawRule] of entries) {
      const id = normalizeId(rawId)
      if (!id) {
        errors.push(`${field} 里的「${rawId}」不是合法的${kind === 'group' ? '群号' : 'QQ 号'}`)
        continue
      }
      if (!rawRule || typeof rawRule !== 'object' || Array.isArray(rawRule)) {
        errors.push(`${field} 里的 ${id} 规则格式不对`)
        continue
      }
      const rule = normalizeRule(rawRule)
      if (!rule.reply) {
        errors.push(`${field} 里的 ${id} 缺少回复内容`)
        continue
      }
      next[field][id] = rule
    }
  }
  return { next, errors }
}

function apply(ctx) {
  let webServer
  try {
    webServer = (typeof ctx?.get === 'function' ? ctx.get('webServer') : undefined) || ctx?.webServer
  } catch {
    webServer = ctx?.webServer
  }
  if (!webServer || typeof webServer.register !== 'function') {
    try { ctx?.logger?.warn?.(`[${NS}] webServer 不可用，API 路由未注册`) } catch {}
    return
  }

  const disposers = []

  // 读 / 保存规则 —— **同一个 path 只注册一次**。
  //
  // 为什么不能分两次 register：webServer.register 是按 path 建表的，第二次注册
  // 同名 path 会**覆盖**掉第一次的 handler，于是 GET /rules 会被 POST 分支接住
  // 并返回 405「方法不允许」。所以这里在一个 handler 里按 method 分流。
  disposers.push(webServer.register({
    kind: 'exact',
    path: `${API_BASE}/rules`,
    handler: async (req, res) => {
      const method = String(req.method || 'GET').toUpperCase()
      if (method === 'GET') {
        try {
          const rules = loadFreeReply()
          sendJson(res, 200, { ok: true, rules, summary: buildSummary(rules), configFile: CONFIG_FILE })
        } catch (error) {
          sendJson(res, 500, { ok: false, error: error?.message ?? String(error) })
        }
        return
      }
      if (method === 'POST' || method === 'PUT') {
        const body = await readBody(req)
        const { next, errors } = validatePayload(body)
        if (errors.length) {
          sendJson(res, 400, { ok: false, error: errors[0], errors })
          return
        }
        try {
          const saved = saveFreeReply(next)
          sendJson(res, 200, { ok: true, rules: saved, summary: buildSummary(saved) })
        } catch (error) {
          sendJson(res, 500, { ok: false, error: error?.message ?? String(error) })
        }
        return
      }
      sendJson(res, 405, { ok: false, error: '方法不允许' })
    }
  }))

  // 切换总开关（面板上的大开关）
  disposers.push(webServer.register({
    kind: 'exact',
    path: `${API_BASE}/toggle`,
    handler: async (req, res) => {
      if (req.method !== 'POST') { sendJson(res, 405, { ok: false, error: '方法不允许' }); return }
      const body = await readBody(req)
      try {
        const current = loadFreeReply()
        current.enabled = body.enabled !== false
        const saved = saveFreeReply(current)
        sendJson(res, 200, { ok: true, enabled: saved.enabled })
      } catch (error) {
        sendJson(res, 500, { ok: false, error: error?.message ?? String(error) })
      }
    }
  }))

  // 健康检查
  disposers.push(webServer.register({
    kind: 'exact',
    path: `${API_BASE}/health`,
    handler: async (req, res) => {
      try {
        const rules = loadFreeReply()
        sendJson(res, 200, {
          ok: true,
          alive: true,
          enabled: rules.enabled,
          bridgeDir: BRIDGE_DIR,
          configFile: CONFIG_FILE,
          summary: buildSummary(rules)
        })
      } catch (error) {
        sendJson(res, 502, { ok: false, alive: false, error: error?.message ?? String(error) })
      }
    }
  }))

  const dispose = () => {
    for (const d of disposers) {
      try { d?.dispose?.() } catch {}
    }
  }
  if (typeof ctx?.effect === 'function') ctx.effect(() => dispose, `${NS}: api routes`)
  try { ctx?.logger?.info?.(`[${NS}] API 路由就绪，前缀 ${API_BASE}，配置 ${CONFIG_FILE}`) } catch {}
  return dispose
}

/**
 * cordis 依赖注入声明：这个宿主侧 bundle 需要 webServer 服务。
 * 注意与客户端的 `inject: ['slots']`（插槽）不是一回事 —— 这里是**宿主服务**。
 */
const inject = ['webServer']
const name = NS

export { apply, inject, name }
