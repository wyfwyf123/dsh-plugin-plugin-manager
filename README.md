# dsh-model-manager

DeepSeek Harness 的模型服务商管理插件。它把服务商连接配置、模型目录、多个 API Key、倍率模型分组、模型推理强度、本地 HTTP 代理、快捷测试、故障切换、用量统计和费用估算集中到一个管理页面中。

当前版本：**0.12.2**

## 主要功能

- 创建、编辑和删除第三方模型服务商。
- 为每个服务商维护 Base URL、接口协议、API Key、HTTP 代理和模型列表。
- 在创建新配置时选择已有服务商，把新的 API Key 和模型倍率组直接合并进去。
- 使用本地模型别名区分同一个上游模型的不同 Key、价格和性能组。
- 每个 Key 独立启用、暂停、获取模型、设置额度和累计费用。
- 主代理默认推理程度为 `high`；模型不支持时自动选择最接近的档位。
- 子代理支持统一推理程度、按模型设置、模型选择、重定向和故障切换。
- 快捷测试支持模型选择、推理程度、提示词、响应状态、耗时和用量查看。
- 支持自动发现本地 HTTP 代理，也可以手动填写代理地址。
- 按服务商、模型、会话和 Key 统计 token 用量及费用。
- 提供模型发现、并发测试、诊断记录和子代理派遣模拟。

## 多 Key 合并工作流

推荐先创建一个服务商，例如：

```text
服务商：OpenAI
Base URL：https://api.example.com/v1
协议：OpenAI Chat Completions
```

以后要为同一个服务商增加另一组 Key 时，点击“新增服务商”，在“合并到已有服务商”中选择 `OpenAI`。插件会自动带出原服务商的 URL、接口协议和已有模型，不会再创建第二个服务商。

接着填写新的 Key 和模型分组：

```text
Key ID：cheap
Key 名称：低价 0.05
模型别名=上游模型：gpt-4o-0.05=gpt-4o, o3-mini-0.05=o3-mini
推理档位：标准
API Key：新的 API Key
```

点击创建后，结果仍然归属于同一个 `OpenAI` 服务商：

```text
OpenAI
├── default Key
├── cheap Key
├── gpt-4o
├── gpt-4o-0.05
└── o3-mini-0.05
```

快捷测试、模型管理、默认模型选择、子代理模型选择和代理设置都继续使用同一个服务商卡片。Key 管理也在服务商卡片的“管理”展开区域中，不会生成独立的服务商卡片。

## 模型别名和倍率分组

模型绑定使用以下格式：

```text
本地模型别名=上游模型 ID
```

例如：

```text
gpt-4o-0.05=gpt-4o
gpt-4o-0.5=gpt-4o
```

DSH 内部会把它们当作两个不同的模型，因此可以分别设置价格、统计用量和选择 Key；请求发送到上游时，HTTP JSON 请求体中的 `model` 会改回 `gpt-4o`。

| DSH 中的模型 | 绑定 Key | 上游模型 | 价格统计键 |
| --- | --- | --- | --- |
| `gpt-4o-0.05` | 低价 Key | `gpt-4o` | `服务商/gpt-4o-0.05` |
| `gpt-4o-0.5` | 高价 Key | `gpt-4o` | `服务商/gpt-4o-0.5` |

倍率名称只是分组标识，不会自动修改价格。实际费用以“用量统计”中填写的单价为准；实际性能和限额由对应 API Key 在上游服务商侧的账户分组决定。

## Key 管理

展开服务商卡片的“管理”后，可以在 Key 管理区完成以下操作：

- 添加新的 Key，并填写 Key ID、名称、API Key 和生命周期额度。
- 直接启用或暂停单个 Key。
- 查看该 Key 已绑定的本地模型和累计费用。
- 单独获取该 Key 可用的模型列表。
- 搜索、全选和勾选模型，并添加到该 Key 的模型分组。
- 移除单个模型绑定。
- 单独重置该 Key 的累计费用。

