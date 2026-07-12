# playwright-mcp → Visual Capture for Grok

**Reference (read-only):** `/Users/hongcunlin/GitHubProjects/playwright-mcp`  
**Date:** 2026-07-12 · **Product boundary:** Grok remains the agent. We do **not** ship `@playwright/mcp` or a second Playwright browser. Ideas only (no source copy).

## Patterns surveyed

| Tool / pattern | Role |
|----------------|------|
| `browser_snapshot` | A11y tree for LLM (we have `agent_snapshot` from agent-browser pass) |
| `browser_console_messages` | Console levels for LLM (we have `page_faults`) |
| `browser_network_requests` | Numbered request list since page load (method/status/url) |
| `browser_network_request` | Full headers/body of one request |
| Secrets config | Redact plain-text secrets in tool responses |
| Click/fill/navigate by snapshot ref | Automation loop |

## Capability map

| playwright-mcp pattern | VEFG map | Status | Notes |
|------------------------|----------|--------|-------|
| Compact network request list | Capture → Grok paste | **done** (0.8.8) | `network_requests` fence via session `webRequest` |
| Prefer non-static / failed | Filter ring | **done** | Prefer failed + document/xhr/fetch/script; cap list |
| Secrets redaction in responses | URL/query + token scrub | **done** | `sanitizePageUrl` + `scrubFaultMessage` |
| Console messages | `page_faults` | **done** (prior 0.8.6) | |
| A11y snapshot | `agent_snapshot` | **done** (prior 0.8.5) | |
| Full request body / headers dump | — | **out-of-scope** | Too heavy / sensitive |
| Click/fill/navigate automation | — | **out-of-scope** | Second agent |
| Vision / PDF / HAR / annotation UI | — | **out-of-scope** | |

## Shipped fence

```text
```network_requests
1. GET 200 document https://…
2. GET FAIL net::ERR_… https://…?token=[REDACTED]
```
```

Empty ring → no fence.

## Key files

- `docs/PLAYWRIGHT-MCP-INVENTORY.md`
- `electron/page-context.cjs` — `NetworkRequestRing`, `formatNetworkRequestsBlock`
- `electron/main.cjs` — `webRequest` hooks + clear on navigation
- `electron/clipboard-payload.cjs` — attaches fence
- `test/network-requests.test.cjs`
