# dsh-model-manager

DeepSeek Harness 的模型服务商管理插件。把服务商连接配置、模型目录、模型别名、推理强度、本地 HTTP 代理、快捷测试、故障切换、用量统计和费用估算集中到一个管理页面。

当前版本：**0.16.1**

> **0.16.1 变更：单价完全手动。** 单价表只显示你自己添加的模型，用量统计和测试调用都不会再自动加入需要填价的行。
>
> **0.15.0 新增：图片输入默认值。** 内置常见模型能力表（Claude / GPT / DeepSeek-VL / GLM-V / Grok 等），服务商没上报模态信息时按模型名自动判定。
>
> **0.14.0 新增：Anthropic adaptive thinking 支持。** 只对你勾选的模型生效，可以保留推理档位。
>
> **0.13.0 变更：多 API Key 路由已回退为单 Key。** 每个服务商重新只使用自己的一个密钥（`apiKeyEnv`）；按 Key 切换凭据、Key 额度、Key 暂停和“合并到已有服务商”的创建方式都已移除。模型别名保留，用来把本地模型名映射到上游模型名。

## 主要功能

- 创建、编辑和删除第三方模型服务商。
- 为每个服务商维护 Base URL、接口协议、单个 API Key、HTTP 代理和模型列表。
- 模型别名：本地模型名映射到上游模型名（例如 `gpt-4o-0.05=gpt-4o`）。
- 模型别名独立统计用量和价格，但使用服务商的同一个密钥。
- 主代理默认推理程度为 `high`；模型不支持时自动选择最接近的档位。
- 子代理支持统一推理程度、按模型设置、模型选择、重定向和故障切换。
- 快捷测试支持模型选择、推理程度、提示词、响应状态、耗时和用量查看。
- 支持自动发现本地 HTTP 代理，也可以手动填写代理地址。
- 按服务商、模型和会话统计 token 用量及费用，单价可随时删除或隐藏。
- 提供模型发现、并发测试、诊断记录和子代理派遣模拟。

## 服务商和密钥

每个服务商使用一个密钥：

```text
服务商：OpenAI
Base URL：https://api.example.com/v1
协议：OpenAI Chat Completions
密钥变量名：OPENAI_API_KEY
```

密钥通过 DSH 凭据服务保存，不写入普通模型配置，也不会回传到页面。要更换密钥，直接在“连接设置”里填写新的 API Key 并保存。

如果需要给同一个上游模型设置不同的价格或名称，使用下面的模型别名，而不是再建一个服务商或再配一个密钥。

## 模型别名

展开服务商卡片的“管理”，在“模型别名（本地模型 → 上游模型）”中填写：

```text
分组名称：cheap
本地模型别名：gpt-4o-0.05
上游模型 ID：gpt-4o
```

保存后：

- DSH 里出现一个独立模型 `gpt-4o-0.05`
- 用量和价格按 `服务商/gpt-4o-0.05` 单独统计
- 发给服务商时，请求体里的模型名会被改回 `gpt-4o`
- 使用的仍然是该服务商自己的密钥

可以添加多个别名，例如 `gpt-4o-0.05` 和 `gpt-4o-0.5`，它们的价格和用量互不影响。

| DSH 中的模型 | 上游模型 | 价格统计键 | 使用的密钥 |
| --- | --- | --- | --- |
| `gpt-4o-0.05` | `gpt-4o` | `服务商/gpt-4o-0.05` | 服务商自己的密钥 |
| `gpt-4o-0.5` | `gpt-4o` | `服务商/gpt-4o-0.5` | 服务商自己的密钥 |

别名里的 `0.05`、`0.5` 只是名字，不会自动改价，也不会切换账户分组。实际价格请在“用量统计 → 单价”里填写；上游账户的倍率和限额由该服务商密钥在服务商侧决定。

移除别名时：

- 点别名右侧的 `×` 移除单个别名
- 点“移除分组”移除整组别名
- 两种情况都会同时把对应的别名模型从模型列表里删掉，避免留下永远发不出去的模型

## 单价：完全手动添加

单价表里**只会出现你自己添加过的模型**，用量统计、测试调用、模型目录都不会自动往里塞条目。

在“用量统计 → 单价（用于估算费用）”中：

- **添加**：在输入框里填 `服务商/模型`（例如 `openai/gpt-4o`）后点“添加”；也可以从“从模型目录添加…”下拉里直接选一个
- **移除**：把该行从列表移除；如果这个单价已经保存过，会同时删除（写入设置，不需要再点保存）
- **清空**：只清空当前编辑框里的内容，仍需点“保存单价”才写入
- 顶部的搜索框只过滤你已经添加的行，不会拉出别的模型

测试调用（快捷测试 / 诊断 / 并发压测）不计入费用，也不会产生单价行。

## 推理强度

主代理默认推理程度为 `high`：

- 没有单独设置时，主代理请求使用 `high`
- 在默认模型设置或会话中单独选择其它档位时，以单独设置为准
- 目标模型只支持 `medium` 时，会自动把 `high` 降到最接近的支持档位
- 模型完全不支持推理时，不发送推理参数
- 模型管理中可以逐个模型配置支持的档位和实际发送值
- 子代理仍支持统一档位、按模型档位和会话级设置

## 图片输入默认值

很多中转不返回模型模态信息，导致模型全部默认“不支持图片输入”。插件内置一张常见模型能力表，在**没有任何模态信息**时兜底：

