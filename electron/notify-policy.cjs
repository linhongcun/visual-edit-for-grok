/**
 * Pure desktop-notification policy (Warp macOS-inspired).
 *
 * Rules:
 * - Never notify when the main window is focused (navigated-away only).
 * - Session exit: gated by notifyOnGrokExit.
 * - Long host task (capture/deliver): gated by notifyOnLongTask and duration
 *   ≥ threshold (default 30s, Warp long-running default).
 *
 * No Electron imports — unit-testable without app shell.
 */

/** Warp default long-running threshold (seconds). */
const DEFAULT_LONG_TASK_THRESHOLD_SEC = 30;
const MIN_LONG_TASK_THRESHOLD_SEC = 5;
const MAX_LONG_TASK_THRESHOLD_SEC = 600;

/**
 * @param {unknown} value
 * @param {number} [fallback]
 * @returns {number}
 */
function clampLongTaskThresholdSec(value, fallback = DEFAULT_LONG_TASK_THRESHOLD_SEC) {
  const n = Number(value);
  if (!Number.isFinite(n)) return fallback;
  return Math.min(
    MAX_LONG_TASK_THRESHOLD_SEC,
    Math.max(MIN_LONG_TASK_THRESHOLD_SEC, Math.round(n)),
  );
}

/**
 * @typedef {"session-exit" | "long-task"} NotifyKind
 */

/**
 * Decide whether to show an OS desktop notification.
 *
 * @param {{
 *   kind: NotifyKind,
 *   windowFocused: boolean,
 *   osSupported?: boolean,
 *   notifyOnGrokExit?: boolean,
 *   notifyOnLongTask?: boolean,
 *   durationMs?: number,
 *   longTaskThresholdSec?: number,
 * }} input
 * @returns {{ show: boolean, reason: string }}
 */
function shouldShowDesktopNotification(input) {
  if (!input || typeof input !== "object") {
    return { show: false, reason: "invalid-input" };
  }
  if (input.osSupported === false) {
    return { show: false, reason: "os-unsupported" };
  }
  if (input.windowFocused) {
    return { show: false, reason: "window-focused" };
  }

  const kind = input.kind;
  if (kind === "session-exit") {
    if (input.notifyOnGrokExit === false) {
      return { show: false, reason: "session-exit-disabled" };
    }
    return { show: true, reason: "session-exit" };
  }

  if (kind === "long-task") {
    if (input.notifyOnLongTask === false) {
      return { show: false, reason: "long-task-disabled" };
    }
    const thresholdSec = clampLongTaskThresholdSec(
      input.longTaskThresholdSec,
      DEFAULT_LONG_TASK_THRESHOLD_SEC,
    );
    const durationMs = Number(input.durationMs);
    if (!Number.isFinite(durationMs) || durationMs < 0) {
      return { show: false, reason: "invalid-duration" };
    }
    const thresholdMs = thresholdSec * 1000;
    if (durationMs < thresholdMs) {
      return { show: false, reason: "under-threshold" };
    }
    return { show: true, reason: "long-task" };
  }

  return { show: false, reason: "unknown-kind" };
}

module.exports = {
  shouldShowDesktopNotification,
  clampLongTaskThresholdSec,
  DEFAULT_LONG_TASK_THRESHOLD_SEC,
  MIN_LONG_TASK_THRESHOLD_SEC,
  MAX_LONG_TASK_THRESHOLD_SEC,
};
