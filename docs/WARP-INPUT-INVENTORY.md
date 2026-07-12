# Warp input inventory → Visual Capture for Grok

**Date:** 2026-07-12 · **Product boundary:** this app hosts **Grok TUI** as the agent composer. Warp’s defining input is a **first-party multiline editor + completer** (`app/src/terminal/input/*`, `crates/editor`). We do **not** reimplement that editor inside the PTY (AGPL ideas only).

## Surfaces

| ID | Surface | Owner |
|----|---------|--------|
| **H** | Grok prompt / scrollback via node-pty + xterm.js | Grok + our host remaps |
| **C** | App chrome: URL bar, find, command palette | Our React UI |
| **O** | Out of scope | Warp-only product |

## Warp modules surveyed (read-only)

| Path | Role |
|------|------|
| `app/src/terminal/input/universal.rs` | AI-first input box layout |
| `app/src/terminal/input/classic.rs` | Terminal-first input |
| `app/src/terminal/input/cli_agent.rs` | EnterAction: submit vs InsertNewLineIfMultiLine |
| `app/src/terminal/input/inline_menu/*` | Completions / accept on Enter |
| `app/src/terminal/input/slash_commands/*` | Slash menus |
| `app/src/terminal/input/inline_history/*` | History up-menu |
| `app/src/terminal/input/message_bar/*` | Attachments / chips |
| `crates/editor` | Multiline buffer, select-all, soft wrap |
| `app/src/editor/view/mod.rs` | Default macOS keybindings (cmd-left/right/up/down, alt-delete, …) |
| `app/src/settings/input.rs` | Completions, syntax, hint text settings |
| `app/src/terminal/meta_shortcuts.rs` | Meta+letter while IME composing |

## Capability map

| Warp capability | Map | Status | Notes |
|-----------------|-----|--------|-------|
| Multiline soft-wrap editor | O | out-of-scope | Grok owns compose UI |
| Enter = submit | H | done | Stock xterm CR |
| Shift+Enter = newline | H | done (0.7.7–0.7.8) | ESC+CR + keypress swallow |
| Ctrl+Enter = send-now / interject | H | done | Kitty `ESC[13;5u` |
| Completions / slash / history menus | O | out-of-scope | Warp product surface |
| Image / file attachment chips | H | partial | Capture paste path; not Warp chips |
| Select all (Cmd+A) | H | done (0.7.9) | Super+A + `TERM_PROGRAM=ghostty` |
| Delete to line start (Cmd+Backspace) | H | done (0.8.2) | Ctrl+U — Warp DeleteAllLeft / macOS |
| Delete to line end (Cmd+Delete) | H | done (0.8.2) | Ctrl+K — Warp DeleteAllRight / macOS |
| Word left/right (Opt+←/→) | H | stock xterm | ESC b / ESC f on macOS |
| Word delete left (Opt+Backspace) | H | stock xterm | ESC+DEL |
| Word delete right (Opt+Delete) | H | done (0.8.0) | ESC d (readline kill-word-forward) |
| Line start/end (Cmd+←/→) | H | done (0.8.0) | Ctrl+A / Ctrl+E — xterm no-ops meta+arrow |
| Buffer start/end (Cmd+↑/↓) | H | done (0.8.0) | Ctrl+Home / Ctrl+End CSI |
| Undo (Ctrl+Z) | H | Grok-native | Electron `role:undo` for chrome fields; not remapped |
| Select-extend (Cmd+Shift+arrows) | O / later | skipped | No reliable Grok selection-extend sequence |
| URL chrome Enter / clear / Esc | C | done | `input-chrome.cjs` |
| Find Enter / Shift+Enter | C | done | next / prev |
| Palette arrows + Enter | C | done | single handler (0.7.6) |
| Syntax highlight / error underline | O | out-of-scope | Warp editor only |
| Vim mode in input | O | out-of-scope | Grok has own vim scrollback |

## Warp editor defaults we mirrored (macOS)

From `app/src/editor/view/mod.rs` (product mapping only):

| Warp binding | Warp action | Our PTY sequence |
|--------------|-------------|------------------|
| `cmd-left` | MoveToVisualLineStart | `\x01` (Ctrl+A) |
| `cmd-right` | MoveToVisualLineEnd | `\x05` (Ctrl+E) |
| `cmd-up` | CmdUp (buffer top) | `\x1b[1;5H` (Ctrl+Home) |
| `cmd-down` | CmdDown (buffer bottom) | `\x1b[1;5F` (Ctrl+End) |
| `alt-delete` | DeleteWordRight | `\x1bd` (ESC d) |
| `alt-backspace` | DeleteWordLeft | stock xterm |
| `cmd-backspace` | DeleteAllLeft | Ctrl+U (0.8.2) — aligned with Warp/macOS |
| `cmd-delete` | DeleteAllRight | Ctrl+K (0.8.2) — aligned with Warp/macOS |
| `ctrl-a` / `ctrl-e` | line start/end | stock (Grok / shell) |

## xterm.js gaps (why host remaps exist)

From `@xterm/xterm` `Keyboard.ts`:

- **Enter / Shift+Enter** both → bare `CR` (Shift ignored).
- **metaKey + arrows** → `break` with **no sequence** (Cmd+Left/Right/Up/Down dead).
- **Alt+Left/Right** → word motion (works).
- **Alt+Backspace** → `ESC` + DEL (word delete; works).
- **Alt+Delete** → CSI `\x1b[3;3~` (often ignored by TUI editors) → we remap to ESC d.
- **Cmd+letter** → largely left to the browser (stolen or ignored).

## Implementation policy

Pure encoder `src/terminal-key-encode.cjs` → `resolveGrokHostKey` → TerminalPane `attachCustomKeyEventHandler` write/swallow only. Prefer sequences Grok already accepts (ESC+CR, Ctrl+A/E style, Kitty Super chords with Ghostty identity).

## Chrome (C) contracts (keep)

| Surface | Enter | Shift+Enter | Arrows |
|---------|-------|-------------|--------|
| URL | submit | none | — |
| Find | next | prev | — |
| Palette | run | none | ↑/↓ move |

## Out of scope (do not build)

- Warp ADE / command blocks / blocklist selection
- First-party multiline editor, soft-wrap, syntax underlines
- Slash command / completion / inline history UIs
- Full Kitty progressive-enhancement negotiation beyond Super+A and Ctrl+Enter
- Copying any AGPL source from the Warp tree
