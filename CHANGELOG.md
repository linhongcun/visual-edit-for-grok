# Changelog

All notable changes to **Visual Capture for Grok** are documented here.

## [0.3.0] — 2026-07-11

### Packaging

- macOS **Apple Silicon** app via `electron-builder`
  - `Visual Capture for Grok.app` under `release/mac-arm64/`
  - DMG: `release/Visual-Capture-for-Grok-0.3.0-arm64.dmg`
- App icon (`.icns` / PNG) under `build/`
- `node-pty` unpacked from asar for native terminal support
- Scripts: `npm run dist` / `pack` / `dist:dmg`
- Packaged default project cwd = home directory (safe for Finder launch)

### Stability

- **Single-flight** capture lock: overlapping Aim / Frame / Re-send cannot double-paste
- **Busy** UI: Aim / Frame / Re-send disabled while in flight; status strip feedback
- **Pick commit policy** (`planAimPickEvent` / `resolvePickCommit`):
  - Busy reject still cancels Aim and clears sticky highlight
  - `lastSelection` + `lastScreenshotPath` commit only on full success
  - Failure keeps the previous coherent pair (Re-send never pairs new DOM with old/missing frame)

### Efficiency

- Capture-dir cleanup **deferred + throttled** (not a blocking walk on every capture)
- Single PNG write per capture (crop in memory; no dual full+crop files)
- Splitter settings **debounced** to disk (force flush on mouseup)

### UX

- Coordinated post-deliver **focus handoff** to Grok terminal (no multi-timeout storms)
- Honest multimodal / clipboard-fallback status messages
- English operator copy aligned with toolbar (terminal exit / start errors)
- Titlebar drag region; ⌘R reloads **preview only**
- Esc cancels Aim from shell, preview, and picker

### Architecture / tests

- Pure modules: `runtime-policy`, `settings-store`, `capture-cleanup`, `delivery-status`, `clipboard-payload`
- Unit suite covering payload, settings, cleanup, delivery status, runtime policy (including pick-commit fixtures)

### Product scope (confirmed)

- Capture → multimodal into **native Grok TUI** only  
- No Enrichment / style-diff side panel; intent typed only in Grok  

---

## [0.2.x] — earlier (summary)

- Electron shell: left terminal + right `BrowserView` preview  
- Aim picker inject + element screenshot crop  
- Multimodal path: macOS file clipboard + Ctrl+V image chip + text paste  
- Settings persistence: URL / cwd / split ratio  
- Shortcuts: Aim / Frame / Re-send; Cmd+R preview-only  
- Removed Shot card and post-pick enrichment panel from the primary flow  

---

## Legend

- **Aim** — pick a DOM node in the preview  
- **Frame** — screenshot preview (optional crop around last target)  
- **Re-send** — re-deliver last committed capture into Grok  
