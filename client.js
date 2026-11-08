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

// dsh-freereply-ui · 客户端
//
// 在 DSH 设置页里加一个「免token自动回复」页面：
//   - 两个选项栏：**群号** / **个人QQ号**
//   - 每个选项栏一张规则表：开关、回复话术、触发关键词
//   - 总开关 + 兜底话术
//
// 挂载方式（DSH 官方插槽契约）：
//   ctx.slots.inject('settings.section', () =>
//     ctx.slots.register({ name:'settings.section', id:'freereply', order:55, label:'免token自动回复' }, Component)
//   )
//
// 设计约束（DSH 插件规范）：
//   - 只用主题令牌（CSS 变量），不硬编码颜色 → 亮/暗色都正确
//   - 不 import 任何 Harness Client 包（@deepseek-ai/dsh-client-ui-*）
//   - 不崩：所有取数都要有兜底，面板不能把设置页搞挂

window.__ModuleLoader__.load({
  id: 'dsh-freereply-ui',
  factory(require) {
    const React = require('react')
    const h = React.createElement
    const { useState, useEffect, useCallback, useRef } = React

    const API = '/dsh-freereply'
    const MAKER = '蝠羽科技'

    // ── 样式：只用主题令牌，亮/暗都跟着系统走 ───────────────────────────
    const STYLE = `
.fr-root {
  --fr-ok: var(--dsw-alias-state-success-primary, #39d98a);
  --fr-warn: var(--dsw-alias-state-warn-primary, #e0a44a);
  --fr-fatal: var(--dsw-alias-state-error-primary, #e05a5a);
  --fr-idle: var(--dsw-alias-label-secondary, #8a8a8a);
  padding: 4px 2px 24px;
  font-size: 13px;
  line-height: 1.6;
}

/* ── 顶部状态条 ─────────────────────────────────────────── */
.fr-head {
  display: flex; align-items: center; gap: 10px;
  padding: 12px 14px; margin-bottom: 12px;
  border: 1px solid var(--dsw-alias-border-l2, #ffffff1f);
  border-radius: 10px;
  background: var(--dsw-alias-bg-layer-1, #ffffff08);
}
.fr-dot { width: 10px; height: 10px; border-radius: 50%; flex: 0 0 auto; background: var(--fr-idle); }
.fr-dot.on { background: var(--fr-ok); box-shadow: 0 0 8px var(--fr-ok); }
.fr-dot.off { background: var(--fr-idle); }
.fr-head-main { flex: 1 1 auto; min-width: 0; }
.fr-title { font-weight: 600; font-size: 14px; }
.fr-sub { color: var(--fr-idle); font-size: 12px; }
.fr-maker {
  font-size: 11px; color: var(--fr-idle);
  border: 1px solid var(--dsw-alias-border-l2, #ffffff1f);
  border-radius: 999px; padding: 1px 8px;
  flex: 0 0 auto; white-space: nowrap;
}

/* ── 总开关 ─────────────────────────────────────────────── */
.fr-master {
  display: flex; align-items: center; gap: 10px;
  padding: 11px 14px; margin-bottom: 12px;
  border: 1px solid var(--dsw-alias-border-l1, #ffffff12);
  border-radius: 10px;
  background: var(--dsw-alias-bg-layer-1, #ffffff06);
}
.fr-master.off { opacity: .65; }
.fr-switch {
  position: relative; width: 38px; height: 21px; flex: 0 0 auto;
  border-radius: 999px; border: 1px solid var(--dsw-alias-border-l2, #ffffff1f);
  background: var(--dsw-alias-bg-layer-2, #ffffff0d);
  cursor: pointer; padding: 0; appearance: none; -webkit-appearance: none;
}
.fr-switch::after {
  content: ''; position: absolute; top: 2px; left: 2px;
  width: 15px; height: 15px; border-radius: 50%;
  background: var(--dsw-alias-label-secondary, #8a8a8a);
  transition: transform .16s ease, background .16s ease;
}
.fr-switch[aria-checked="true"] {
  background: var(--dsw-alias-button-primary-fill, var(--dsw-alias-brand-primary, #5b8cff));
  border-color: transparent;
}
.fr-switch[aria-checked="true"]::after {
  transform: translateX(17px);
  background: var(--dsw-alias-label-primary-foreground, #fff);
}
.fr-master-text { flex: 1 1 auto; min-width: 0; }
.fr-master-title { font-weight: 600; }
.fr-master-sub { color: var(--fr-idle); font-size: 12px; }

/* ── 选项栏（tab） ──────────────────────────────────────── */
.fr-tabs {
  display: flex; gap: 4px; margin-bottom: 12px;
  border-bottom: 1px solid var(--dsw-alias-border-l1, #ffffff12);
}
.fr-tab {
  border: 0; background: transparent; cursor: pointer; font-family: inherit;
  padding: 8px 14px; font-size: 13px;
  color: var(--dsw-alias-label-secondary, #8a8a8a);
  border-bottom: 2px solid transparent; margin-bottom: -1px;
  display: inline-flex; align-items: center; gap: 6px;
}
.fr-tab:hover { color: var(--dsw-alias-label-primary, inherit); }
.fr-tab.active {
  color: var(--dsw-alias-label-primary, inherit);
  font-weight: 600;
  border-bottom-color: var(--dsw-alias-brand-primary, #5b8cff);
}
.fr-tab-count {
  font-size: 11px; padding: 0 6px; border-radius: 999px;
  background: var(--dsw-alias-bg-layer-2, #ffffff12);
  color: var(--dsw-alias-label-secondary, #8a8a8a);
  font-variant-numeric: tabular-nums;
}

/* ── 按钮 ───────────────────────────────────────────────── */
.fr-btn {
  border: 1px solid var(--dsw-alias-border-l2, #ffffff1f);
  background: var(--dsw-alias-bg-layer-2, #ffffff0d);
  color: var(--dsw-alias-label-primary, inherit);
  border-radius: 7px; padding: 5px 12px; font-size: 12px;
  cursor: pointer; font-family: inherit; white-space: nowrap;
}
.fr-btn:hover:not(:disabled) { border-color: var(--dsw-alias-brand-primary, #5b8cff); }
.fr-btn:disabled { opacity: .45; cursor: not-allowed; }
.fr-btn.primary {
  background: var(--dsw-alias-button-primary-fill, var(--dsw-alias-brand-primary, #5b8cff));
  border-color: transparent;
  color: var(--dsw-alias-label-primary-foreground, #fff);
}
.fr-btn.primary:hover:not(:disabled) {
  background: var(--dsw-alias-button-primary-hover, var(--dsw-alias-button-primary-fill, #5b8cff));
}
.fr-btn.tiny { padding: 2px 8px; font-size: 11px; }
.fr-btn.danger {
  color: var(--dsw-alias-label-error, #ff7b7b);
  border-color: var(--dsw-alias-label-error, #ff7b7b);
}

/* ── 表单 ───────────────────────────────────────────────── */
.fr-label { display: block; margin: 10px 0 4px; font-size: 12px; color: var(--dsw-alias-label-secondary, #8a8a8a); }
.fr-input, .fr-textarea, .fr-select {
  width: 100%; box-sizing: border-box;
  border: 1px solid var(--dsw-alias-border-l2, #ffffff1f);
  background: var(--dsw-alias-bg-layer-1, #ffffff06);
  color: var(--dsw-alias-label-primary, inherit);
  border-radius: 7px; padding: 6px 9px; font-size: 12px;
  font-family: inherit; line-height: 1.5;
}
.fr-textarea { resize: vertical; min-height: 56px; }
.fr-input:focus, .fr-textarea:focus, .fr-select:focus {
  outline: none; border-color: var(--dsw-alias-brand-primary, #5b8cff);
}
.fr-input::placeholder, .fr-textarea::placeholder { color: var(--fr-idle); }

/* ── 规则条目 ───────────────────────────────────────────── */
.fr-rule {
  border: 1px solid var(--dsw-alias-border-l1, #ffffff12);
  border-radius: 9px; padding: 11px 13px; margin-bottom: 9px;
  background: var(--dsw-alias-bg-layer-1, #ffffff06);
}
.fr-rule.off { opacity: .6; }
/* 草稿标记：回复内容还没填，这条规则只在本地，不会被保存 */
.fr-draft {
  font-size: 10px; padding: 1px 6px; border-radius: 4px;
  border: 1px solid var(--fr-warn, #e0a44a);
  color: var(--fr-warn, #e0a44a);
  white-space: nowrap;
}
/* 未保存提示 */
.fr-unsaved {
  font-size: 11px; color: var(--fr-warn, #e0a44a);
  display: inline-flex; align-items: center; gap: 4px;
}
.fr-unsaved::before {
  content: ''; width: 6px; height: 6px; border-radius: 50%;
  background: var(--fr-warn, #e0a44a);
}
.fr-rule-head {
  display: flex; align-items: center; gap: 8px; margin-bottom: 4px;
}
.fr-rule-id {
  font-family: ui-monospace, SFMono-Regular, Menlo, monospace;
  font-size: 13px; font-weight: 600;
}
.fr-rule-head-right { margin-left: auto; display: flex; align-items: center; gap: 6px; }
.fr-check {
  display: inline-flex; align-items: center; gap: 5px;
  font-size: 12px; color: var(--dsw-alias-label-secondary, #8a8a8a);
  cursor: pointer; user-select: none;
}
.fr-check input { width: auto; margin: 0; }
.fr-note { color: var(--fr-idle); font-size: 11px; margin-top: 4px; }

/* ── 新增行 ─────────────────────────────────────────────── */
.fr-add {
  display: flex; gap: 8px; align-items: flex-start; margin-top: 10px;
  padding-top: 12px; border-top: 1px dashed var(--dsw-alias-border-l1, #ffffff12);
}
.fr-add .fr-input { flex: 1 1 auto; min-width: 0; }

/* ── 杂项 ───────────────────────────────────────────────── */
.fr-empty {
  color: var(--fr-idle); font-size: 12px;
  padding: 16px 0; text-align: center;
  border: 1px dashed var(--dsw-alias-border-l1, #ffffff12);
  border-radius: 9px;
}
.fr-toast {
  margin-top: 10px; padding: 8px 11px; border-radius: 7px; font-size: 12px;
  border: 1px solid var(--dsw-alias-border-l2, #ffffff1f);
}
.fr-toast.ok { border-left: 3px solid var(--fr-ok); }
.fr-toast.err { border-left: 3px solid var(--fr-fatal); }
.fr-bar {
  display: flex; align-items: center; gap: 8px; margin-top: 12px; flex-wrap: wrap;
}
.fr-bar .fr-spacer { flex: 1 1 auto; }
.fr-kw {
  display: inline-flex; align-items: center; gap: 4px;
  font-size: 11px; padding: 1px 7px; border-radius: 999px; margin: 3px 4px 0 0;
  background: var(--dsw-alias-bg-layer-2, #ffffff12);
  color: var(--dsw-alias-label-secondary, #8a8a8a);
}
.fr-kw button {
  border: 0; background: transparent; cursor: pointer; padding: 0;
  color: inherit; font-size: 12px; line-height: 1;
}
.fr-note-box {
  margin-top: 14px; padding: 9px 11px; border-radius: 7px; font-size: 12px;
  border: 1px solid var(--dsw-alias-border-l1, #ffffff12);
  color: var(--dsw-alias-label-secondary, #8a8a8a);
  background: var(--dsw-alias-bg-layer-1, #ffffff06);
}
.fr-note-box code {
  font-family: ui-monospace, SFMono-Regular, Menlo, monospace;
  font-size: 11px; background: var(--dsw-alias-bg-layer-2, #ffffff12);
  padding: 1px 5px; border-radius: 4px;
}
`

    function fmtTime(ts) {
      try {
        return new Date(ts).toLocaleTimeString('zh-CN', { hour12: false })
      } catch {
        return '--:--:--'
      }
    }

    async function fetchJson(pathname, options) {
      try {
        const res = await fetch(API + pathname, options || {})
        const text = await res.text()
        let data
        try { data = JSON.parse(text) } catch { data = { ok: false, error: text.slice(0, 200) } }
        if (!res.ok && data?.ok !== true) {
          throw new Error(data?.error || `HTTP ${res.status}`)
        }
        return data
      } catch (e) {
        throw new Error(e?.message || String(e))
      }
    }

    /** 空规则 */
    function emptyRule() {
      return { enabled: true, reply: '', keywords: [] }
    }

    /** 空表 */
    function emptyTable() {
      return {}
    }

    function FreeReplyPanel() {
      const [rules, setRules] = useState(null)
      const [summary, setSummary] = useState(null)
      const [loading, setLoading] = useState(true)
      const [busy, setBusy] = useState(false)
      const [toast, setToast] = useState(null)
      const [err, setErr] = useState('')
      const [tab, setTab] = useState('groups')
      const [configFile, setConfigFile] = useState('')
      const [newGroupId, setNewGroupId] = useState('')
      const [newPrivateId, setNewPrivateId] = useState('')
      const [dirty, setDirty] = useState(false)
      const timerRef = useRef(null)
      // dirty 的镜像：给定时轮询用（useCallback 的闭包会拿到过期的 dirty，
      // 直接在 load 里读 state 会永远读到 false，轮询就又会把用户的编辑冲掉）
      const dirtyRef = useRef(false)
      useEffect(() => { dirtyRef.current = dirty }, [dirty])

      const load = useCallback(async (silent) => {
        try {
          const r = await fetchJson('/rules')
          const next = r.rules || {}
          // ⚠️ 轮询（silent=true）**绝不能覆盖用户还没保存的本地编辑**。
          //   之前这里无条件 setRules()，于是「刚加的 QQ 号」在 15 秒后被服务端
          //   旧数据冲掉 —— 而 dirty 仍是 true，用户点保存还会把旧数据写回去，
          //   看起来像「填好的 QQ 号被删了」。
          if (silent && dirtyRef.current) return
          setRules({
            enabled: next.enabled !== false,
            applyToOwner: next.applyToOwner === true,
            defaultReply: next.defaultReply || '',
            groups: next.groups || emptyTable(),
            privates: next.privates || emptyTable()
          })
          setSummary(r.summary || null)
          setConfigFile(r.configFile || '')
          setErr('')
          if (!silent) setDirty(false)
        } catch (e) {
          setErr(e?.message || String(e))
        } finally {
          setLoading(false)
        }
      }, [])

      useEffect(() => {
        load()
        // 面板开着的时候定时刷新，能看到别的窗口改过配置
        timerRef.current = setInterval(() => load(true), 15000)
        return () => { if (timerRef.current) clearInterval(timerRef.current) }
      }, [load])

      /**
       * 组装要提交给服务端的规则。
       *
       * **回复内容为空的规则不提交** —— 服务端会拒绝（"缺少回复内容"），
       * 一条被拒就整次保存全废。这类规则是「刚加进来还没填完」的草稿，
       * 它们留在本地界面上（带「待填写」标记），等填完再保存。
       */
      const buildPayload = useCallback((src) => {
        const clean = (table) => {
          const out = {}
          for (const [id, rule] of Object.entries(table || {})) {
            if (String(rule?.reply ?? '').trim()) out[id] = rule
          }
          return out
        }
        const g = clean(src?.groups)
        const p = clean(src?.privates)
        return {
          payload: {
            enabled: src?.enabled !== false,
            applyToOwner: src?.applyToOwner === true,
            defaultReply: src?.defaultReply || '',
            groups: g,
            privates: p
          },
          skipped: Object.keys(src?.groups || {}).length - Object.keys(g).length
            + Object.keys(src?.privates || {}).length - Object.keys(p).length
        }
      }, [])

      const save = useCallback(async () => {
        setBusy(true)
        setToast(null)
        try {
          const { payload, skipped } = buildPayload(rules)
          const r = await fetchJson('/rules', {
            method: 'POST',
            headers: { 'content-type': 'application/json; charset=utf-8' },
            body: JSON.stringify(payload)
          })
          const next = r.rules || {}
          // ⚠️ 不要用服务端返回值整体覆盖本地状态：草稿规则（还没填回复内容）
          //   服务端根本没收到，用返回值覆盖会把它们从界面上抹掉。
          setRules((prev) => (prev ? {
            ...prev,
            enabled: next.enabled !== false,
            applyToOwner: next.applyToOwner === true,
            defaultReply: next.defaultReply || ''
          } : prev))
          setSummary(r.summary || null)
          setDirty(false)
          setToast({
            ok: true,
            text: skipped > 0
              ? `已保存；${skipped} 条因为还没填回复内容只留在本地`
              : '已保存，桥接下一条消息即刻生效'
          })
        } catch (e) {
          setToast({ ok: false, text: e?.message || String(e) })
        } finally {
          setBusy(false)
        }
      }, [rules, buildPayload])

      /** 改某张表里的一条规则 */
      const patchRule = useCallback((field, id, patch) => {
        setRules((prev) => {
          if (!prev) return prev
          const table = { ...(prev[field] || {}) }
          // ⚠️ 这里**不能**因为 reply 为空就删掉整条规则 —— 那样「刚加的 QQ 号」
          //   会因为还没填内容就从界面上消失。空回复只是「待填写」的草稿，
          //   提交时由 buildPayload 过滤掉。
          table[id] = { ...(table[id] || emptyRule()), ...patch }
          return { ...prev, [field]: table }
        })
        setDirty(true)
      }, [])

      /** 新增一条规则 */
      const addRule = useCallback((field, rawId) => {
        const id = String(rawId ?? '').trim()
        if (!/^\d+$/.test(id)) {
          setToast({ ok: false, text: '请填写纯数字的号码' })
          return false
        }
        const norm = String(Number(id))
        // 先查重再 setState：把 setToast 放进 setRules 的 updater 里是反模式
        // （updater 必须是纯函数，StrictMode 下会被调用两次）。
        const existing = rules?.[field] || {}
        if (existing[norm]) {
          setToast({ ok: false, text: `${norm} 已经存在了` })
          return false
        }
        setRules((prev) => {
          if (!prev) return prev
          const table = { ...(prev[field] || {}) }
          table[norm] = emptyRule()
          return { ...prev, [field]: table }
        })
        setDirty(true)
        return true
      }, [rules])

      /** 删除一条规则 */
      const removeRule = useCallback((field, id) => {
        setRules((prev) => {
          if (!prev) return prev
          const table = { ...(prev[field] || {}) }
          delete table[id]
          return { ...prev, [field]: table }
        })
        setDirty(true)
      }, [])

      /** 切换总开关（立即保存） */
      const toggleMaster = useCallback(async () => {
        if (!rules) return
        const next = !rules.enabled
        setRules((prev) => (prev ? { ...prev, enabled: next } : prev))
        try {
          await fetchJson('/toggle', {
            method: 'POST',
            headers: { 'content-type': 'application/json; charset=utf-8' },
            body: JSON.stringify({ enabled: next })
          })
          setToast({ ok: true, text: next ? '免token自动回复已开启' : '免token自动回复已关闭' })
        } catch (e) {
          setToast({ ok: false, text: e?.message || String(e) })
          await load(true)
        }
      }, [rules, load])

      if (loading) {
        return h('div', { className: 'fr-root' },
          h('style', null, STYLE),
          h('div', { className: 'fr-empty' }, '正在读取自动回复规则…')
        )
      }

      if (err && !rules) {
        return h('div', { className: 'fr-root' },
          h('style', null, STYLE),
          h('div', { className: 'fr-toast err' }, '读不到规则：' + err),
          h('div', { className: 'fr-note-box' },
            '插件找不到 qq-bridge 的配置文件。请确认 ',
            h('code', null, 'D:\\大肥鱼\\qq-bridge\\config.json'),
            ' 存在，或用环境变量 QQ_BRIDGE_DIR 指定桥接目录。'
          )
        )
      }

      const r = rules || { enabled: false, applyToOwner: false, defaultReply: '', groups: {}, privates: {} }
      const groups = r.groups || {}
      const privates = r.privates || {}
      const field = tab === 'groups' ? 'groups' : 'privates'
      const table = field === 'groups' ? groups : privates
      const ids = Object.keys(table).sort((a, b) => Number(a) - Number(b))
      const isGroup = tab === 'groups'
      const label = isGroup ? '群号' : '个人QQ号'
      const otherLabel = isGroup ? '个人QQ号' : '群号'

      const renderRule = (id) => {
        const rule = table[id] || emptyRule()
        const kws = Array.isArray(rule.keywords) ? rule.keywords : []
        return h('div', { key: id, className: `fr-rule${rule.enabled ? '' : ' off'}` },
          h('div', { className: 'fr-rule-head' },
            h('span', { className: 'fr-rule-id' }, id),
            h('span', { className: 'fr-note' }, isGroup ? '群' : '私聊'),
            // 草稿标记：回复内容还没填 —— 这条规则只在本地，不会被保存
            String(rule.reply || '').trim()
              ? null
              : h('span', { className: 'fr-draft' }, '待填写'),
            h('div', { className: 'fr-rule-head-right' },
              h('label', { className: 'fr-check' },
                h('input', {
                  type: 'checkbox', checked: rule.enabled !== false,
                  onChange: (e) => patchRule(field, id, { enabled: e.target.checked })
                }),
                '启用'
              ),
              h('button', {
                className: 'fr-btn tiny danger', title: '删除这条规则',
                onClick: () => removeRule(field, id)
              }, '删除')
            )
          ),
          h('label', { className: 'fr-label' }, '自动回复内容（命中即发送，不消耗 token）'),
          h('textarea', {
            className: 'fr-textarea',
            value: rule.reply || '',
            placeholder: '例如：在的，稍等一下～',
            onChange: (e) => patchRule(field, id, { reply: e.target.value })
          }),
          h('label', { className: 'fr-label' }, '触发关键词（留空 = 该会话每条消息都回）'),
          h('input', {
            className: 'fr-input',
            value: kws.join('、'),
            placeholder: '用、或逗号分隔，例如：你好、在吗',
            onChange: (e) => {
              const parts = String(e.target.value || '')
                .split(/[,，、\s]+/)
                .map((x) => x.trim())
                .filter(Boolean)
              patchRule(field, id, { keywords: parts })
            }
          }),
          kws.length
            ? h('div', null, kws.map((kw, i) => h('span', { key: i, className: 'fr-kw' },
                kw,
                h('button', {
                  title: '移除',
                  onClick: () => patchRule(field, id, { keywords: kws.filter((_, j) => j !== i) })
                }, '×')
              )))
            : null
        )
      }

      const newIdValue = isGroup ? newGroupId : newPrivateId
      const setNewIdValue = isGroup ? setNewGroupId : setNewPrivateId

      return h('div', { className: 'fr-root' },
        h('style', null, STYLE),

        // 顶部状态条
        h('div', { className: 'fr-head' },
          h('span', { className: `fr-dot ${r.enabled ? 'on' : 'off'}` }),
          h('div', { className: 'fr-head-main' },
            h('div', { className: 'fr-title' }, '免token自动回复'),
            h('div', { className: 'fr-sub' },
              r.enabled
                ? '命中规则时直接发预设话术，完全不经过模型'
                : '当前已关闭 —— 所有消息照常走模型'
            )
          ),
          h('span', { className: 'fr-maker' }, `制作方：${MAKER}`)
        ),

        // 总开关
        h('div', { className: `fr-master${r.enabled ? '' : ' off'}` },
          h('button', {
            className: 'fr-switch',
            role: 'switch',
            'aria-checked': r.enabled ? 'true' : 'false',
            'aria-label': '免token自动回复总开关',
            onClick: toggleMaster
          }),
          h('div', { className: 'fr-master-text' },
            h('div', { className: 'fr-master-title' }, '总开关'),
            h('div', { className: 'fr-master-sub' },
              '开关改动即时生效；规则改动需要点下面的「保存规则」。'
            )
          )
        ),

        // 管理员豁免开关
        //
        // 管理员（ownerQQ）的消息默认**不走**免token 捷径 —— 审批、提问、指令都要走模型，
        // 拦成固定话术会打断管理流程。但这样一来，用户拿自己的 QQ 测规则就永远测不出来，
        // 所以这里给一个开关：打开后管理员的消息也按规则回。
        h('div', { className: `fr-master${r.applyToOwner ? '' : ' off'}` },
          h('button', {
            className: 'fr-switch',
            role: 'switch',
            'aria-checked': r.applyToOwner ? 'true' : 'false',
            'aria-label': '管理员消息也走免token自动回复',
            onClick: () => {
              setRules((p) => (p ? { ...p, applyToOwner: !p.applyToOwner } : p))
              setDirty(true)
            }
          }),
          h('div', { className: 'fr-master-text' },
            h('div', { className: 'fr-master-title' }, '管理员消息也走免token自动回复'),
            h('div', { className: 'fr-master-sub' },
              '默认关闭：管理员的消息要留给审批/提问/指令。打开后拿自己的 QQ 也能测规则。'
            )
          )
        ),

        // 兜底话术
        h('label', { className: 'fr-label' }, '兜底话术（该会话没配规则时用；留空则不回复）'),
        h('textarea', {
          className: 'fr-textarea',
          value: r.defaultReply || '',
          placeholder: '例如：我先歇会儿，稍等片刻～',
          onChange: (e) => { setRules((p) => (p ? { ...p, defaultReply: e.target.value } : p)); setDirty(true) }
        }),

        // ── 两个选项栏 ────────────────────────────────────
        h('div', { className: 'fr-tabs', role: 'tablist' },
          h('button', {
            className: `fr-tab${tab === 'groups' ? ' active' : ''}`,
            role: 'tab',
            'aria-selected': tab === 'groups' ? 'true' : 'false',
            onClick: () => setTab('groups')
          }, '群号', h('span', { className: 'fr-tab-count' }, String(Object.keys(groups).length))),
          h('button', {
            className: `fr-tab${tab === 'privates' ? ' active' : ''}`,
            role: 'tab',
            'aria-selected': tab === 'privates' ? 'true' : 'false',
            onClick: () => setTab('privates')
          }, '个人QQ号', h('span', { className: 'fr-tab-count' }, String(Object.keys(privates).length)))
        ),

        // 选项栏内容
        ids.length
          ? h('div', null, ids.map(renderRule))
          : h('div', { className: 'fr-empty' }, `还没有配置任何${label}规则`),

        // 新增
        h('div', { className: 'fr-add' },
          h('input', {
            className: 'fr-input',
            value: newIdValue,
            inputMode: 'numeric',
            placeholder: isGroup ? '输入群号，如 123456789' : '输入QQ号，如 123456789',
            onChange: (e) => setNewIdValue(e.target.value),
            onKeyDown: (e) => {
              if (e.key === 'Enter') {
                if (addRule(field, newIdValue)) { setNewIdValue('') }
              }
            }
          }),
          h('button', {
            className: 'fr-btn',
            onClick: () => { if (addRule(field, newIdValue)) setNewIdValue('') }
          }, `添加${label}`)
        ),

        toast ? h('div', { className: `fr-toast ${toast.ok ? 'ok' : 'err'}` }, toast.text) : null,

        // 保存栏
        h('div', { className: 'fr-bar' },
          h('button', {
            className: 'fr-btn primary',
            disabled: busy || !dirty,
            onClick: save
          }, busy ? '保存中…' : (dirty ? '保存规则' : '已保存')),
          h('button', {
            className: 'fr-btn', disabled: busy,
            onClick: () => {
              // 有未保存的编辑时，「重新读取」会丢掉它们 —— 先说一声。
              if (dirty && !window.confirm('有还没保存的修改，重新读取会丢掉它们。继续？')) return
              load()
            }
          }, '重新读取'),
          h('span', { className: 'fr-spacer' }),
          dirty
            ? h('span', { className: 'fr-unsaved' }, '有未保存的修改（自动刷新已暂停）')
            : null,
          summary
            ? h('span', { className: 'fr-note' },
                `共 ${summary.total} 条规则（群 ${summary.groupsEnabled}/${summary.groups} · 私聊 ${summary.privatesEnabled}/${summary.privates}）`)
            : null
        ),

        h('div', { className: 'fr-note-box' },
          '规则写在 ', h('code', null, configFile || 'qq-bridge/config.json'),
          ' 的 ', h('code', null, 'freeReply'), ' 节点里，由 qq-bridge 自己读。',
          h('br'),
          '命中时的行为：桥接直接把话术发出去，**不建会话、不调模型、不消耗 token**；',
          '没命中关键词就照常走原来的 AI 回复流程。',
          h('br'),
          '两个选项栏是分开的：', h('code', null, 'groups'), ' 走群消息，',
          h('code', null, 'privates'), ' 走私聊消息，互不影响。'
        )
      )
    }

    return {
      inject: ['slots'],
      apply(ctx) {
        ctx.slots.inject('settings.section', () =>
          ctx.slots.register(
            { name: 'settings.section', id: 'freereply', order: 55, label: '免token自动回复' },
            FreeReplyPanel
          )
        )
      }
    }
  }
})
