# WebLLM

**WebLLM** is a Chrome extension that runs a vision-language model entirely in your browser. Ask questions about what is on your screen — or chat in text-only mode — with streaming answers and no backend server.

Everything inference-related stays on your machine. There is no telemetry, no analytics, and no saved chat history.

[![License: MIT](https://img.shields.io/badge/License-MIT-blue.svg)](LICENSE)

---

## What it does

1. You open the WebLLM popup and type a question.
2. With **Screen** on, the extension captures a JPEG of your active tab, compresses it, and sends it to a local vision model.
3. With **Screen** off, it answers from your prompt only (no screenshot).
4. The model streams tokens back into the chat UI.
5. When the response finishes, prompts and screenshots are cleared from memory.

First launch downloads the **Gemma 4 E2B** model from Hugging Face (~3 GB, one time). After that, weights are cached in browser storage and later sessions start much faster.

---

## Requirements

| Requirement | Notes |
|-------------|--------|
| **Google Chrome 124+** | WebGPU in offscreen documents |
| **~4 GB free disk** | Model weights + ONNX Runtime WASM |
| **WebGPU** (recommended) | Falls back to CPU automatically if unavailable |
| **Network (first run only)** | Downloads public model files from `huggingface.co` |

---

## Install (developers)

### 1. Clone and build

```bash
git clone https://github.com/yelloworangebananaa/WebLLM.git
cd WebLLM
npm install
npm run build
```

On Windows you can also run:

```powershell
.\build.cmd
```

### 2. Load in Chrome

1. Open `chrome://extensions`
2. Enable **Developer mode**
3. Click **Load unpacked**
4. Select the **`dist`** folder inside the repo

> **Important:** Load `dist/`, not `extension/`. The `dist` folder is the built extension Chrome actually runs.

### 3. First use

- Open the extension popup.
- Wait for the model download (progress bar + status pill).
- When status shows **WebGPU active** or **CPU fallback**, you can send a message.

---

## How to use

| Control | Behavior |
|---------|----------|
| **Screen ON** | Captures the active tab, then answers with vision |
| **Screen OFF** | Text-only chat — no screenshot |
| **Send** | Starts a request; input locks until the response finishes |
| **Stop** | Cancels the current request |

**Tips**

- Screen mode does not work on `chrome://` or `chrome-extension://` pages — open a normal website first.
- Only one request runs at a time. You must wait for a response or press **Stop** before sending again.
- Answers stream in token-by-token as the model generates them.

---

## How it works

### Architecture

WebLLM uses Manifest V3 with an **offscreen document** as the main runtime. The service worker is a thin router.

```
┌─────────┐     ┌──────────────────┐     ┌─────────────────────────────┐
│  Popup  │────▶│  background.js   │────▶│  offscreen.js (full runtime) │
│  (UI)   │◀────│  (stateless relay)│◀────│  model · queue · compression │
└─────────┘     └──────────────────┘     └─────────────────────────────┘
                         │
                         ▼
                 Tab JPEG capture (Screen ON)
```

| Layer | Role |
|-------|------|
| **`popup.js`** | Chat UI, streaming display, composer lock, Screen toggle |
| **`background.js`** | Ensures offscreen doc exists; forwards messages; captures visible tab |
| **`offscreen.js`** | Model lifecycle, inference queue, image compression, tab cache |

### Request flow (Screen ON)

1. Popup sends `ASK` with `requestId`, question, tab/window IDs.
2. Background captures the visible tab as JPEG (quality 50).
3. Offscreen enqueues the request (depth 1 — one at a time).
4. Screenshot is hashed; if unchanged, a cached compressed image is reused.
5. Image is resized based on content type (text-heavy vs image-heavy) and device (WebGPU vs CPU).
6. **Gemma 4 E2B** (`onnx-community/gemma-4-E2B-it-ONNX`) runs via `@huggingface/transformers` v4.
7. Tokens stream back: `STREAM_TOKEN` → popup.
8. Buffers are cleared; optional preflight keeps the GPU context warm.

### Model and inference

- **Model:** [Gemma 4 E2B Instruct ONNX](https://huggingface.co/onnx-community/gemma-4-E2B-it-ONNX) at `q4f16` quantization
- **Runtime:** ONNX Runtime Web (WebGPU primary, WASM CPU fallback)
- **Decoding:** Staged generation (fast first phase, optional continuation)
- **Abort:** Stop button triggers `InterruptableStoppingCriteria`

### Adaptive capture

Screenshots are analyzed for edge density and color variance to pick a resolution tier:

| Profile | Typical max width (WebGPU) |
|---------|----------------------------|
| Text-heavy UI | 720px |
| Image-heavy | 512px |
| CPU fallback | 480px |

If inference is repeatedly slow, resolution can degrade further automatically.

---

## Privacy

| Data | Persisted? |
|------|------------|
| Your prompts | **No** — cleared after each request |
| Screenshots | **No** — in-memory only for the active request |
| Tab snapshot cache | **No** — in-memory only (max 3 tabs), cleared on extension unload |
| Model weights | **Yes** — browser cache (IndexedDB) so ~3 GB is not re-downloaded every time |

**Network:** The extension only contacts **public Hugging Face URLs** for model files. No custom backend, no telemetry, no prompt logging.

**Permissions:**

- `activeTab` / `tabs` — screen capture and tab context
- `offscreen` — long-running model inference
- `alarms` — idle preflight / health checks
- `https://huggingface.co/*` — model weight download

---

## Project structure

```
WebLLM/
├── extension/              # Source code (edit here)
│   ├── manifest.json       # Extension manifest
│   ├── popup.html/js/css   # Popup UI
│   └── inference/
│       ├── background.js   # Stateless service worker router
│       ├── offscreen.js    # Application core (model + queue)
│       ├── modelRunner.js  # Gemma load, stream, abort, preflight
│       ├── screenCapture.js# Capture compression + content profiling
│       ├── tabCache.js     # In-memory per-tab screenshot cache
│       ├── requestQueue.js # Single-flight request queue
│       ├── promptBuilder.js
│       ├── config.js
│       └── state.js
├── dist/                   # Built extension (generated — load this in Chrome)
├── tests/                  # Unit tests
├── vite.config.js          # Build: bundle JS + copy WASM assets
├── package.json
├── build.cmd               # Windows build helper
├── DESIGN.md               # UI tokens and component states
├── LICENSE                 # MIT
└── README.md               # This file
```

### Source vs `dist/`

| Folder | Purpose |
|--------|---------|
| **`extension/`** | Human-readable source you edit |
| **`dist/`** | Production bundle from `npm run build` — **upload this to Chrome Web Store** |
| **`node_modules/`** | npm dependencies (not committed) |

The build bundles `popup`, `background`, and `offscreen` entry points, copies `manifest.json`, HTML, CSS, and ONNX Runtime WASM into `dist/transformers/`.

---

## Development

```bash
npm run dev    # Watch mode — rebuilds dist/ on change
npm run build  # Production build
npm test       # Run unit tests (tab cache)
```

After changing source under `extension/`, rebuild and click **Reload** on `chrome://extensions`.

See [`DESIGN.md`](DESIGN.md) for popup UI conventions.

---

## Publishing

This is a **Chrome extension**, not an Android app.

| Destination | What to upload |
|-------------|----------------|
| **Chrome Web Store** | ZIP of **`dist/` contents** (after `npm run build`) |
| **GitHub** | This repository (source); do not commit `node_modules/` or `dist/` |

You will also need store listing assets (icons, screenshots, privacy policy URL) before public release.

---

## Troubleshooting

| Issue | What to try |
|-------|-------------|
| Stuck on "Downloading model" | Wait for ~3 GB download; check Hugging Face access |
| "WebGPU unavailable" | CPU mode is slower but should still work |
| Screen capture failed | Extension falls back to text-only for that request |
| "Cannot capture Chrome internal pages" | Open a normal `https://` website |
| Model load error | Reload the extension at `chrome://extensions` |
| Changes not showing | Run `npm run build` and reload the extension |

---

## License

This project is licensed under the **MIT License** — see [LICENSE](LICENSE).

```
Copyright (c) 2026 WebLLM contributors
```

### Third-party

- **[Gemma](https://ai.google.dev/gemma/terms)** — model weights subject to Google's Gemma terms
- **[@huggingface/transformers](https://www.npmjs.com/package/@huggingface/transformers)** — Apache 2.0
- **[ONNX Runtime Web](https://github.com/microsoft/onnxruntime)** — MIT

---

## Contributing

Issues and pull requests are welcome at [github.com/yelloworangebananaa/WebLLM](https://github.com/yelloworangebananaa/WebLLM).

1. Fork the repo
2. Create a branch
3. Edit under `extension/`
4. Run `npm test` and `npm run build`
5. Open a pull request
