# Warp-inspired terminal host UX

Visual Capture for Grok is **not** a Warp clone. We host the **native Grok TUI** plus a secure browser preview. Ideas below come from studying the open Warp client (`warpdotdev/warp`) as a mature terminal host — **product patterns only**, never AGPL source.

## Product boundary

| Adopt | Reject |
|-------|--------|
| Find, font zoom, link tooltips, menus | Custom terminal grid / command blocks |
| Tab rename & reorder | Shell bootstrap / completers |
| Settings for host prefs | Built-in coding agent (Grok is the agent) |
| Command palette + shortcuts sheet | SSH / WSL / Warp Drive / cloud sync |
| Optional copy-on-select & exit notifications | Theme marketplace |

## Shipped (v0.7.0)

### Wave A — Terminal host power tools

- **Find** (`⌘F` / `⌘G` / `⇧⌘G`) via `@xterm/addon-search`
- **Link hover tooltip** (OSC 8 + plain URLs) with open-target hints
- **Font zoom** `⌘+/−/0`, persisted (`termFontSize`)
- **App menu** Terminal / Capture / View accelerators

### Wave B — Workspace polish

- Tab **double-click rename** + **drag reorder**
- **Copy on select** (settings, default off)
- Terminal **context menu** (copy / find / open link)
- **Scrollback** size setting (default 10k)
- **OS notification** when session exits while unfocused
- Lightweight **Settings** sheet (`⌘,`)

### Wave C — Discoverability

- **Command palette** (`⌘K`)
- **Keyboard shortcuts** sheet (`⌘/`)
- This document

## Settings keys (`settings-store` v3)

| Key | Default | Meaning |
|-----|---------|---------|
| `termFontSize` | 12 | px, clamped 10–22 |
| `linkTooltip` | true | Hover URL tip |
| `copyOnSelect` | false | Clipboard on selection |
| `termScrollback` | 10000 | xterm scrollback rows |
| `notifyOnGrokExit` | true | Background exit notification |

## Key files

- `src/components/TerminalPane.tsx` — xterm host, search, links, context menu
- `src/components/TerminalFindBar.tsx` — find UI
- `src/term-settings.cjs` — pure clamps
- `electron/settings-store.cjs` — persistence
- `electron/main.cjs` — menu, IPC, notifications
- `src/App.tsx` — chrome, palette, settings, tabs

## License note

Do **not** copy code from the Warp repository (AGPL). Reimplement against xterm.js public APIs and our Electron shell.

## Production stability (v0.7.2)

Local production bar (not a Sentry/minidump clone):

| Mechanism | Module |
|-----------|--------|
| Expected vs actionable classify | `electron/stability.cjs` |
| Privacy-safe recent-error ring | `StabilityErrorBuffer` → diagnostics |
| Uncaught / unhandled hooks | `electron/main.cjs` `installProcessStabilityHandlers` |
| Soft settings / PTY sinks | `persist()`, terminal `onExit` |
| Packaging require guard | `test/stability.test.cjs` scans `electron/*.cjs` |
| Smoke soft-fault probe | `window.vefg.stabilityProbe` |

## Chrome inputs (v0.7.3)

Warp-quality editing is mostly their **owned command editor**. We polish **app chrome** only:

| Surface | Affordances |
|---------|-------------|
| Preview URL | Clear, Esc→terminal, ranked recent, a11y placeholder |
| Find | Esc close, clear, focus ring |
| Palette | Filter helper, empty state, Esc→terminal |

Helpers: `src/input-chrome.cjs` (pure). Grok TUI prompt is unchanged.

## Keyboard contracts (v0.7.5)

Warp maps **Shift+Enter → newline** in its multiline command editor. Our agent compose is **Grok TUI**, so chrome maps:

| Surface | Enter | Shift+Enter |
|---------|-------|-------------|
| URL | Go | ignore (single-line) |
| Find | next | previous |
| Palette | run selection | ignore |

Arrows on palette move the highlight. Policy: `resolveUrlKeyAction` / `resolveFindKeyAction` / `resolvePaletteKeyAction`.

## Grok host remaps (v0.7.7–0.8.0)

xterm.js gaps + Warp-inspired macOS edit chords, pure encoder `src/terminal-key-encode.cjs`:

| Chord | Sequence | Purpose |
|-------|----------|---------|
| ⇧Enter | ESC+CR | Newline (stock xterm = bare CR) |
| ⌃Enter | Kitty CSI-u | Interject |
| ⌘A | Kitty Super+A | Select all (needs `TERM_PROGRAM=ghostty`) |
| ⌘⌫ / ⌘⌦ | Super+A + DEL | Clear whole composer |
| ⌘← / ⌘→ | Ctrl+A / Ctrl+E | Line start / end |
| ⌘↑ / ⌘↓ | Ctrl+Home / Ctrl+End | Buffer start / end |
| ⌥⌦ | ESC d | Forward word delete |

Full capability map: `docs/WARP-INPUT-INVENTORY.md`.
