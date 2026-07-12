# browser-use → Visual Capture for Grok

**Reference (read-only):** `/Users/hongcunlin/GitHubProjects/browser-use`  
**Date:** 2026-07-12 · **Product boundary:** Grok remains the agent. We do **not** ship browser-use’s Python agent loop, CDP automation, or cloud runtime. Ideas only (no source copy).

## Modules surveyed

| Path | Role |
|------|------|
| `browser_use/browser/views.py` | `PageInfo`, `BrowserStateSummary`, `NetworkRequest`, `browser_errors` |
| `README.md` / agent task loop | LLM-oriented browser state for multi-step tools |
| Watchdogs / HAR | Network + download forensics (heavy) |

## Capability map

| browser-use pattern | VEFG map | Status | Notes |
|---------------------|----------|--------|-------|
| `PageInfo` viewport/scroll + pixels above/below | Capture → Grok paste | **done** (0.8.6) | `electron/page-context.cjs` + `page_info` fence |
| URL / title in state summary | Existing `browser_element` / snapshot | **done** (prior) | Already in payload |
| Screenshot + DOM for LLM | Aim/Frame screenshot + element + agent_snapshot | **done** (prior / 0.8.5) | Not full SerializedDOMState |
| `browser_errors` / recent events | Preview fault ring | **done** (0.8.6) | `did-fail-load` + console error/warn; scrubbed, capped |
| Pending network requests | — | **out-of-scope** | Full CDP network list not wired |
| Agent step / action history | — | **out-of-scope** | Would be a second agent loop |
| Extract-for-LLM full page tools | — | **out-of-scope** | Grok does extraction |
| Cloud / Discord / multi-tab agent tabs list | — | **out-of-scope** | Product boundary |

## Shipped fences

```text
```page_info
viewport_css_px: w×h
page_css_px: w×h          # when document size known
scroll_css_px: x,y
pixels_above / pixels_below / pixels_left / pixels_right
```

```page_faults
[iso-time] fail-load: …
[iso-time] console:error: …
```
```

## Key files

- `docs/BROWSER-USE-INVENTORY.md`
- `electron/page-context.cjs` — pure geometry + fault ring + formatters
- `electron/clipboard-payload.cjs` — attaches fences
- `electron/preview-preload.cjs` — document size in captureContext
- `electron/main.cjs` — fault collection hooks
- `test/page-context.test.cjs`
