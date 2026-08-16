# dsh-plugin-plugin-manager

[English](README.md) | 中文

增加 Plugin Manager 设置页，用于热启用和热禁用 DSH 插件；如果存在对应的 `ui-<plugin-id>` entry，也会一并管理。

在 DSH Web profile 中安装：

```powershell
pnpm dsh plugin --profile web add <Git URL for this repository>
```

bundle 会自动挂载 Host 插件和浏览器 UI。在界面中输入插件 id，或在 `settings.yaml` 中设置 `plugin-manager.plugins.<id>`，manager 会立即应用匹配的 loader entry，并为后续启动持久化状态。

设置面板使用 owner-declared Web exposure，需要支持 `installSettingsSection(..., { exposeToWeb: true })` 的 DSH runtime。DSH 0.1.0-rc.6 需要随本 release 一起更新 runtime。
