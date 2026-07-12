# agent-browser → Visual Capture for Grok

**Reference (read-only):** `/Users/hongcunlin/GitHubProjects/agent-browser`  
**Date:** 2026-07-12 · **Product boundary:** we host **Grok TUI** + secure preview. We do **not** ship agent-browser’s CLI/daemon or CDP click/fill automation. Ideas only (no source copy).

## Modules surveyed

| Path | Role |
|------|------|
| `README.md` | snapshot `@eN` refs, `-i` interactive filter, hide-scrollbars screenshots, annotate |
| `skill-data/core/references/snapshot-refs.md` | compact AX-like tree (~200–400 tokens vs full DOM) |
| `cli/src/native/snapshot.rs` | interactive roles, ref map, cursor-interactive marks |
| `cli/src/native/screenshot.rs` | annotate overlay, screenshot options |
| Launch flags | `--hide-scrollbars` default true for consistent images |

## Capability map

| agent-browser pattern | VEFG map | Status | Notes |
|----------------------|----------|--------|-------|
| Compact a11y snapshot + `@eN` refs | Capture → Grok paste text | **done** (0.8.5) | `electron/agent-snapshot.cjs` + `buildClipboardPayload` `agent_snapshot` fence |
| Interactive-only neighborhood | Aim selection + nearby interactive siblings | **done** (partial) | Preload attaches limited `neighbors`; not full page AXTree |
| Hide native scrollbars on screenshots | `takeScreenshotFile` | **done** (0.8.5) | Temporary CSS inject around `capturePage` (default on) |
| Annotated/numbered screenshots | Screenshot UI | **out-of-scope** | Overlay UI + ref paint not in this pass |
| Snapshot / pixel / URL diff CLI | Verify | **out-of-scope** | We already have Verify pair; not agent-browser diff pipeline |
| `click @eN` / fill / CDP automation | Second agent | **out-of-scope** | Grok remains the agent |
| Full CDP AXTree for whole page | Snapshot | **out-of-scope** | Costly; use selection + neighborhood |

## Payload shape (shipped)

```text
```agent_snapshot
Page: …
URL: …
Target:
@e1 [button] "Label" id=…
  selector: …
  path: …
Nearby:
@e2 [link] "…"
…
```
```

- Secrets in attributes/URLs redacted (shared with `clipboard-payload` rules).
- Size capped (line/char limits) — agent-browser token-thrifty spirit.
- Existing `browser_element` block retained for source matching.

## Key files

- `docs/AGENT-BROWSER-INVENTORY.md` — this note
- `electron/agent-snapshot.cjs` — pure snapshot formatter
- `electron/clipboard-payload.cjs` — attaches snapshot to Grok paste
- `electron/preview-preload.cjs` — role/name/neighbors on Aim pick
- `electron/main.cjs` — scrollbar-hidden screenshots
- `test/agent-snapshot.test.cjs` — unit tests