模型发现请求会使用当前选中的 Key，不会在缺少密钥时静默回退到服务商默认 Key。部分上游服务商会对不同 Key 返回完全相同的模型列表；这种情况下，插件仍会保证实际请求和费用统计使用正确的 Key。

## 推理强度

主代理默认推理程度为 `high`：

- 没有单独设置时，主代理请求使用 `high`。
- 在默认模型设置或会话中单独选择其它档位时，以单独设置为准。
- 如果目标模型只支持 `medium`，会自动把 `high` 降到最接近的支持档位。
- 如果模型完全不支持推理，则不发送推理参数。
- 模型管理中的每个模型可以单独配置支持的推理档位以及实际发送值。
- 子代理仍可以使用统一档位、按模型档位或会话级设置。

## 快捷测试和模型发现

服务商卡片上的“快捷测试”可以直接选择该服务商的模型和推理程度，发送测试提示词，并查看成功状态、错误、耗时、token 和模型元数据。

模型管理中的“获取模型”会通过服务商配置发现模型。合并 Key 的场景建议在 Key 管理区使用对应 Key 的“获取模型”，这样每个 Key 的发现结果可以独立保留。

## 本地 HTTP 代理

代理设置按服务商生效，只影响该服务商的：

- 正常模型调用
- 快捷测试
- 模型发现

可以点击“自动检测”扫描常见的本地 HTTP 代理端口，也可以手动填写，例如：

```text
http://127.0.0.1:7890
```

## 用量、价格和额度

- 日常模型调用按 `provider/model` 记录。
- 别名模型拥有独立的用量和价格统计键。
- 每个 Key 维护独立的生命周期累计费用。
- Key 额度达到上限后，该 Key 不再被模型路由选中。
- 费用重置只重置指定 Key，不会影响其它 Key 或日用量记录。
- 快捷测试调用会单独标记为测试调用。

## 安全和凭据

API Key 通过 DSH 凭据服务保存，不写入模型配置文件，也不会回传到界面。配置文件中只保存凭据引用，例如：

```text
MODEL_MANAGER_OPENAI_CHEAP_API_KEY
```

提交代码前请确认没有把真实 API Key、`.env` 文件或本地运行目录加入 Git。仓库的 `.gitignore` 已忽略依赖目录、插件包和常见环境文件。

## 安装

从 GitHub Release 下载 `dsh-model-manager-0.12.2.tgz`，使用 DSH 的插件管理界面或对应 profile 的插件安装命令安装。

也可以从源码打包：

```powershell
$node = 'C:\Users\你的用户名\.dsh\dsh-runtimes\dsh-primary-runtime\dependencies\node\bin\node.exe'
$pnpm = 'C:\Users\你的用户名\.dsh\dsh-runtimes\dsh-primary-runtime\dependencies\pnpm\bin\pnpm.mjs'
& $node $pnpm pack
```

安装或更新插件后需要重启 DSH，才能加载新的 Host 和 Web bundle。插件不会自动重启 DSH。

## 开发和测试

源代码目录：

```text
lib/index.js       Host 插件、请求路由、Key 选择和用量处理
lib/client.js      Web 管理界面
lib/routing.js     模型别名和 Key 路由
lib/usage.js       用量、价格和 Key 累计费用
cordis.patch.yml  DSH bundle patch
```

运行回归测试：

```powershell
node --test --test-isolation=none test/*.test.mjs
```

测试覆盖：

- 模型别名和 Key 优先级
- URL 和 `Request` 请求体改写
- 并发请求的凭据隔离
- 按 Key 获取模型
- 缺少密钥时禁止回退
- Key 启用、暂停和独立模型保存
- 合并服务商创建
- 主代理默认 `high` 和模型能力降级
- Key 费用持久化与独立重置

## 仓库和发布

GitHub 仓库：

<https://github.com/wyfwyf123/dsh-plugin-plugin-manager>

当前 Release：

<https://github.com/wyfwyf123/dsh-plugin-plugin-manager/releases/tag/v0.12.2>

项目使用 `main` 分支。发布时会同时提交源码、测试、bundle patch 和 npm tarball 附件。
