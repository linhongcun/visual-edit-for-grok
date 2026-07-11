# Operator polish (v0.4.6)

High-ROI trust polish implemented after the Codex-inspired pass.

| Item | Behavior |
|------|----------|
| Actionable errors | `buildActionableError` maps codes → message + next step (EN/zh) |
| Status clarity | Shell on/off vs Grok idle/requested/ready/exited; ready only if explicit |
| Quit safety | Close / Cmd+Q while session alive → confirm; quit disposes PTY/Grok |
| Delivery outcomes | Existing short kinds (0.4.5) retained |

## Error codes

`preview-not-ready`, `preview-load-fail`, `grok-missing`, `grok-launch-fail`, `terminal-start-fail`, `nothing-to-resend`, `busy`, `invalid-url`, `capture-failed`, `unknown`

Shipped pure module: `electron/operator-guidance.cjs`.

## Remaining non-goals

Developer ID signing/notarization, Grok table algorithms, OCR readiness and a
full redesign. GitHub DMG publishing itself shipped in 0.6.0.
