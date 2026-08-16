# dsh-plugin-plugin-manager

English | [中文](README.zh.md)

Adds a Plugin Manager settings page for hot-enabling and hot-disabling DSH plugins, including a companion `ui-<plugin-id>` entry when it exists.

Install it in a DSH Web profile:

```powershell
pnpm dsh plugin --profile web add <Git URL for this repository>
```

The bundle automatically mounts both the Host plugin and its browser UI. Add a plugin id in the UI or set `plugin-manager.plugins.<id>` in `settings.yaml`; the manager applies the matching loader entry immediately and persists the state for later launches.

The settings panel uses owner-declared Web exposure. It requires a DSH runtime that supports `installSettingsSection(..., { exposeToWeb: true })`; DSH 0.1.0-rc.6 needs the accompanying runtime update documented with this release.
