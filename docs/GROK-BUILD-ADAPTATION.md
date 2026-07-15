# Grok Build → Visual Capture for Grok — host adaptation

**Upstream (open source):** [https://github.com/xai-org/grok-build](https://github.com/xai-org/grok-build)  
**Local reference (read-only checkout):** `/Users/hongcunlin/GitHubProjects/grok-build`  
(user-guide `21-terminal-support.md`, `03-keyboard-shortcuts.md`, `15-agent-mode.md`; terminal brand map in `xai-grok-pager-render`).  
**Docs / product:** [docs.x.ai/build](https://docs.x.ai/build/overview) · [x.ai/cli](https://x.ai/cli)  
**Ideas only** — do not fork/vendor Grok Rust sources into this tree.  
**Product boundary:** embedded **Grok TUI** sidecar + secure preview. Not an ACP chat host; not headless-primary agent product.

## Capability map

| Grok Build contract | VEFG map | Status | Notes |
|---------------------|----------|--------|-------|
| Truecolor + UTF-8 env | `buildColorfulEnv` | **done** (prior + 0.8.16) | COLORTERM / FORCE_COLOR / LANG |
| Terminal brand for Cmd chords | `resolveGrokTermProgramIdentity` → default **ghostty** | **done** (0.8.16) | Ghostty = native Cmd; `grokdesktop` optional override |
| Image paste Ctrl+V | plan inject `\x16` | **done** (0.8.16) | Grok `is_paste_key` CONTROL+v |
| Image paste Cmd+V (macOS) | Kitty Super+V `\x1b[118;9u` after Ctrl+V | **done** (0.8.16) | Grok accepts SUPER+v |
| File-on-clipboard (macOS) then paste | `putScreenshotOnClipboardForGrok` | **done** (prior) | Docs: copy file then paste |
| Image then text (not one mixed write for auto path) | `planGrokMultimodalPaste` steps | **done** (0.8.16) | Image-only clipboard → keys → bracketed text → restore image for manual ⌘V |
| Host key remaps (Shift+Enter, Cmd chords) | `terminal-key-encode` | **done** (prior) | xterm.js KKP gaps |
| `/terminal-setup` operator check | diagnostics hint | **done** (0.8.16) | Do not auto-run inside TUI |
| OSC 52 → host clipboard (best-effort) | `extractOsc52ClipboardPayloads` + PTY data scan | **done** (0.8.16) | Thin decode; write system clipboard |
| Headless `grok -p` / `--prompt-json` | — | **out-of-scope** | Secondary automation only |
| ACP `grok agent stdio` as main path | — | **out-of-scope** | Product non-goal |
| Guaranteed image-chip confirmation | honesty: attempted | **done** (prior) | Grok probes clipboard async |
| Full KKP negotiation in xterm | host remaps instead | **out-of-scope** | Documented VS Code-family limits |
| Fork Grok Build sources into tree | — | **out-of-scope** | |

## Identity contract

| Input parent `TERM_PROGRAM` | Result (default) |
|-----------------------------|------------------|
| empty / Apple_Terminal / iTerm.app / vscode / Electron | `ghostty` + version |
| explicit `VEFG_TERM_PROGRAM` / preferred brand `ghostty` \| `grokdesktop` \| `kitty` | that brand |
| already `ghostty` / `kitty` / `wezterm` | keep unless force |

Reason for default Ghostty: Grok keyboard table marks Ghostty Cmd as **Native**; `GrokDesktop` is still **Unknown** in open-source tables.

## Multimodal paste contract

For each image (then text once):

1. Put **image/file only** on OS clipboard (no DOM text mixed in).  
2. Delay settle.  
3. Inject **Ctrl+V** (`\x16`).  
4. On **darwin**, inject **Super+V** Kitty CSI-u.  
5. Delay for Grok clipboard probe.  
6. Bracketed-paste DOM/context text.  
7. Restore last image on clipboard for manual ⌘V fallback.

If step 1 fails for an `imageIndex`, **`mayExecuteGrokPasteStep` skips** that
index’s write/delay/restore so a **stale** OS clipboard is never pasted.

## Diagnostics

`buildDiagnosticSummary.grokHost` includes:

- `termProgram` / `termProgramVersion` / `identityReason`  
- `terminalSetupHint`: run `/terminal-setup` inside Grok  

## Key files

- `docs/GROK-BUILD-ADAPTATION.md`  
- `electron/grok-host-policy.cjs` — pure identity, paste plan, OSC 52 extract  
- `electron/terminal.cjs` — env identity  
- `electron/main.cjs` — multimodal deliver + OSC 52 clipboard  
- `electron/diagnostics.cjs` — grokHost block  
- `test/grok-host-policy.test.cjs`  
