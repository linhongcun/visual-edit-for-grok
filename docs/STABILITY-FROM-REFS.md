# Stability practices from reference repos → VEFG

**References (read-only):**  
`/Users/hongcunlin/GitHubProjects/agent-browser`, `browser-use`, `playwright-mcp`  
**Ideas only** — no source copy. Product boundary: local Electron host, not a second browser agent.

## Patterns surveyed

| Source | Pattern | VEFG map | Status |
|--------|---------|----------|--------|
| **agent-browser** | Tool/op **timeouts** (default tool 60s, install connect timeout) | `withTimeout` around capturePage / long host ops | **done** (0.8.10) |
| **agent-browser** | **Doctor** / launch health checks | `buildHealthSnapshot` in diagnostics | **done** (0.8.10) |
| **agent-browser** | Bounded retries on install/network | Soft report + once-per-run (existing); no install loop | partial / OOS for retries |
| **agent-browser** | Max output / idle timeout flags | Ring caps (faults, network, stability buffer) | **done** (prior rings) |
| **browser-use** | **CrashWatchdog** (target crash, hang detection) | Preview `render-process-gone` / `unresponsive` → stability buffer | **done** (0.8.10) |
| **browser-use** | Per-request CDP **timeout** (no silent hang) | `withTimeout` + classify `op-timeout` | **done** (0.8.10) |
| **browser-use** | Watchdog modules for downloads/security | Download deny + permission deny (prior) | **done** (prior) |
| **playwright-mcp** | Isolation / no vision-required path | Preview sandbox, permission deny (prior) | **done** (prior) |
| **playwright-mcp** | Secrets scrubbing in tool responses | clipboard/page-context/network scrub (prior) | **done** (prior) |
| **All three** | Expected vs unexpected failure classes | `classifyStabilityError` (prior) + timeout code | **done** |

## Already in VEFG (pre-0.8.10)

- `StabilityErrorBuffer` + `reportStabilityFault` + once-per-run throttle  
- Uncaught / unhandledRejection handlers (soft)  
- Packaging require-graph guard  
- Preview fault ring + network ring size caps  
- Smoke `stabilityProbe`  

## Key files (0.8.10+)

- `electron/stability.cjs` — `withTimeout`, `buildHealthSnapshot`, timeout classification  
- `electron/main.cjs` — capture timeout, preview crash/unresponsive hooks  
- `electron/diagnostics.cjs` — health in diagnostic JSON  
- `test/stability.test.cjs` — unit tests  
- This document  

## Out of scope

- Full browser-use multi-watchdog agent loop  
- agent-browser daemon doctor CLI as a product surface  
- Shipping Playwright MCP process manager  
