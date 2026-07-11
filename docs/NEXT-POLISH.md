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

## Deferred (not this pass)

- GitHub DMG release upload
- Grok markdown table layout algorithm
- Full main.cjs split / redesign
