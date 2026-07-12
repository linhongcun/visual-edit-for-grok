# Warp macOS notifications → Visual Capture for Grok

**Platform:** macOS only. Reference Warp **macOS** desktop-notification product model (`NotificationsSettings`, navigated-away window). AGPL ideas only — no code copy.

**Product boundary:** We host **Grok TUI** in a PTY. Warp owns **command blocks** and agent conversation state; we do **not** parse shell-block completion inside Grok. Map only **host-visible** events.

## Warp triggers surveyed (macOS)

| Warp trigger | Source | VEFG map | Status |
|--------------|--------|----------|--------|
| Long-running command complete (≥ threshold, default **30s**) | `maybe_send_block_completed_notification` when `is_long_running_enabled` | Host **capture / Aim / Frame / deliver** via `withCaptureLock` ≥ threshold | **done** (`notifyOnLongTask`; Aim uses `withCaptureLock` in `handleTrustedAimSelection`) |
| Agent task completed / needs attention | `maybe_send_agent_mode_desktop_notification` | No host-visible Grok-turn signal | **out-of-scope** (would need Grok-side OSC/API) |
| Password prompt | password heuristics | No shell-block parser | **out-of-scope** |
| Session / process exit | (adjacent host concern) | PTY `onExit` | **done** (`notifyOnGrokExit`, pre-existing) |
| Only when navigated away from window | `is_navigated_away_from_window` | `!mainWindow.isFocused()` | **done** |
| Settings: long-running toggle + threshold | `is_long_running_enabled`, `long_running_threshold` | Settings UI + persisted flags | **done** |
| Notification click → focus app | root_view notification click | Electron `Notification` `click` → `mainWindow.focus()` | **done** |
| Notification sound marketplace / discovery banners | Warp UI | — | **out-of-scope** |
| Shell-block completion for arbitrary CLI in Grok | command blocks | — | **out-of-scope** (honest gap) |

## Policy (shipped)

Pure helper: `electron/notify-policy.cjs` → `shouldShowDesktopNotification`.

| Input | Rule |
|-------|------|
| `windowFocused === true` | never notify |
| `osSupported === false` | never notify |
| kind `session-exit` | require `notifyOnGrokExit` |
| kind `long-task` | require `notifyOnLongTask` and `durationMs >= thresholdMs` (default 30s) |

## Settings keys

| Key | Default | Meaning |
|-----|---------|---------|
| `notifyOnGrokExit` | `true` | Session/PTY exit while unfocused |
| `notifyOnLongTask` | `true` | Long capture/deliver finished while unfocused |
| `longTaskNotifyThresholdSec` | `30` | Warp-aligned threshold (clamped 5–600) |

## Key files

- `electron/notify-policy.cjs` — pure decision + threshold clamp
- `electron/main.cjs` — timestamps `withCaptureLock`, session exit, Notification click
- `electron/settings-store.cjs` — persist flags
- `src/App.tsx` — settings UI
- `test/notify-policy.test.cjs` — unit tests
