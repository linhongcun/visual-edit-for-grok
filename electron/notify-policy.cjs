/**
 * Pure desktop-notification policy (Warp macOS + Palot-inspired).
 *
 * Rules:
 * - Never notify when the main window is focused (navigated-away only).
 * - Session exit: gated by notifyOnGrokExit.
 * - Long host task (capture/deliver): gated by notifyOnLongTask and duration
 *   ≥ threshold (default 30s, Warp long-running default).
 * - Palot-inspired cooldown: same kind+scope cannot fire again within a window
 *   (default 30s) so rapid exits / long-tasks do not spam the OS.
 *
 * No Electron imports — unit-testable without app shell.
 */

/** Warp default long-running threshold (seconds). */
const DEFAULT_LONG_TASK_THRESHOLD_SEC = 30;
const MIN_LONG_TASK_THRESHOLD_SEC = 5;
const MAX_LONG_TASK_THRESHOLD_SEC = 600;

/** Palot-inspired per-key notify cooldown (ms). */
const DEFAULT_NOTIFY_COOLDOWN_MS = 30_000;
const MIN_NOTIFY_COOLDOWN_MS = 0;
const MAX_NOTIFY_COOLDOWN_MS = 600_000;

/** Default exponential backoff bounds (Palot SSE reconnect spirit). */
const DEFAULT_BACKOFF_BASE_MS = 1_000;
const DEFAULT_BACKOFF_MAX_MS = 30_000;

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

/**
 * @param {unknown} value
 * @param {number} [fallback]
 * @returns {number}
 */
function clampNotifyCooldownMs(value, fallback = DEFAULT_NOTIFY_COOLDOWN_MS) {
  const n = Number(value);
  if (!Number.isFinite(n)) return fallback;
  return Math.min(
    MAX_NOTIFY_COOLDOWN_MS,
    Math.max(MIN_NOTIFY_COOLDOWN_MS, Math.round(n)),
  );
}

/**
 * Stable map key for per-kind + per-scope cooldown (Palot session+type).
 * @param {string} kind
 * @param {string} [scope]
 * @returns {string}
 */
function notifyCooldownKey(kind, scope) {
  const k = String(kind || "unknown").slice(0, 64);
  const s = String(scope || "app").trim().slice(0, 200) || "app";
  return `${k}:${s}`;
}

/**
 * Whether a prior show within the cooldown window should suppress.
 *
 * @param {{
 *   lastShownAt?: number,
 *   now?: number,
 *   cooldownMs?: number,
 * }} input
 * @returns {{
 *   suppress: boolean,
 *   reason: string,
 *   cooldownMs: number,
 *   remainingMs: number,
 * }}
 */
function evaluateNotifyCooldown(input = {}) {
  const cooldownMs = clampNotifyCooldownMs(input.cooldownMs);
  const now = Number(input.now);
  if (!Number.isFinite(now)) {
    return {
      suppress: false,
      reason: "invalid-now",
      cooldownMs,
      remainingMs: 0,
    };
  }
  if (cooldownMs <= 0) {
    return {
      suppress: false,
      reason: "cooldown-disabled",
      cooldownMs: 0,
      remainingMs: 0,
    };
  }
  const last = Number(input.lastShownAt);
  if (!Number.isFinite(last) || last <= 0) {
    return {
      suppress: false,
      reason: "no-prior",
      cooldownMs,
      remainingMs: 0,
    };
  }
  const elapsed = now - last;
  if (elapsed < cooldownMs) {
    return {
      suppress: true,
      reason: "cooldown",
      cooldownMs,
      remainingMs: Math.max(0, cooldownMs - elapsed),
    };
  }
  return {
    suppress: false,
    reason: "elapsed",
    cooldownMs,
    remainingMs: 0,
  };
}

/**
 * Full plan: base Warp gates + Palot cooldown. Host records shown time when
 * `recordShown` is true after a successful OS notification.
 *
 * @param {{
 *   kind: NotifyKind,
 *   windowFocused: boolean,
 *   osSupported?: boolean,
 *   notifyOnGrokExit?: boolean,
 *   notifyOnLongTask?: boolean,
 *   durationMs?: number,
 *   longTaskThresholdSec?: number,
 *   scope?: string,
 *   sessionId?: string,
 *   lastShownAt?: number,
 *   now?: number,
 *   cooldownMs?: number,
 * }} input
 * @returns {{
 *   show: boolean,
 *   reason: string,
 *   cooldownKey: string | null,
 *   recordShown: boolean,
 *   remainingMs?: number,
 * }}
 */
function planDesktopNotification(input = {}) {
  const base = shouldShowDesktopNotification(input);
  const scope = input.scope || input.sessionId || "app";
  const cooldownKey = notifyCooldownKey(input.kind, scope);
  if (!base.show) {
    return {
      show: false,
      reason: base.reason,
      cooldownKey,
      recordShown: false,
    };
  }
  const cool = evaluateNotifyCooldown({
    lastShownAt: input.lastShownAt,
    now: input.now,
    cooldownMs: input.cooldownMs,
  });
  if (cool.suppress) {
    return {
      show: false,
      reason: "cooldown",
      cooldownKey,
      recordShown: false,
      remainingMs: cool.remainingMs,
    };
  }
  return {
    show: true,
    reason: base.reason,
    cooldownKey,
    recordShown: true,
  };
}

/**
 * Pure exponential backoff delay (Palot SSE reconnect spirit).
 * attempt 0 → baseMs, then doubles until maxMs.
 *
 * @param {{
 *   attempt?: number,
 *   baseMs?: number,
 *   maxMs?: number,
 *   factor?: number,
 * }} [input]
 * @returns {number}
 */
function planBackoffDelayMs(input = {}) {
  const attempt = Math.max(0, Math.floor(Number(input.attempt) || 0));
  const baseMs = Math.max(
    0,
    Math.round(Number(input.baseMs) || DEFAULT_BACKOFF_BASE_MS),
  );
  const maxMs = Math.max(
    baseMs,
    Math.round(Number(input.maxMs) || DEFAULT_BACKOFF_MAX_MS),
  );
  const factor = Math.max(1, Number(input.factor) || 2);
  if (baseMs === 0) return 0;
  // Cap exponent to avoid Infinity for huge attempt
  const exp = Math.min(attempt, 20);
  const raw = baseMs * factor ** exp;
  return Math.min(maxMs, Math.round(raw));
}

module.exports = {
  shouldShowDesktopNotification,
  planDesktopNotification,
  evaluateNotifyCooldown,
  notifyCooldownKey,
  clampNotifyCooldownMs,
  clampLongTaskThresholdSec,
  planBackoffDelayMs,
  DEFAULT_LONG_TASK_THRESHOLD_SEC,
  MIN_LONG_TASK_THRESHOLD_SEC,
  MAX_LONG_TASK_THRESHOLD_SEC,
  DEFAULT_NOTIFY_COOLDOWN_MS,
  MIN_NOTIFY_COOLDOWN_MS,
  MAX_NOTIFY_COOLDOWN_MS,
  DEFAULT_BACKOFF_BASE_MS,
  DEFAULT_BACKOFF_MAX_MS,
};
