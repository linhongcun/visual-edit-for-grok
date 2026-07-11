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

## Non-goals (still out of scope)

GitHub DMG/notarization, Grok table algorithms, OCR readiness, full redesign.
