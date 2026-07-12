# Wave Terminal → Visual Capture for Grok

**Reference (read-only):** `/Users/hongcunlin/GitHubProjects/waveterm` (Apache-2.0; ideas only, reimplement)  
**Date:** 2026-07-12 · **Product boundary:** Grok TUI + secure preview host. No Wave AI, SSH durable sessions, command blocks, or `wsh`.

## Modules surveyed

| Path | Role |
|------|------|
| README Key Features | Full-screen toggle for any block; web browser widgets; multi-block layout |
| `frontend/layout/lib/types.ts` | Maximize node id in layout model |
| `frontend/app/onboarding/onboarding-features.tsx` | “Magnify any block” product copy |
| `pkg/remote/conncontroller/connmonitor.go` | Conn health: good / degraded / stalled + keepalive + panic recover |
| `emain/*` | Webview embed, reload, attach lifecycle |

## Capability map

| Wave pattern | VEFG map | Status | Notes |
|--------------|----------|--------|-------|
| Quick full-screen / magnify block | Maximize terminal **or** preview | **done** (0.8.11) | Pure `resolveWorkspaceMaximize`; chrome + `⌘⇧M` / `⌘⇧E` |
| Embedded web + terminal split | Existing dual pane | **done** (prior) | |
| Conn health + soft reconnect | Preview soft recovery after crash | **done** (0.8.11) | Recreate WebContentsView; keep Grok PTY |
| Keepalive / stalled status | Health snapshot notes (prior 0.8.10) | partial | Local host, not SSH |
| Panic-safe handlers | Main soft crash reports (prior) | **done** (prior) | |
| Wave AI / multi-model chat | — | **out-of-scope** | Grok is the agent |
| Durable SSH / remote files / wsh | — | **out-of-scope** | |
| Drag multi-block tiling grid | — | **out-of-scope** | Two-pane only |
| Theme marketplace / bg images | — | **out-of-scope** | |

## Layout maximize contract

| State | Effect |
|-------|--------|
| `maximized: null` | Normal split / collapse |
| `maximized: "terminal"` | Preview collapsed (full terminal); prior split saved in memory |
| `maximized: "preview"` | Terminal at min ratio (~0.22); preview expanded |
| Toggle same surface again | Restore `restoreSplitRatio` + `restorePreviewCollapsed` |

Maximized mode is **session memory only** (not persisted) so settings split is not corrupted.

## Preview recovery contract

| Input | Action |
|-------|--------|
| Renderer gone / unusable view | `recreate` (bounded) |
| Over recovery budget | `none` (report only; user reloads) |
| Main window missing | `none` |

## Key files

- `docs/WAVETERM-INVENTORY.md`
- `electron/runtime-policy.cjs` — `resolveWorkspaceMaximize`, `planPreviewRecovery`
- `electron/main.cjs` — maximize IPC, recreate preview
- `src/App.tsx` + i18n — chrome controls / shortcuts
- `test/workspace-maximize.test.cjs`
