# dsh-model-manager 中文文档

DeepSeek Harness 的模型服务商管理插件。它把服务商连接配置、模型目录、多个 API Key、倍率模型分组、模型推理强度、本地 HTTP 代理、快捷测试、故障切换、用量统计和费用估算集中到一个管理页面中。

当前版本：**0.12.2**

## 功能概览

- 管理第三方模型服务商和模型目录。
- 创建新配置时合并到已有服务商，不生成重复的服务商。
- 在同一个服务商下管理多个 API Key、倍率组、启用状态和额度。
- 使用本地别名区分同一上游模型的不同 Key、价格和性能组。
- 主代理默认推理程度为 `high`，不支持时自动兼容降级。
- 配置子代理推理程度、模型选择、重定向和故障切换。
- 运行快捷测试、模型发现、并发诊断和子代理派遣模拟。
- 按服务商、模型、会话和 Key 记录用量与费用。

## 合并到已有服务商

创建第一个服务商后，新增 Key 时点击“新增服务商”，然后选择“合并到已有服务商”。插件会自动带出原服务商的 Base URL、接口协议和已有模型；保存后只会新增一个 Key 和模型分组，所有功能仍归属于原服务商卡片。

示例：

```text
Key ID：cheap
Key 名称：低价 0.05
模型：gpt-4o-0.05=gpt-4o, o3-mini-0.05=o3-mini
推理档位：标准
API Key：新的 API Key
```

保存后：

```text
OpenAI
├── default Key
├── cheap Key
├── gpt-4o
├── gpt-4o-0.05
└── o3-mini-0.05
```

点击服务商卡片“管理”后，连接设置、Key 管理和模型管理都在同一展开区域。快捷测试和代理设置仍可单独折叠。

## 模型倍率和 Key 路由

模型绑定格式是：

```text
本地模型别名=上游模型 ID
```

例如：

```text
gpt-4o-0.05=gpt-4o
gpt-4o-0.5=gpt-4o
```

DSH 会分别统计 `gpt-4o-0.05` 和 `gpt-4o-0.5`，调用上游时再把请求体中的模型名改回 `gpt-4o`。因此可以为两个别名填写不同价格，并将它们路由到不同 API Key。

倍率名称只是分组标识，不会自动改变价格；实际价格以用量统计中填写的单价为准，性能和账户限额由对应 Key 在上游服务商侧决定。

## Key 管理

在服务商卡片的“管理”区域中，每个 Key 可以：

- 添加、编辑和保存 API Key。
- 直接启用或暂停。
- 单独获取模型列表。
- 搜索、勾选和绑定模型。
- 移除单个模型绑定。
- 设置生命周期额度。
- 查看和重置独立累计费用。

按 Key 获取模型时不会回退到默认 Key。服务商返回相同模型列表时，插件仍然会使用正确的 Key 发起后续请求。

## 推理程度

主代理没有单独设置时默认使用 `high`。如果默认模型、会话或请求明确设置了其它档位，则使用明确设置。目标模型只支持较低档位时自动选择最接近的档位；完全不支持推理的模型不会收到推理参数。

模型管理可以为每个模型配置支持的档位和实际发送值。子代理仍支持统一设置、按模型设置和会话级设置。

## 快捷测试、模型发现和代理

快捷测试可以选择当前服务商的任意模型和推理档位，发送测试提示词并查看状态、错误、耗时、token 和模型元数据。

模型发现可以读取服务商模型目录。合并 Key 后，建议在 Key 管理行中使用对应 Key 的“获取模型”，从而保留每个 Key 的独立发现结果。

本地 HTTP 代理按服务商生效，作用于正常调用、快捷测试和模型发现。支持自动检测常见端口，也支持手动填写，例如：

```text
http://127.0.0.1:7890
```

## 用量和安全

- 用量按 `provider/model` 记录，别名模型拥有独立统计键。
- 每个 Key 独立累计生命周期费用和额度。
- 达到额度后，该 Key 不再被路由使用。
- API Key 通过 DSH 凭据服务保存，不写入普通模型配置。
- `.gitignore` 已忽略 `.tgz`、依赖和环境文件；请勿提交真实密钥。

## 安装和更新

从 GitHub Release 下载 `dsh-model-manager-0.12.2.tgz`，通过 DSH 插件管理界面或对应 profile 的插件安装命令安装。更新后需要手动重启 DSH 才能加载新的 Host 和 Web bundle。

从源码打包：

```powershell
$node = 'C:\Users\你的用户名\.dsh\dsh-runtimes\dsh-primary-runtime\dependencies\node\bin\node.exe'
$pnpm = 'C:\Users\你的用户名\.dsh\dsh-runtimes\dsh-primary-runtime\dependencies\pnpm\bin\pnpm.mjs'
& $node $pnpm pack
```

## 开发和测试

主要目录：

```text
lib/index.js       Host 插件和请求处理
lib/client.js      Web 管理界面
lib/routing.js     模型别名和 Key 路由
lib/usage.js       用量、价格和 Key 费用
cordis.patch.yml  DSH bundle patch
test/              回归测试
```

运行测试：

```powershell
node --test --test-isolation=none test/*.test.mjs
```

测试覆盖 Key 路由、模型别名、并发凭据隔离、按 Key 获取模型、合并服务商、推理强度、费用持久化和额度重置。

GitHub 仓库：<https://github.com/wyfwyf123/dsh-plugin-plugin-manager>

GitHub Release：<https://github.com/wyfwyf123/dsh-plugin-plugin-manager/releases/tag/v0.12.2>
