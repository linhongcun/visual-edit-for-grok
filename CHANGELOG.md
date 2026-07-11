# Changelog

All notable changes to **Visual Capture for Grok** are documented here.

## [0.4.0] — 2026-07-11

### Context integrity

- Navigation-scoped Aim selections: URL, navigation token/id, trusted source,
  viewport and scroll state travel with the captured DOM context.
- Target Frame re-resolves the selector in the current document. A navigation,
  missing target or stale context falls back to a viewport-only capture and
  drops the old DOM instead of pairing it with new pixels.
- Aim and target Frame verify navigation, viewport, geometry and emitted DOM
  fields again after screenshot capture; a moving or changing target is discarded.
- Frame now has explicit **Full view** and **Target + context** modes, with a
  larger adaptive context crop.
- Compact computed styles and viewport metadata are included in the Grok text;
  secret-like attributes and URL credentials/query values are redacted.

### Secure preview boundary

- Replaced the page-spoofable `console.log` picker transport with a sandboxed,
  isolated preview preload and authenticated IPC capability rotated per
  navigation.
- Aim events are accepted only from the current main frame while Aim is active.
- Both renderer surfaces now use Electron sandboxing; preview permissions and
  external URL schemes are restricted.

### Terminal and delivery truthfulness

- **Start Grok** now gives the PTY directly to the Grok process, so the app can
  distinguish a shell from a running Grok process and prevent duplicate starts.
- Changing Folder restarts the shell in the selected directory; the visible
  project path and the process's real `pwd` can no longer diverge. Switching
  while Grok is active requires confirmation before the session is stopped.
- Delivery reports `attempted` versus `confirmed` explicitly. Image attachment
  and Grok receipt are never claimed without an acknowledgement.
- The image/file clipboard is restored after automatic delivery so manual ⌘V
  remains a reliable fallback.

### Workflow and UI

- Bundled first-run welcome replaces the failing localhost demo default,
  including a versioned migration for existing 0.3 settings.
- Preview URL, history availability and loading state stay synchronized.
- Aim / Frame / Re-send shortcuts work while the native preview owns focus.
- Compact last-capture receipt shows target, page, timestamp, path, Frame mode
  and delivery status.
- Splitter supports keyboard arrows, Shift acceleration, Home/End and ARIA
  values; blocked remote font imports were removed.

### Runtime and verification

- Electron `43.1.0` and `@electron/rebuild` `4.2.0`; official-registry audit is
  clean and the arm64 `node-pty` ABI is rebuilt for Electron 43.
- macOS bundles use an explicit ad-hoc signature for local integrity checks;
  Developer ID signing and notarization remain out of scope.
- 72 pure-helper tests plus an Electron/CDP integration smoke covering secure
  Aim, forged-message rejection, stale-navigation fallback, real cwd, direct
  Grok process state, duplicate launch prevention and preview-focused shortcuts.

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
