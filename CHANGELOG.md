# Changelog

All notable changes to **Visual Capture for Grok** are documented here.

## [0.7.6] — 2026-07-12

### Fix palette Enter double-fire

- Attach palette keyboard handler only on the filter input (not also the dialog)
- `stopPropagation` on move/run so Enter cannot open two tabs / toggle twice

## [0.7.5] — 2026-07-12

### Chrome input keyboard contracts (Warp-inspired)

Per-surface Enter / Shift+Enter (and palette arrows) via pure `input-chrome` policy:

| Surface | Enter | Shift+Enter | Arrows |
|---------|-------|-------------|--------|
| Preview URL | Submit navigation | No multi-line (ignored) | — |
| Find | Next match | Previous match | — |
| Palette | Run highlighted / first | No-op | ↑/↓ move highlight |

- Grok TUI agent input unchanged (Warp newline lives in their editor, not our PTY host)
- Unit tests for URL/find/palette key policy; smoke asserts chrome surfaces

## [0.7.4] — 2026-07-12

### Fix Esc priority: Aim cancel wins over chrome inputs

- URL / find / palette local Esc handlers use `resolveFocusedChromeEscape` so pickMode Aim cancel is never swallowed by blur/close
- Unit coverage for focused-surface Esc policy

## [0.7.3] — 2026-07-12

### Warp-inspired chrome input polish

- Preview URL field: clear control, Esc blurs back to terminal, filtered recent suggestions, EN/zh action placeholders
- Shared Esc policy (Aim → find → palette → settings → URL blur) via pure `resolveEscapeAction`
- Find bar + command palette: consistent focus ring, clear affordance, empty-state honesty
- Pure helpers in `src/input-chrome.cjs` with unit tests; smoke covers URL clear + a11y

## [0.7.2] — 2026-07-12

### Production stability (Warp-inspired local bar)

- Pure `electron/stability.cjs`: classify expected vs actionable faults, privacy-safe ring buffer, once-per-run throttle
- Main process `uncaughtException` / `unhandledRejection` handlers buffer scrubbed errors without killing the app
- Settings write failures soft-degrade (prior good file kept); PTY exit handlers cannot throw through the event loop
- Diagnostics copy includes the recent-error buffer; `app:stability-probe` for smoke soft-fault injection
- Packaging require-path guard scans `electron/*.cjs` for forbidden `../src/` requires (prevents 0.7.1-class ship bugs)
- Electron smoke asserts soft probe scrubs secrets and leaves workbench chrome alive

## [0.7.1] — 2026-07-12

### Fix packaged app crash: missing term-settings module

- Main `settings-store` required `../src/term-settings.cjs`, but electron-builder only packs `electron/` (not `src/`)
- Move canonical helpers to `electron/term-settings.cjs`; keep a renderer-side copy under `src/` for Vite
- App launches again from `/Applications`

## [0.7.0] — 2026-07-12

### Warp-inspired terminal host UX (A+B+C)

**Boundary:** we remain a Grok TUI sidecar + preview — not a Warp clone. Ideas only (no AGPL code).

#### Wave A — power tools
- Find in terminal (`⌘F` / `⌘G` / `⇧⌘G`) via `@xterm/addon-search`
- Link hover tooltips for OSC 8 + plain URLs (click → preview, ⌘-click → browser)
- Terminal font zoom `⌘+/−/0` with persisted `termFontSize`
- App menu: Terminal / Capture / View accelerators

#### Wave B — workspace polish
- Tab double-click rename + drag reorder
- Settings: copy-on-select, scrollback, link tooltip, notify on Grok exit
- Terminal context menu (copy / find / open link)
- OS notification when a session exits while the window is unfocused

#### Wave C — discoverability
- Command palette (`⌘K`)
- Keyboard shortcuts sheet (`⌘/`)
- `docs/WARP-INSPIRED.md`

Settings store **v3**. See docs for adopted vs rejected Warp patterns.

## [0.6.11] — 2026-07-12

### Fix OSC 8 link click → in-app preview (no warning dialog)

- Grok emits **OSC 8** hyperlinks; xterm’s default `OscLinkProvider` used `confirm()` + `window.open`
- That produced the “WARNING: This link could potentially be dangerous” dialog, and `window.open` is denied by the main window — so the preview never navigated
- Set Terminal `linkHandler` to the same policy as WebLinksAddon: plain click → preview, ⌘/Ctrl+click → system browser

## [0.6.10] — 2026-07-12

### Terminal link open policy

- Plain click `http(s)` → in-app preview
- **⌘+click** (macOS) / Ctrl+click → **system default browser**
- Pure `resolveTerminalLinkTarget` + unit tests; toast when opening externally

## [0.6.9] — 2026-07-12

### Open terminal links in the right preview

- Clicking `http(s)://` links in the embedded TUI navigates the in-app preview (expands if collapsed)
- ⌘/Ctrl+click still opens the system browser
- Toast confirms which URL was loaded

