# dsh-freereply-ui · 免token自动回复

DeepSeek Harness 设置页插件：命中规则时**直接发预设话术**，完全不经过模型，因此**不消耗任何 token**。

设置页里分**两个选项栏**：

- **群号** —— 针对群消息的规则
- **个人QQ号** —— 针对私聊消息的规则

两张表互相独立，互不影响。

制作方：蝠羽科技（fuyu-technology）

---

## 它是怎么工作的

普通回复链路是：QQ 消息 → 桥接 → DSH → LLM → 回群。这一路每条消息都烧 token。

免token自动回复在桥接里**提前短路**：

```
QQ 消息 → 桥接 → 命中规则？ ── 是 → 直接发预设话术（无 token） ──→ 回到 QQ
                    │
                    └─ 否 → 照常走模型（有 token）
```

所以：

- 命中规则时**不建会话、不调模型、不计费**
- 没命中（比如消息里没有触发关键词）就**完全不受影响**，照常走 AI 回复

## 规则长什么样

每条规则挂在**一个群号或一个 QQ 号**上：

| 字段 | 含义 |
| --- | --- |
| 启用 | 这条规则是否生效 |
| 自动回复内容 | 命中后直接发出去的文字 |
| 触发关键词 | 消息里包含其中任意一个才回；**留空 = 该会话每条消息都回** |

还有一个**兜底话术**：该会话没有单独配规则时用它，留空则不回复。

数据落在 qq-bridge 的 `config.json` 里（`freeReply` 节点），由桥接自己读：

```json
{
  "freeReply": {
    "enabled": true,
    "defaultReply": "我先歇会儿，稍等片刻～",
    "groups": {
      "123456789": {
        "enabled": true,
        "reply": "在的，稍等一下～",
        "keywords": ["你好", "在吗"]
      }
    },
    "privates": {
      "123456789": {
        "enabled": true,
        "reply": "收到，我看看。",
        "keywords": []
      }
    }
  }
}
```

## 安装

插件目录结构：

```
dsh-freereply-ui/
  index.js          宿主侧：HTTP API，读写 qq-bridge/config.json
  client.js         客户端侧：设置页面板（两个选项栏）
  cordis.patch.yml  bundle 入口声明
  icon.svg
  locale/zh.json
  locale/en.json
```

装到 DSH 的插件目录，再把它加进 profile 的 `dependencies` 与 `dsh.profile.bundles`：

```json
{
  "dependencies": {
    "dsh-freereply-ui": "link:C:/Users/Administrator/.dsh/plugins/dsh-freereply-ui"
  },
  "dsh": {
    "profile": {
      "bundles": ["...", "dsh-freereply-ui"]
    }
  }
}
```

> ⚠️ **BOM 警告**：DSH profile 的 `package.json` 带 UTF-8 BOM 会让 DSH 启动即崩。
> 改这个文件一定要用无 BOM 的写法（Node 的 `fs.writeFileSync(path, s, 'utf8')` 不带 BOM，
> 但 PowerShell 的 `Set-Content -Encoding UTF8` **会**带 BOM，别用它）。

## 配置

| 环境变量 | 默认值 | 说明 |
| --- | --- | --- |
| `QQ_BRIDGE_DIR` | `D:\大肥鱼\qq-bridge` | qq-bridge 的安装目录（插件据此找 `config.json`） |

## HTTP API

插件在 DSH 的 web server 上注册了这些路由（浏览器端永远拿不到任何令牌）：

| 方法 | 路径 | 说明 |
| --- | --- | --- |
| GET | `/dsh-freereply/rules` | 读全部规则 + 统计 |
| POST | `/dsh-freereply/rules` | 保存全部规则（整体覆盖） |
| POST | `/dsh-freereply/toggle` | 切换总开关（`{ enabled: true\|false }`） |
| GET | `/dsh-freereply/health` | 健康检查 |

## 设计约束

- 只用 DSH 主题令牌（CSS 变量），不硬编码颜色 → 亮/暗色都正确
- 不 import 任何 Harness Client 包（`@deepseek-ai/dsh-client-ui-*`）
- 不崩：所有取数都有兜底，面板坏了也不会把设置页搞挂
- 写 `config.json` 走「读整份 → 改一个节点 → 原子 rename 写回」，
  顶层不是对象时**拒绝改写**（否则会把整份配置替换掉，白名单和令牌全没）

## 许可

Apache-2.0。允许二次修改与再分发，但**必须保留**源码头部版权声明与 NOTICE 中的署名。
详见 `LICENSE` 与 `NOTICE`。
