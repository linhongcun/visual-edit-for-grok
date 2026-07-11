# Visual Capture for Grok

**Version 0.4.0** · macOS (Apple Silicon)

Side-by-side workbench: **left = native Grok Build TUI**, **right = website preview**.  
**Aim** or **Frame** a UI → the app attempts an image paste + grounded DOM-context write in Grok’s PTY. If Grok is not running, text + image stay on the clipboard.
**You type what to change only in Grok** — no second prompt panel, no second coding agent.

Delivery status is deliberately honest: the app can prove that bytes were
written to a running Grok process, but it cannot prove that Grok rendered an
image chip. Verify the prompt before submitting.

```
┌──────────────────────────────────────────────────────────────────┐
│  Capture · URL · Folder · Start Grok · Aim · Frame · Re-send     │
├────────────────────┬───┬─────────────────────────────────────────┤
│  Grok · Terminal   │ ║ │  Website preview                        │
│  (type intent)     │ ║ │  Aim / Frame → capture for Grok         │
└────────────────────┴───┴─────────────────────────────────────────┘
```

---

## Install (recommended)

| Artifact | Location |
|----------|----------|
| **Installed app** | `/Applications/Visual Capture for Grok.app` |
| **Built `.app`** | `release/mac-arm64/Visual Capture for Grok.app` |
| **DMG** | `release/Visual-Capture-for-Grok-0.4.0-arm64.dmg` |

**Daily use:** open **Visual Capture for Grok** from Applications or Spotlight (⌘Space).

### Requirements

- macOS on **Apple Silicon** (`arm64`)
- **Grok Build CLI** available locally (resolved in order):
  1. `$GROK_PATH`
  2. `~/.grok/bin/grok`
  3. `~/.local/bin/grok`
  4. `/usr/local/bin/grok` or `/opt/homebrew/bin/grok`

### First launch / Gatekeeper

This is an **ad-hoc signed local** `electron-builder` build, not Developer ID
signed or notarized. If macOS blocks it:

1. Right-click the app → **Open** → **Open**, or  
2. System Settings → Privacy & Security → allow, or  

```bash
xattr -cr "/Applications/Visual Capture for Grok.app"
```

### Rebuild & reinstall later

```bash
cd visual-edit-for-grok
npm install
npm run dist          # → release/mac-arm64/*.app + release/*.dmg
cp -R "release/mac-arm64/Visual Capture for Grok.app" /Applications/
xattr -cr "/Applications/Visual Capture for Grok.app"
```

| npm script | What it does |
|------------|----------------|
| `npm run dist` | Production UI + `.app` + `.dmg` under `release/` |
| `npm run pack` | Production UI + `.app` only (no DMG) |
| `npm run dist:dmg` | DMG only (repackages) |
| `npm run dev` | Vite + Electron with hot reload (`VEFG_DEV=1`) |
| `npm start` | Build UI then run unpackaged Electron |
| `npm test` | 72 pure-helper unit tests |
| `npm run test:electron` | Build + real Electron integration smoke |
| `npm run test:packaged` | Run the same smoke against the built `.app` |
| `npm run rebuild` | Rebuild `node-pty` for Electron |
| `npm run demo` | Static demo page on `:8765` for Aim practice |

---

## Workflow

1. **Folder** — choose project root (Grok / terminal cwd); persisted across launches  
2. **Start Grok** — left PTY hands control directly to the Grok process
3. Open a preview URL (⌘R reloads **preview only**, not the terminal)  
4. **Aim** (⌘⇧A) — click a node; the app attempts to deliver screenshot + DOM context to Grok, with a clipboard fallback
5. Type the change in **Grok’s own input**, press Enter  

**Frame** (⌘⇧F) captures either **Full view** or **Target + context**. Target
mode re-resolves the selector in the current page and safely falls back to a
viewport-only capture if the target is stale.
**Re-send** (⌘⇧V) attempts to paste the last coherent capture again; if Grok is unavailable, it refreshes the clipboard fallback.
**Esc** cancels Aim.

While a capture is in flight, Aim / Frame / Re-send are disabled (**single-flight**); the status strip shows busy feedback.

---

## Features

| Area | Behavior |
|------|----------|
| Embedded terminal | `node-pty` + xterm.js; colorful `TERM` / truecolor env |
| Multimodal deliver | Screenshot → OS clipboard (file on macOS) → Ctrl+V attempt + bracketed text paste; receipt remains unconfirmed |
| DOM context | Cursor-style `browser_element` plus viewport/scroll/key styles, with sensitive attributes redacted |
| Context integrity | Selection is navigation-scoped and rechecked after capture; changed DOM/geometry is discarded instead of pairing stale context with pixels |
| Secure picker | Sandboxed preview preload + per-navigation capability IPC; page-authored console markers are ignored |
| Single-flight | Concurrent Aim / Frame / Re-send cannot double-paste |
| Pick consistency | Busy reject cancels Aim + clears highlight; selection+shot committed only on full success |
| Status honesty | PTY/Grok process split, attempted vs confirmed delivery, clipboard fallback + manual ⌘V guidance |
| Persistence | Preview URL/history, project cwd/history and split ratio in Electron `userData`; first run and legacy demo-default upgrades open a bundled guide |
| Capture cleanup | Newest ~80 files / 7 days under `~/.grok/visual-edit-captures/` (throttled, off hot path) |
| Splitter | Live layout; settings disk write debounced (flush on mouseup) |
| Focus handoff | After successful auto-deliver, focus returns to Grok terminal |
| Shortcuts | Global across terminal/preview: ⌘R preview · Esc Aim cancel · ⌘⇧A Aim · ⌘⇧F Frame · ⌘⇧V Re-send |

