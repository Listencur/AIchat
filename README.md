# AIchat

[![Electron](https://img.shields.io/badge/Electron-42-47848F?logo=electron)](https://www.electronjs.org/)
[![Node](https://img.shields.io/badge/Node-%E2%89%A518-green?logo=node.js)](https://nodejs.org)
[![Tests](https://img.shields.io/badge/Tests-270%20passing-brightgreen)](./test)
[![License](https://img.shields.io/badge/License-MIT-blue)](./LICENSE)

A multi-model AI chat aggregator built with Electron. One desktop window hosts multiple AI websites in independent sessions; switch instantly, compare responses side by side, and keep each site's login state isolated.

---

## Table of Contents

1. [What is AIchat?](#what-is-aichat)
2. [Features](#features)
3. [Architecture](#architecture)
4. [Quick Start](#quick-start)
5. [Configuration](#configuration)
6. [Usage](#usage)
7. [Build & Release](#build--release)
8. [Testing](#testing)
9. [Privacy](#privacy)
10. [Project Structure](#project-structure)
11. [Extending](#extending)
12. [Troubleshooting](#troubleshooting)
13. [Contributing](#contributing)
14. [License](#license)

---

## What is AIchat?

AIchat is a single Electron application that opens **multiple AI websites inside one window**. Each site runs in its own `WebContentsView` with a dedicated Electron session, so its cookies, localStorage and IndexedDB never leak into the others. The sidebar lists your added models; click one and the view swaps in. A separate *Quick Ask* window can fire the same prompt at several models at once and return per-model results keyed by `modelId`.

The app is a long-running companion tool, not a one-shot client. It is built for users who routinely use more than one AI site and want a stable desktop wrapper instead of juggling tabs.

---

## Features

- **Multi-site aggregation** - ChatGPT, Gemini, DeepSeek, Qwen, Grok and any other URL through the *generic-fill* adapter
- **Independent sessions** - each model has its own `persist:` partition; logging out of one does not affect the others
- **Quick Ask window** - send one prompt to several models in parallel; results returned by `modelId`
- **Split view** - 2 or 3 way comparison with adjustable ratios
- **Memory control** - LRU eviction, idle reclaim after a configurable timeout, hard cap on alive views, active/split/busy views are never auto-reclaimed
- **Model deletion cleanup** - removes partition data, cookies, cache, IndexedDB, localStorage and service workers for that model only
- **Stable IPC** - every channel returns `{ ok: true, data }` or `{ ok: false, reason, message? }`
- **Conservative adapter fallback** - unrecognised sites only fill the prompt and never simulate Enter
- **Atomic state writes** - debounced, revision-tracked persistence through `StateStore`
- **270 unit and integration tests** - `node:test` based, no real account or cookie data used

---

## Architecture

```
electron/  Main process  (lifecycle, IPC, sessions, persistence)
   |
   +-- model-store / session-manager / group-store
   +-- snapshot-service / memory-manager
   +-- view-manager (facade)
        +-- view-lifecycle / view-layout / view-reclaimer
        +-- prompt-injector
   +-- ipc-guard / state-store / model-policy
   +-- site-adapters/  Per-site adapter registry

src/       Renderer      (sidebar UI, quick ask window, settings window)
test/      Unit tests    (node:test)
data/      User data     (models.json lives here, not tracked)
```

The main process is intentionally split into small focused modules. `view-manager.js` is now a thin facade that re-exports the four lifecycle, layout, reclaimer and prompt-injector modules.

### Key invariants

- An **active** view is never reclaimed by the LRU/idle reclaimer.
- A **split** view is never reclaimed.
- A **busy** view (a submission is in flight) is never reclaimed.
- A **destroyed** `WebContents` rejects any further `executeJavaScript` call; quick-ask targeting such a view returns `{ ok: false, reason: 'view-not-loaded' }` instead of crashing.
- `ensureView(modelId)` only runs one creation Promise at a time per model.
- `removeView` clears `splitIds`, `activeId` and any `busyReason` for that model.

### IPC contract

All renderer-facing IPC handlers return:

```js
{ ok: true, data: <payload> }   // success
{ ok: false, reason: 'code', message?: 'human readable' }   // failure
```

List endpoints return `[]` on failure (and `{ ok: false, reason }` via the wrapper). Status-shaped endpoints return a complete empty status object on failure. Boolean commands return `{ ok, reason }` only.

---

## Quick Start

### Prerequisites

- Node.js 18 or later
- Windows 10/11 (primary target), macOS or Linux should also work
- npm (bundled with Node)

### Install and launch

```bash
git clone https://github.com/Listencur/AIchat.git
cd AIchat
npm install
npm start
```

The window opens at 1200 x 800 with the default model list from `data/models.example.json`. Copy that file to `data/models.json` the first time if you want to edit it locally:

```bash
# Linux / macOS / Git Bash
cp data/models.example.json data/models.json

# PowerShell
Copy-Item data/models.example.json data/models.json
```

`data/models.json` is in `.gitignore`, so your edits stay local.

### Other launch modes

```bash
npm run dev          # Same as start, but the BrowserWindow opens with DevTools
npm test             # Run the node:test suite (no Electron required)
npm run dist:portable    # Build a portable Windows .exe via electron-builder
npm run build:launcher   # Rebuild the AiChat.exe launcher wrapper
```

---

## Configuration

### `data/models.json`

The model list lives in this file. It is created on first launch if absent. Any field you add must still parse through the JSON loader (no required schema migrations today).

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
    },
    {
      "id": "gemini",
      "name": "Gemini",
      "url": "https://gemini.google.com",
      "icon": "✨",
      "color": "#4285f4",
      "partition": "persist:gemini"
    }
  ]
}
```

Field notes:

| Field | Required | Notes |
|---|---|---|
| `id` | yes | Unique within the file. The Electron partition is derived from `id` (see `electron/model-policy.js`). |
| `name` | yes | Display name in the sidebar. |
| `url` | yes | Starting URL for the view. Must be HTTPS for production sites; local file/http URLs are allowed for testing. |
| `icon` | no | Emoji or short string. Rendered in the sidebar chip. |
| `color` | no | CSS color string used for the sidebar accent. |
| `partition` | no | Override the derived Electron partition. Most users do not need this. |

### Adding a model at runtime

The settings window has an *Add model* form that posts through the `models:add` IPC channel. The same channel is exposed to any renderer; the form is just a UI surface.

### Settings window

Left navigation:

1. **General** - launch behaviour, theme
2. **Memory** - idle reclaim minutes, max alive count, dropdown defaults
3. **Data** - clear cache, clear login state, delete model
4. **Shortcuts** - global hotkeys
5. **Network** - proxy on/off, proxy URL

Right panel scrolls independently of the dialog when content exceeds available height.

---

## Usage

### Switching models

Click any sidebar chip. The active view is replaced by the selected model's view. Switching ten times in a row does not create duplicate views, because `ensureView(modelId)` deduplicates in-flight creation Promises.

### Quick Ask

Open the Quick Ask window (shortcut). Type a prompt, tick the target models, press **Send**. Each model returns a result:

```js
{
  "chatgpt": { ok: true, reason: 'submitted' },
  "gemini":  { ok: false, reason: 'requiresManualSend', requiresManualSend: true },
  "deepseek":{ ok: true, reason: 'submitted' }
}
```

If a model is not in the registry it uses *generic-fill*: the prompt is inserted, but **Enter is never simulated**. A visible banner reminds you to press Enter yourself.

### Split view

Click *Split* in the sidebar, then pick up to two more models. Drag the divider to change ratios. Ratios persist per session through `group-store`. **Only split models may be auto-reclaimed after the session ends.**

### Removing a model

Settings -> Data -> *Delete model*. The deletion pipeline:

1. Removes the model from `models.json`
2. Removes it from `groups`
3. Removes it from the snapshot cache
4. Removes it from quick-ask history
5. Destroys any active or split `WebContentsView`
6. Clears cookies, filesystem, IndexedDB, localStorage, service workers, cache storage, WebSQL, auth cache
7. Removes the partition directory under `userData/Partitions`
8. Deletes the model's copied local icon, if any
9. Returns `{ ok, modelId, partition, sessionCleared, diskRemoved }`

Failures are logged, do not crash the app, and never leave the partition half-deleted without a trace.

### Memory control

Watchdog reads the current memory snapshot every N seconds and:

- **Idle reclaim**: views that have been inactive for longer than the configured threshold are reclaimed, **unless** they are active, split, busy, or in the protected set.
- **Max alive**: if the alive count exceeds the configured cap, the oldest non-protected view is reclaimed.
- **Max alive = 0** disables the cap.
- **Default idle threshold**: 30 minutes. **Default behaviour**: keep alive whenever possible.

Reclaim notifications are sent via `memory:reclaimNotice` to the renderer so the sidebar can update the icon without polling.

---

## Build & Release

### Pre-release checklist

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

Windows users can run `scripts/verify.ps1` instead.

### Building a portable Windows build

```bash
npm run build:launcher   # Produces AiChat.exe launcher
npm run dist:portable    # Produces <productName>-<version>-portable.exe
```

Configuration lives in `package.json -> build` (electron-builder). Output directory defaults to `../AI聊天聚合打包版`; change it there if needed.

### What is in a release

- The Electron app bundle (main process + renderer + assets)
- A portable single-file .exe wrapper
- No telemetry, no auto-update channel

### What is NOT in a release

- `node_modules/`
- `*.exe` source builds (`AiChat.exe` is git-ignored)
- `data/models.json` (per user)
- Chat history files
- Anything under `userData/Partitions`

---

## Testing

```bash
npm test
```

Tests use `node:test` and run under a plain Node process - no Electron required.

| File | Covers |
|---|---|
| `test/ipc-contract.test.js` | Every IPC channel's success/failure shape |
| `test/ipc-guard.test.js` | Sender validation |
| `test/state-store.test.js` | Atomic debounced writes |
| `test/model-store.test.js` | Model CRUD |
| `test/session-manager.test.js` | Partition cleanup, session lifecycle |
| `test/group-store.test.js` | Group CRUD |
| `test/snapshot-service.test.js` | Snapshot persistence, origin check |
| `test/memory-manager.test.js` | Watchdog + reclaim |
| `test/view-lifecycle.test.js` | ensure/destroy/busy/ready |
| `test/view-layout.test.js` | Split/single bounds + ratios |
| `test/prompt-injector.test.js` | Prompt fill + send strategies |
| `test/view-reclaimer.test.js` | LRU + idle + protected |
| `test/site-adapters.test.js` | Per-site adapter matching |
| `test/settings-normalize.test.js` | Settings schema + migration |
| `test/integration.test.js` | Cross-module flows with mocks |
| `test/phase2-concurrency.test.js` | Quick ask concurrency + busy protection |

270 tests in total. **No test uses a real account, real cookie, or real partition.**

---

## Privacy

This repository contains **no personal data**:

| Category | Excluded via |
|---|---|
| Chat history | `会话记录*/`, `聊天记录*/` |
| User model list | `data/models.json` (a `.example.json` is committed instead) |
| Build outputs | `*.exe`, `dist/`, `build/` |
| Dependencies | `node_modules/` |
| Logs | `*.log`, `error.log` |
| Editor state | `.vscode/`, `.idea/`, `.DS_Store`, `Thumbs.db` |
| Internal plans | `.opencode/` |

The Electron `userData` directory holds partition data per model. That directory **never** gets committed.

---

## Project Structure

```
.
|-- electron/
|   |-- main.js                  App lifecycle, IPC handlers (~925 LoC)
|   |-- preload.js               contextBridge IPC surface
|   |-- model-store.js           Model CRUD, ID generation, icon handling
|   |-- session-manager.js       Partition + cleanup
|   |-- group-store.js           Group CRUD
|   |-- snapshot-service.js      Snapshot persistence + origin checks
|   |-- memory-manager.js        Watchdog + reclaim notifications
|   |-- view-manager.js          Facade (delegates below)
|   |-- view-lifecycle.js        ensure/create/destroy/busy/ready
|   |-- view-layout.js           bounds + ratios + sidebar state
|   |-- prompt-injector.js       fill + send strategies
|   |-- view-reclaimer.js        LRU + idle + protected IDs
|   |-- ipc-guard.js             Sender validation
|   |-- state-store.js           Atomic debounced writes
|   |-- model-policy.js          Partition derivation, capability checks
|   |-- settings-normalize.js    Settings defaults + migration
|   |-- session-header-hooks.js  Optional header injection for managed sessions
|   |-- site-adapters.js         Adapter facade
|   \-- site-adapters/
|       |-- registry.js
|       |-- chatgpt.js
|       |-- deepseek.js
|       |-- gemini.js
|       |-- qwen.js
|       |-- grok.js
|       \-- generic-fill.js
|
|-- src/
|   |-- index.html               Sidebar UI host
|   |-- quick.html               Quick Ask window
|   |-- settings.html            Settings window
|   |-- css/
|   \-- js/
|
|-- test/                        node:test suites
|-- scripts/verify.ps1           Pre-release verification (Windows)
|-- data/models.example.json     Template for your local models.json
|-- assets/app-icon.svg
|-- assets/app-icon.ico
|-- assets/app-icon.png
|-- package.json
|-- README.md                    (this file)
|-- LICENSE                      MIT
\-- .gitignore
```

---

## Extending

### Add a new site adapter

1. Create `electron/site-adapters/<name>.js`:

   ```js
   'use strict';
   const ADAPTER_ID = 'my-site';

   function matches(url) {
     return typeof url === 'string' && url.includes('mysite.example');
   }

   const myAdapter = {
     id: ADAPTER_ID,
     matches,
     prompt: {
       inputSelectors: ['textarea[aria-label="Ask"]'],
       sendSelectors:  ['button[aria-label="Send"]'],
       inputStrategy:  'native-value',
       sendStrategy:   'click',
     },
     page: {
       readySelectors:   ['div[data-test-id="conversation"]'],
       loadingSelectors: ['div[data-loading="true"]'],
     },
     capabilities: {
       canAutoSend:  true,
       canFillPrompt: true,
     },
   };

   module.exports = myAdapter;
   ```

2. Register it in `electron/site-adapters/registry.js`:

   ```js
   const myAdapter = require('./my-site');
   adapters.push(myAdapter);
   ```

3. Add a unit test in `test/site-adapters.test.js` covering `matches()` for real and near-miss URLs.

4. Run `npm test` and `npm start` against the new site.

### Add a new IPC channel

1. Implement the handler in the relevant module (do not bloat `main.js`).
2. Expose it in `electron/preload.js`.
3. Document the success and failure shapes in `test/ipc-contract.test.js`.
4. Run `npm test`.

### Add a new module

- Use dependency injection for `app`, `session`, `fs`, `path`.
- Do not call `mainWindow.webContents.send` directly - return a value and let `main.js` notify the renderer.
- Add a `test/<module>.test.js` covering every public function.

---

## Troubleshooting

### The view stays white after switching models

The site's frontend may have lost its session because the partition was cleared. Check Settings -> Data -> *Clear login state* and re-login manually.

### `require failed: electron`

You ran a script outside an Electron context. Use `npm start` for runtime code, `npm test` for tests.

### The portable build does not start on another machine

The target machine likely needs the [Visual C++ Redistributable](https://learn.microsoft.com/en-us/cpp/windows/latest-supported-vc-redist) that Electron 42 links against.

### `data/models.json` disappeared after `git pull`

That file is intentionally git-ignored. Restore it from `data/models.example.json` and re-add your models.

### A site breaks after the site's frontend changes

Adapters live in `electron/site-adapters/`. Update the `inputSelectors`/`sendSelectors` and bump the version comment in the file. Run the local smoke test (login -> fill prompt -> submit) before committing.

---

## Contributing

Issues and PRs are welcome. Before opening one:

1. Run `npm test` and confirm 270 passing.
2. Run `node --check` on every file you touch.
3. Run `scripts/verify.ps1` on Windows.
4. Add tests for any new code path. Public functions without tests are a regression risk.
5. Do not commit secrets, real cookies, or chat history.

For site adapter changes, prefer *generic-fill* over hard-coded selectors if a site's DOM is unstable. The app must never simulate Enter unless an adapter explicitly opts in via `capabilities.canAutoSend`.

---

## License

MIT - see [LICENSE](./LICENSE).