## [0.6.8] — 2026-07-12

### Trackpad scroll root-cause fix (screen + TUI)

- Listen for wheel on xterm root (not only `.xterm-viewport`); gestures over `.xterm-screen` now accelerate
- Frame-batched pixel deltas for scrollback velocity
- Alternate-buffer mouse-reporting TUIs: convert flick energy into multiple SGR wheel impulses
- Smoke + unit coverage for scrollback and Grok-like TUI wheel acceleration

## [0.6.7] — 2026-07-12

### Preview chrome usability + smoke hardening

- Raise minimum preview pane width (600) so URL + capture controls stay usable
- Container-query compaction: hide action labels / preview label on narrow panes
- Re-apply device emulation on `dom-ready` so responsive viewport survives navigation
- Expand Electron smoke: missing-target Verify, multi-tab workspace restore, private isolation
- README alignment; `trackpad-scroll.d.cts` for TypeScript

## [0.6.6] — 2026-07-11

### Restore CJK / markdown table border alignment

- Re-enable WebGL renderer + `rescaleOverlappingGlyphs` (removed during scroll tuning)
- Keep Unicode 11 widths, custom box-drawing glyphs, lineHeight 1.2
- Trackpad scroll path unchanged (viewport.scrollTop + velocity gain)

## [0.6.5] — 2026-07-11

### Trackpad velocity that actually tracks flicks

- Capture-phase `wheel` on the viewport (own events before xterm)
- Batch pixel deltas per animation frame — fast flicks coalesce into large sums
- Aggressive ease-in gain: slow ~2.5–3×, fast flicks up to ~20×+
- Unit tests for per-event and per-frame gain curves

## [0.6.4] — 2026-07-11

### Velocity-proportional trackpad scroll

- Scroll distance scales with gesture speed: slow glide ≈ 1×, fast flick accelerates
- Uses both delta magnitude and inter-event timing (`trackpadScrollPixels`)
- Unit tests cover slow vs fast gain and direction

## [0.6.3] — 2026-07-11

### Fix trackpad scroll broken by 0.6.2

- Replace `scrollLines` + event-swallow path with direct `.xterm-viewport.scrollTop` (same as xterm internals)
- Keep high gain for pixel deltas; fall back to xterm default when there is no scrollback
- Restores scrolling while remaining faster than stock sensitivity

## [0.6.2] — 2026-07-11

### Trackpad scroll (macOS)

- Custom wheel handler: pixel deltas → high-gain line scroll, rAF-coalesced flicks
- Drop WebGL renderer for the CLI (canvas is snappier with multi-tab + CJK)
- Keep elevated `scrollSensitivity` as fallback

## [0.6.1] — 2026-07-11

### Terminal scroll performance

- Raise xterm `scrollSensitivity` / `fastScrollSensitivity` (defaults were 1 → felt capped on macOS wheel)
- Disable smooth scroll interpolation and cursor blink (less continuous repaint during scroll)
- Slightly leaner glyph path (`rescaleOverlappingGlyphs` off); viewport CSS avoids smooth scroll

## [0.6.0] — 2026-07-11

### Capture-to-verify workflow

- Every terminal tab now owns its preview URL, responsive viewport, DOM target,
  last capture receipt and Before/After pair. Aim/Frame freeze the destination
  before asynchronous work, so switching tabs cannot redirect a capture.
- Added **Verify**: re-resolve the original Aim selector on the same page,
  capture an After image, compare DOM text/identity/attributes/styles/geometry,
  and attempt to paste both Before and After images back to the original Grok.
- Added desktop/laptop/tablet/phone viewport presets with orientation emulation;
  capture metadata records the effective preset and dimensions.

### Security, privacy and operations

- Replaced deprecated `BrowserView` with `WebContentsView`; preview downloads
  are blocked, permissions stay denied, and external schemes remain restricted.
- Screenshot/clipboard work is asynchronous; capture files use a private
  directory (`0700`) and new files use `0600` with no-overwrite writes.
- Added an in-memory private preview mode, explicit site-data clearing, and
  secret-stripped persisted URLs/history.
- Added privacy-safe diagnostics, a latest-release action, progressive
  onboarding state, and expanded Electron smoke coverage for Verify/privacy.

### Reproducible release baseline

- Restored the complete application manifest and synchronized package, lockfile,
  documentation, bundle and DMG versioning at `0.6.0`.
- Unit suites are auto-discovered; `typecheck`, `check` and `release:preflight`
  provide stable validation entry points without a drifting test-count claim.
- Release preflight enforces a clean tree and official-registry lockfile, then
  runs unit, TypeScript, renderer, Electron, packaged-app, codesign and DMG gates.
- macOS arm64 GitHub Actions runs the same full preflight from `npm ci`.
- GitHub publishing refuses existing releases/tags and never replaces a
  previously published asset; release assets include a SHA-256 checksum.

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
