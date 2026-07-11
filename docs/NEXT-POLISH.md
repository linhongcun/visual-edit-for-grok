# Next-round polish (executed)

Codex-inspired high-ROI items for Visual Capture for Grok. This document records the list that was **written then implemented** in the 0.4.5 pass.

| # | Item | Status |
|---|------|--------|
| 1 | Structured delivery outcome kinds + short localized labels | Done |
| 2 | Keyboard Aim/Frame/Re-send share busy single-flight with buttons | Done |
| 3 | Shell vs Grok status honesty (never promote requested → ready) | Done |
| 4 | Pure helpers + unit tests for outcome / busy / grok UI state | Done |

## Outcome kinds

| Kind | Meaning |
|------|---------|
| `image-attempted` | Image paste write attempted; chip **not** confirmed |
| `text-attempted` | Text/DOM paste attempted; receipt unconfirmed |
| `clipboard-only` | OS clipboard sink only (e.g. Grok not running) |
| `local-only` | Capture on disk without paste/clipboard claim |
| `failed` | Error path |
| `unknown` | Prior session / incomplete metadata |

Shipped pure API: `classifyDeliveryOutcome` / `deliveryOutcomeLabel` in `electron/delivery-status.cjs`.

## Follow-up (v0.4.6)

| Item | Status |
|------|--------|
| Actionable error next-steps | Done (`operator-guidance.cjs`) |
| Quit confirmation while session alive | Done |
| Shell vs Grok status clarity | Done |

## Later status

- GitHub DMG publishing is implemented in 0.6.0 with immutable tag/asset gates,
  checksum generation and a full release preflight. Public trusted distribution
  still requires Developer ID signing and Apple notarization.
- Grok markdown table layout algorithm
- A full `main.cjs` redesign remains out of scope; capture coordination, Verify,
  viewport, privacy, diagnostics and I/O policies are now isolated modules.
