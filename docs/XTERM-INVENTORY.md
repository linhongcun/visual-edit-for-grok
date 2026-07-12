# xterm.js → Visual Capture for Grok — capability inventory

**Reference (read-only):** `/Users/hongcunlin/GitHubProjects/xterm.js`  
**Ideas only** — consume published `@xterm/*` packages; reimplement pure policy in VEFG style (no wholesale source copy of xterm internals).  
**Product boundary:** multi-tab **Grok PTY** + secure **preview** host. Not a general-purpose terminal IDE or xterm demo parity product.

## Capability map

| xterm pattern | VEFG map | Status | Notes |
|---------------|----------|--------|-------|
| Core Terminal + PTY write/read | `TerminalPane` + node-pty | **done** (prior) | |
| `@xterm/addon-fit` | FitAddon + resize → PTY | **done** (prior) | |
| `@xterm/addon-search` | Find chrome + SearchAddon | **done** (prior) | |
| `@xterm/addon-web-links` + OSC 8 `linkHandler` | Secure open + tooltips | **done** (prior) | |
| `@xterm/addon-unicode11` | CJK East Asian Width | **done** (prior) | |
| `@xterm/addon-webgl` | WebGL for box-drawing tables | **done** (prior) | |
| **WebGL context loss** handling | `planWebglContextLoss` + dispose/retry budget | **done** (0.8.14) | xterm README: dispose; we add one delayed re-attach then canvas |
| **minimumContrastRatio** | `clampMinimumContrastRatio` default 4.5 (WCAG AA) | **done** (0.8.14) | Readability for muted TUI colors |
| scrollback / font clamps | `clampTermScrollback` / `clampTermFontSize` | **done** (prior) | |
| customGlyphs / rescaleOverlappingGlyphs | Terminal options | **done** (prior) | Grok markdown tables |
| Host key remaps (Shift+Enter, Cmd chords) | `terminal-key-encode` | **done** (prior) | Stock xterm gaps |
| Trackpad / TUI wheel policy | `trackpad-scroll` | **done** (prior) | Not stock xterm |
| `@xterm/addon-serialize` buffer dump | Diagnostics could use later | **out-of-scope** (now) | Grok owns scrollback; no IDE buffer export product |
| `@xterm/addon-clipboard` / OSC 52 | — | **out-of-scope** | Security; capture path owns images |
| `@xterm/addon-image` sixel/iTerm | — | **out-of-scope** | Capture/deliver owns images |
| `@xterm/addon-ligatures` / web-fonts | — | **out-of-scope** | Not mandatory renderer path |
| `@xterm/addon-progress` OSC 9;4 | — | **out-of-scope** | No progress chrome product |
| `@xterm/addon-attach` websocket | — | **out-of-scope** | Local PTY only |
| `@xterm/addon-unicode-graphemes` | — | **out-of-scope** (now) | experimental; unicode11 sufficient |
| Screen reader mode as product toggle | — | **out-of-scope** | |
| Full IDE terminal suite / demo parity | — | **out-of-scope** | |
| Copy xterm.js source into tree | — | **out-of-scope** | npm packages only |

## WebGL context-loss contract (shipped)

| lossCount (already handled) | maxRetries (default 1) | action |
|-----------------------------|------------------------|--------|
| 0 | 1 | `retry-webgl` after `retryDelayMs` (500) — dispose first |
| ≥ maxRetries | any | `dispose-to-canvas` — stay on canvas for this terminal instance |

## minimumContrastRatio contract (shipped)

| Input | Clamped |
|-------|---------|
| invalid | `4.5` (default AA) |
| &lt; 1 | `1` (feature off) |
| &gt; 21 | `21` |
| `4.5` | `4.5` |

## Key files

- `docs/XTERM-INVENTORY.md`
- `electron/term-settings.cjs` + `src/term-settings.cjs` — pure clamps + `planWebglContextLoss`
- `src/components/TerminalPane.tsx` — contrast option + WebGL attach/loss path
- `test/term-settings.test.cjs`

## Explicit non-goals

Do not ship image-protocol product, ligatures-as-primary, attach-remote-socket, or replace Grok host remaps / trackpad policy with stock xterm defaults.