- Claude：`claude-3-*`、`claude-3.5/3.7-*`、`claude-(opus|sonnet|haiku)-3~9`、`claude-4/5/...`
- OpenAI：`gpt-4o*`、`gpt-4.1*`、`gpt-4-turbo*`、`gpt-5*`、`chatgpt-4o*`、`o1`（不含 `o1-mini`）、`o3`（不含 `o3-mini`）、`o4*`
- DeepSeek：只有 `deepseek-vl*` / `deepseek-vision*` / `deepseek-ocr*`；`deepseek-chat`、`deepseek-reasoner` 是纯文本
- GLM：`glm-4v`、`glm-4v-plus`、`glm-4.5v` 这类带 `v` 的；`glm-4.5`、`glm-4.6` 是纯文本
- Grok：`grok-4*`、`grok-*-vision*`；`grok-3`、`grok-2` 是纯文本
- 其它：`gemini-*`、`qwen*-vl*`、`kimi-*-vl*`、`llava*`、`pixtral*`、`internvl*`、`minicpm-v*`、`phi-*vision*`、`llama-3.2-*-vision*`、`mistral-*-vision*`、`doubao-*vision*`、`seed-*-vl*` 等

优先级：**服务商上报的模态信息 > 你手动保存的设置 > 能力表推断**。

- 获取模型时，没有模态信息的模型会直接按能力表写入 `["text","image"]`
- 模型管理里未保存过模态的模型，勾选框会按能力表默认勾上，标签注明“按模型名推断，保存后固定”
- 点“保存模型列表”后，推断结果会写成显式配置
- 判断错了就手动取消勾选，保存后以你的选择为准

## Anthropic adaptive thinking（opus 5.5 等新模型）

新出的 Claude 模型（例如 `claude-opus-5-5`）不接受传统的思考参数：

```text
400 claude-opus-5-5 requires adaptive thinking;
    omit thinking or use thinking.type=adaptive and output_config.effort
```

因为 DSH 适配器发的是老格式：

```json
{ "thinking": { "type": "enabled", "budget_tokens": 16384 } }
```

而这些模型只认新格式：

```json
{ "thinking": { "type": "adaptive" }, "output_config": { "effort": "high" } }
```

插件可以替你做这个改写。**在模型管理里展开该模型，勾选“使用 adaptive thinking”，保存即可。**

- 勾选后推理档位照常可选：`low → low`、`medium → medium`、`high → high`、`最大 → max`
- 选“关闭”时，插件会把 thinking 字段整个去掉（服务商对这种情况也接受）
- 只对**你勾选的模型**生效；同服务商其它模型、其它服务商、OpenAI 协议的请求都不受影响
- 只改写到该服务商自己的地址 + `/messages` 路径的 JSON 请求

有些中转的网关自己就会把老格式转好，这类服务商不需要勾选；只有把请求原样转发给上游、由上游强制要求 adaptive 的中转才需要。

> adaptive 目前是插件在请求发出前改写报文实现的；如果以后 DSH 适配器原生支持 `thinking.type=adaptive`，这个开关就可以不用了。

## 快捷测试、模型发现和代理

服务商卡片的“快捷测试”可以选择该服务商的任意模型和推理程度，发送测试提示词，并查看状态、错误、耗时、token 和模型元数据。

“获取模型”会通过服务商配置读取模型目录。合并后的模型列表就是 DSH 实际可用的模型列表。

本地 HTTP 代理按服务商生效，作用于正常模型调用、快捷测试和模型发现。支持自动检测常见端口，也支持手动填写，例如：

```text
http://127.0.0.1:7890
```

## 用量、价格和额度

- 用量按 `provider/model` 记录；别名模型拥有独立统计键
- 费用 = 用量 × 你在“单价”里填写的价格
- 没有填写单价的模型会显示“未定价”，不影响调用
- 快捷测试调用会单独标记为测试调用
- 每个模型的单价可以随时删除或隐藏

## 安装和更新

从 GitHub Release 下载 `dsh-model-manager-0.16.1.tgz`，通过 DSH 插件管理界面或对应 profile 的插件安装命令安装。

更新后需要手动重启 DSH 才能加载新的 Host 和 Web bundle。插件不会自动重启 DSH。

从源码打包：

```powershell
$node = 'C:\Users\你的用户名\.dsh\dsh-runtimes\dsh-primary-runtime\dependencies\node\bin\node.exe'
$pnpm = 'C:\Users\你的用户名\.dsh\dsh-runtimes\dsh-primary-runtime\dependencies\pnpm\bin\pnpm.mjs'
& $node $pnpm pack
```

## 开发和测试

```text
lib/index.js       Host 插件、请求处理、别名改写、用量处理
lib/client.js      Web 管理界面
lib/routing.js     模型别名解析和请求体改写
lib/usage.js       用量、价格和 Key 费用存储
cordis.patch.yml  DSH bundle patch
test/              回归测试
```

运行回归测试：

```powershell
node --test --test-isolation=none test/*.test.mjs
```

测试覆盖：

- 模型别名改写在 Key 被暂停或额度用尽时依然生效（防止上游收到别名导致 404）
- 并发请求都使用服务商自己的单个密钥
- 别名面板添加绑定并同步生成别名模型
- 主代理默认 `high` 和模型能力降级
- 模型发现、URL 和 `Request` 请求体改写
- 用量和费用持久化

## 仓库和发布

GitHub 仓库：

<https://github.com/wyfwyf123/dsh-plugin-plugin-manager>

当前 Release：

<https://github.com/wyfwyf123/dsh-plugin-plugin-manager/releases/tag/v0.16.1>
