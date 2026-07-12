# Palot → Visual Capture for Grok — capability inventory

**Reference (read-only):** `/Users/hongcunlin/GitHubProjects/palot`  
**Ideas only** — no source copy (AGPL/product boundary: reimplement in VEFG style).  
**Product boundary:** multi-tab **Grok PTY** + secure **preview** host. Not an OpenCode/chat IDE, not a multi-model agent shell.

Palot is an Electron desktop GUI for [OpenCode](https://opencode.ai): multi-project chat, review diffs, RRule automations, migration from Claude Code/Cursor. Most headline features are **out of scope** for VEFG. Transfer focuses on **host stability** and **notification hygiene** that map cleanly to local Grok + preview.

## Capability map

| Palot pattern | VEFG map | Status | Notes |
|---------------|----------|--------|-------|
| **Notify cooldown** per session+type (30s) | `planDesktopNotification` / `evaluateNotifyCooldown` in `notify-policy.cjs`; main `notifyLastShown` map | **done** (0.8.13) | Stops exit/long-task spam when unfocused |
| Focused-window suppress | Existing Warp-style `windowFocused` gate | **done** (prior) | Palot same idea |
| Permission batch window (3s) | — | **out-of-scope** | No agent permission OS notifications |
| Automation **semaphore** (concurrency limit) | Capture already single-flight (`canStartCapture`) | **done** (prior) | No multi-automation runner |
| SSE **exponential backoff** reconnect | Pure `planBackoffDelayMs` (unit-tested); no SSE host loop | **done** (pure helper 0.8.13) | Preview recovery uses force recreate + budget, not SSE |
| Execution **retries + delay** | Soft fault once-per-run; no unattended agent retry product | **out-of-scope** | Would fight user-visible Grok control |
| Server **lockfile** + stale PID / cross-user | Electron multi-instance not primary pain; no OpenCode server | **out-of-scope** | Optional future single-instance lock |
| **Process owner** (lsof port UID) | — | **out-of-scope** | No shared TCP server for agent |
| Credential **safeStorage** | No remote server passwords in product | **out-of-scope** | |
| Tagged main **logger** | `reportMainFault` + stability buffer | **done** (prior) | Different shape, same ops need |
| SDK / op **timeouts** | `withTimeout` (0.8.10+) | **done** (prior) | |
| Dock badge / tray-as-shell | — | **out-of-scope** | App is foreground workbench |
| Liquid Glass chrome | — | **out-of-scope** | |
| mDNS multi-server discovery | — | **out-of-scope** | |
| OpenCode multi-agent **chat UI** / slash / sub-agents | — | **out-of-scope** | Grok is the agent |
| Review / diff panel as product surface | — | **out-of-scope** | |
| RRule automations + pending_review queue | — | **out-of-scope** | |
| Claude Code / Cursor **migration** wizard | — | **out-of-scope** | |
| Source copy from palot | — | **out-of-scope** | Ideas only |

## Notification cooldown contract (shipped)

| Input | Result |
|-------|--------|
| Base policy rejects (focused / flag / threshold) | `show: false`, base reason |
| Base would show, but same **cooldown key** within `cooldownMs` (default 30s) | `show: false`, `reason: "cooldown"` |
| Base would show, cooldown elapsed or first fire | `show: true`, `recordShown: true` |

**Cooldown key:** `{kind}:{scope}` where `scope` is session id for exits, or a stable host key (e.g. `capture`) for long-task.

## Key files

- `docs/PALOT-INVENTORY.md` — this map  
- `electron/notify-policy.cjs` — pure cooldown + plan  
- `electron/main.cjs` — `notifyLastShown` + `planDesktopNotification`  
- `test/notify-policy.test.cjs` — pure path + wiring checks  

## Explicit non-goals (product)

Do **not** turn VEFG into Palot/OpenCode: multi-model chat host, automations scheduler, migration wizard, remote server discovery, tray-primary shell, or Liquid Glass chrome.
