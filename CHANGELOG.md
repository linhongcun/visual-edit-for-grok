# Changelog

All notable changes to **Visual Capture for Grok** are documented here.

## [0.5.4] — 2026-07-11

### Multi-terminal operator consistency

1. **Active-tab UI single-source** — tab switch still fully resets shell/Grok/cwd via `resolveActiveTabUiState` policy (no sticky Start Grok).
2. **Distinct tab labels** — same folder basename → `parent/name` or short id suffix (`displayLabelForTab` / `withDisplayLabels`).
3. **Close with Grok confirms** — closing a tab where Grok is running asks first; cancel keeps the tab; shell-only close is one click.
4. **Tests** — terminal-hub fixtures for labels + close-confirm; runtime-policy active-tab resolve.

## [0.5.3] — 2026-07-11

### Per-tab Grok / shell UI state

- Switching terminal tabs fully resets Folder / Start Grok / status to the **active** tab
- Shell-only tabs no longer stick on “Grok requested” from another tab
- Pure `resolveActiveTabUiState` + unit tests

## [0.5.2] — 2026-07-11

### Pane-scoped controls

- **Terminal chrome**: tabs + Folder / Start Grok / Reset for the **active** tab
- **Preview chrome**: URL + Aim / Frame / Re-send (capture targets the active terminal)
- Top bar is app chrome only (brand, language, expand when preview hidden)

## [0.5.1] — 2026-07-11

### Quit confirm only when Grok is running

- Closing the app no longer prompts for a bare shell/PTY
- Dialog appears only if at least one terminal tab has **Grok** running
- Copy updated to match (EN / 中文)

## [0.5.0] — 2026-07-11

### Multi-terminal tabs

1. **Multiple terminals** — open up to 6 independent PTY sessions in tabs (parallel projects).
2. **Per-tab folder / Grok** — Folder and Start Grok apply to the **active** tab; each tab can run its own Grok.
3. **Capture routing** — Aim / Frame / Re-send paste into the **active** terminal only.
4. **Persisted tabs** — session list + active id saved in settings (shells restart on launch).
5. **Tests** — `electron/terminal-hub.cjs` registry covered by unit tests.

## [0.4.7] — 2026-07-11

### Collapsible website preview

1. **Collapse preview** — hide the right website pane so the Grok terminal uses full width (for CLI-only work).
2. **URL chrome grouped with the page** — back / forward / reload / URL / Go live in a preview header; collapsing hides them together.
3. **Expand control** — toolbar **Preview** button when collapsed; Aim / Frame auto-expand the pane.
4. **Persisted** — `previewCollapsed` in settings; BrowserView bounds go to zero when collapsed.
5. **Tests** — `computeWorkspaceLayout` + settings round-trip for `previewCollapsed`.

## [0.4.6] — 2026-07-11

### Operator polish (actionable errors, quit safety)

See [docs/OPERATOR-POLISH.md](./docs/OPERATOR-POLISH.md).

1. **Actionable failures** — pure `buildActionableError` / `inferOperatorErrorCode` with next-step guidance for preview, Grok missing/launch, terminal start, nothing-to-resend, busy, invalid URL; wired into main throws + renderer toasts.
2. **Status clarity** — shell on/off labels separate from Grok state; unknown state label; ready still requires explicit ready signal.
3. **Quit safety** — window close and app quit confirm when the embedded session is alive; confirmed quit disposes the PTY (stops Grok).
4. **Tests** — `test/operator-guidance.test.cjs` drives the shipped helper.

## [0.4.5] — 2026-07-11

### Next-round polish (list → execute)

See also [docs/NEXT-POLISH.md](./docs/NEXT-POLISH.md).

1. **Structured delivery outcomes** — `classifyDeliveryOutcome` kinds (`image-attempted`, `text-attempted`, `clipboard-only`, `local-only`, `failed`) with short EN/中文 labels; receipt uses kinds; never claims confirmed image chip.
2. **Keyboard single-flight** — ⌘⇧A / ⌘⇧F / ⌘⇧V (and Ctrl) respect the same busy guard as toolbar buttons (`captureBusyRef` + toast).
3. **Shell vs Grok honesty** — status pills say shell on/off separately from Grok state; `classifyGrokUiState` / UI never promote launch-requested or process-running alone to “ready”.
4. **Tests** — pure helpers covered in `test/deliver-helpers.test.cjs` and `test/runtime-policy.test.cjs`.

## [0.4.4] — 2026-07-11

### Terminal size / table rendering (continued)

- Pass `COLUMNS` / `LINES` into the PTY env at spawn (some TUIs ignore ioctl alone)
- Re-assert `pty.resize` immediately after spawn
- Optional WebGL renderer + `rescaleOverlappingGlyphs` for cleaner box-drawing
- Note: Grok-generated CJK markdown tables may still pad unevenly; empty space to the right of a short table is normal

## [0.4.3] — 2026-07-11

### Terminal CJK / table border alignment

- Enable `@xterm/addon-unicode11` so East Asian double-width matches modern TUI layout
- Force UTF-8 `LANG` / `LC_ALL` / `LC_CTYPE` in the PTY env (avoids ASCII-locale width bugs)
- `customGlyphs` for cleaner box-drawing; drop proportional CJK faces from mono stack

## [0.4.2] — 2026-07-11

### Terminal width (wide TUI tables)

- Default split favors a slightly wider terminal (`0.52`); min terminal width 400px
- xterm font 12px + CJK-friendly mono stack; tighter line metrics for more columns
- Debounced live resize; forced fit + PTY resize after splitter mouseup/keyboard
- Less host padding so FitAddon can use more horizontal space

## [0.4.1] — 2026-07-11

### Internationalization

- Toolbar **EN / 中文** language toggle with persistence in app settings
- First launch detects system locale (`zh*` → 中文, otherwise English)
- Shared catalogs for shell UI, delivery status, and welcome page
- Main-process paste / busy / Aim warnings follow the selected locale

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