---

## Keyboard shortcuts

| Shortcut | Action |
|----------|--------|
| **⌘R** / **Ctrl+R** | Reload **website preview** only (does not remount the terminal) |
| **Esc** | Cancel Aim (shell, preview, or picker page) |
| **⌘⇧A** / **Ctrl⇧A** | Toggle Aim |
| **⌘⇧F** / **Ctrl⇧F** | Frame (screenshot + deliver) |
| **⌘⇧V** / **Ctrl⇧V** | Attempt to re-send the last capture; keep clipboard fallback |
| **⌘V** (inside Grok) | Manual image paste if chip did not appear |

---

## Capture payload (text part)

````text
@
```browser_element
tag: button
dom_path: main > div.cta > button#cta-secondary
id: cta-secondary
...
```

```browser_screenshot
path: /Users/…/.grok/visual-edit-captures/pick-el-….png
```
````

When the Grok PTY is alive, the app attempts to inject the image as a Grok
**image chip** and then writes the DOM text. The app does not claim the chip was
accepted; the file/image remains on the clipboard for a manual ⌘V fallback.

---

## Architecture (repo map)

```
visual-edit-for-grok/
├── electron/                 # Main process (CommonJS)
│   ├── main.cjs              # Window, BrowserView, IPC, capture pipeline
│   ├── preload.cjs           # contextBridge API (window.vefg)
│   ├── terminal.cjs          # node-pty session + grok launch
│   ├── preview-preload.cjs   # Sandboxed Aim overlay + authenticated IPC
│   ├── welcome.html          # Bundled first-run preview guide
│   ├── clipboard-payload.cjs # browser_element text builder (pure)
│   ├── delivery-status.cjs   # Paste outcome messages (pure)
│   ├── capture-cleanup.cjs   # Capture dir retention (pure)
│   ├── settings-store.cjs    # JSON settings load/save (pure)
│   └── runtime-policy.cjs    # Busy / cleanup / debounce / pick-commit (pure)
├── src/                      # Renderer (React + Vite + TypeScript)
│   ├── App.tsx               # Toolbar, status strip, splitter
│   └── components/
│       ├── TerminalPane.tsx  # xterm host + focus handoff
│       └── Icons.tsx
├── test/                     # Pure unit tests + Electron integration smoke
├── demo/                     # Optional static page for Aim practice
├── build/                    # App icons (.icns / .png) for packaging
├── dist/                     # Vite production UI (packaged into asar)
└── release/                  # electron-builder output (.app, .dmg)
```

**Data on disk**

| Path | Purpose |
|------|---------|
| `~/Library/Application Support/Visual Capture for Grok/` | Settings (`visual-capture-settings.json`) |
| `~/.grok/visual-edit-captures/` | Screenshot PNGs (capped / aged) |

---

## Development

```bash
npm install
npm run rebuild    # if terminal fails to start
npm run demo       # optional: http://127.0.0.1:8765
npm run dev        # http://127.0.0.1:5179 UI + Electron
```

Packaged default project folder is the **home directory** (Finder-launched apps often have `cwd=/`).  
Dev default is the process cwd when sensible.

### Tests

```bash
npm test
npm run test:electron
npm run test:packaged  # after npm run pack / dist
```

The pure suites import the shipped `electron/*.cjs` modules. The Electron smoke
also launches the real app with an isolated profile and fake Grok executable.

| File | Covers |
|------|--------|
| `test/clipboard-payload.test.cjs` | `browser_element` / screenshot fences |
| `test/settings-store.test.cjs` | Normalize, clamp split, round-trip |
| `test/capture-cleanup.test.cjs` | max files / max age |
| `test/deliver-helpers.test.cjs` | Payload + paste status + cleanup demo |
| `test/runtime-policy.test.cjs` | Single-flight, throttle, debounce, pick-commit |
| `test/terminal.test.cjs` | Shell quoting and truecolor environment policy |
| `test/electron-smoke.test.cjs` | Secure Aim, stale navigation, cwd, direct Grok PTY, global shortcuts |

---

## Troubleshooting

| Symptom | What to do |
|---------|------------|
| Gatekeeper / “damaged” / can’t open | `xattr -cr "/Applications/Visual Capture for Grok.app"` then right-click → Open |
| Terminal won’t start (dev) | `npm run rebuild` |
| Terminal won’t start (packaged) | `npm run dist` and reinstall the `.app` |
| No image chip in Grok | Enter a chat (not only welcome menu); status may say image is on clipboard → **⌘V**; use **Re-send** when ready |
| Busy / actions disabled | Wait for in-flight Aim/Frame/Re-send; status strip shows busy |
| ⌘R “restarts terminal” | Fixed: ⌘R only reloads preview; use **Reset term** for a new shell |
| Preview fails to load | Ensure the site is running; fix URL → Go / ⌘R |
| Grok not found | Install CLI or set `GROK_PATH` to the binary |

---

## Non-goals (by design)

- Second coding agent or style-diff / intent side panel as primary input  
- React Fiber / source-map component resolution, multi-select, cross-origin iframe pick  
- Chrome extension Option+Click workflow  
- Apple notarized / Developer ID signed distribution (local ad-hoc build only for now)
- Parsing Grok TUI pixels to detect “prompt ready”

---

## Changelog

See [CHANGELOG.md](./CHANGELOG.md).

## License

MIT
