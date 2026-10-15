# dsh-model-manager

DeepSeek Harness plugin for managing model providers, model catalogs, reasoning levels, provider proxies, merged API-key groups, model discovery, diagnostics, usage, and pricing.

## Features

- Manage provider connection settings and model catalogs.
- Add a new API key and model pricing group into an existing provider.
- Keep merged keys, aliases, usage, and lifetime spend separate while sharing one provider URL and proxy.
- Set the main agent default reasoning level to `high`, with per-model capability fallback.
- Configure subagent reasoning levels, model selection, redirects, and failover.
- Run quick tests, model discovery, diagnostics, and usage accounting.

## Development

The package is loaded by DeepSeek Harness. After changing the plugin, package it with the DSH runtime's pnpm and restart DSH to load the new bundle.

Run the regression suite with:

```powershell
node --test --test-isolation=none test/*.test.mjs
```

The repository contains the plugin source under `lib/` and regression tests under `test/`.
