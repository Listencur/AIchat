# AIchat

A multi-model AI chat aggregator built with Electron. Launch a single desktop window that hosts multiple AI websites in independent sessions, switch instantly, compare responses side-by-side, and keep each site's login state isolated.

## Features

- **Multiple AI sites in one window** - ChatGPT, Gemini, DeepSeek, Qwen, Grok and more
- **Independent sessions** - Each model keeps its own cookies, storage, and login state
- **Quick ask** - Send the same prompt to multiple models simultaneously
- **2 to 3 way split view** - Compare answers side by side
- **Memory control** - LRU eviction, idle reclaim, max-alive protection for active/split/busy views
- **Model deletion cleanup** - Removes partition data, cookies, and storage completely

## Tech Stack

- Electron 42
- Vanilla JavaScript (no build step, no framework)
- Node.js `node:test` for unit tests

## Project Structure

```
electron/
  main.js                    # App lifecycle, IPC handlers
  model-store.js             # Model CRUD
  session-manager.js         # Electron session/partition management
  group-store.js             # Group CRUD
  snapshot-service.js        # View snapshot persistence
  memory-manager.js          # Memory snapshot + watchdog
  view-manager.js            # Facade (delegates to lifecycle/layout/reclaimer/prompt-injector)
  view-lifecycle.js          # View create/destroy/busy/ready
  view-layout.js             # Single/split bounds, ratios, sidebar
  prompt-injector.js         # Prompt fill + send strategies per adapter
  view-reclaimer.js          # LRU + idle reclaim + protected IDs
  ipc-guard.js               # IPC sender validation
  state-store.js             # Atomic state writes with debounced persistence
  model-policy.js            # Partition derivation, capability checks
  site-adapters/             # Per-site prompt and capability adapters
  settings-normalize.js      # Settings schema + migration

src/
  index.html, quick.html, settings.html
  js/renderer.js, quick.js, settings.js, add-model.js
  css/...

test/                        # Node test suite
scripts/verify.ps1           # Pre-release verification
data/models.example.json     # Example user models config
```

## Getting Started

```bash
npm install
npm start              # Launch the app
npm run dev            # Launch with DevTools
npm test               # Run unit tests
```

On first launch, the app reads `data/models.json`. A starter config is provided as `data/models.example.json`.

```bash
cp data/models.example.json data/models.json
```

## Build

```bash
npm run build:launcher      # Rebuild the AiChat.exe launcher
npm run dist:portable       # Build a portable distribution
```

## Pre-Release Verification

```bash
npm test
node --check electron/main.js
node --check electron/view-manager.js
node --check electron/preload.js
node --check src/js/renderer.js
node --check src/js/quick.js
node --check src/js/settings.js
npm run dist:portable
```

A helper script `scripts/verify.ps1` runs all of the above on Windows.

## Configuration

`data/models.json` accepts a list of models:

```json
{
  "configVersion": 1,
  "models": [
    {
      "id": "chatgpt",
      "name": "ChatGPT",
      "url": "https://chatgpt.com",
      "icon": "💬",
      "color": "#10a37f",
      "partition": "persist:chatgpt"
    }
  ]
}
```

## Privacy

This repository contains no personal data, no session records, and no saved credentials. The `.gitignore` excludes:

- Chat records (会话记录*)
- User `data/models.json` (a `.example.json` template is committed instead)
- Build artifacts (`*.exe`, `dist/`, `build/`, `*.log`)
- Dependencies (`node_modules/`)
- Editor state (`.vscode/`, `.idea/`)

## Architecture Notes

- All IPC handlers return `{ ok: true, data }` or `{ ok: false, reason, message? }`. List endpoints return `[]` on failure.
- Auto-reclaim (`view-reclaimer.js`) never destroys active, split, or busy views.
- A destroyed `WebContents` rejects any further `executeJavaScript` calls. Quick-ask submissions targeting a removed view return `view-not-loaded` instead of crashing.
- Sites that are not in `site-adapters/registry.js` fall back to a conservative generic-fill adapter that only fills the prompt and never simulates Enter.

## License

MIT
