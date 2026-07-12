/**
 * Pure terminal host settings helpers — renderer copy kept next to UI imports.
 * Keep in sync with electron/term-settings.cjs (main process packaging).
 * Duplicated deliberately so Vite bundles without pulling electron/ into the renderer graph,
 * and electron-builder asar always has electron/term-settings.cjs for settings-store.
 */

const TERM_FONT_SIZE_MIN = 10;
const TERM_FONT_SIZE_MAX = 22;
const TERM_FONT_SIZE_DEFAULT = 12;

const TERM_SCROLLBACK_MIN = 1000;
const TERM_SCROLLBACK_MAX = 50000;
const TERM_SCROLLBACK_DEFAULT = 10000;

/**
 * xterm minimumContrastRatio: 1 = off, 4.5 = WCAG AA, 7 = AAA, max 21.
 * Default AA helps Grok TUI muted colors stay readable without settings chrome.
 */
const TERM_MIN_CONTRAST_MIN = 1;
const TERM_MIN_CONTRAST_MAX = 21;
const TERM_MIN_CONTRAST_DEFAULT = 4.5;

/** After WebGL context loss: how many re-attach attempts before staying on canvas. */
const WEBGL_CONTEXT_LOSS_MAX_RETRIES = 1;
const WEBGL_CONTEXT_LOSS_RETRY_DELAY_MS = 500;

/**
 * @param {unknown} value
 * @param {number} [fallback]
 * @returns {number}
 */
function clampTermFontSize(value, fallback = TERM_FONT_SIZE_DEFAULT) {
  const n = typeof value === "number" ? value : Number(value);
  if (!Number.isFinite(n)) return fallback;
  return Math.min(TERM_FONT_SIZE_MAX, Math.max(TERM_FONT_SIZE_MIN, Math.round(n)));
}

/**
 * @param {number} current
 * @param {1 | -1 | 0} delta
 * @returns {number}
 */
function nextTermFontSize(current, delta) {
  if (delta === 0) return TERM_FONT_SIZE_DEFAULT;
  return clampTermFontSize(clampTermFontSize(current) + delta);
}

/**
 * @param {unknown} value
 * @param {number} [fallback]
 * @returns {number}
 */
function clampTermScrollback(value, fallback = TERM_SCROLLBACK_DEFAULT) {
  const n = typeof value === "number" ? value : Number(value);
  if (!Number.isFinite(n)) return fallback;
  return Math.min(
    TERM_SCROLLBACK_MAX,
    Math.max(TERM_SCROLLBACK_MIN, Math.round(n)),
  );
}

/**
 * @param {unknown} value
 * @param {boolean} [fallback]
 * @returns {boolean}
 */
function asBoolean(value, fallback = false) {
  if (typeof value === "boolean") return value;
  return fallback;
}

/**
 * Clamp xterm `minimumContrastRatio` (1 disables, up to 21).
 * @param {unknown} value
 * @param {number} [fallback]
 * @returns {number}
 */
function clampMinimumContrastRatio(
  value,
  fallback = TERM_MIN_CONTRAST_DEFAULT,
) {
  const n = typeof value === "number" ? value : Number(value);
  if (!Number.isFinite(n)) return fallback;
  const clamped = Math.min(TERM_MIN_CONTRAST_MAX, Math.max(TERM_MIN_CONTRAST_MIN, n));
  return Math.round(clamped * 10) / 10;
}

/**
 * Whether attach/retry of WebGL should run for this terminal instance.
 * Initial open may have termRef still null — that must NOT block first attach.
 * Only skip when disposed, or when ref already points at a different Terminal.
 *
 * @param {{
 *   disposed?: boolean,
 *   termRefCurrent?: unknown,
 *   term?: unknown,
 * }} [input]
 * @returns {{ ok: boolean, reason: string }}
 */
function mayAttachWebglRenderer(input = {}) {
  if (input.disposed) {
    return { ok: false, reason: "disposed" };
  }
  if (
    input.termRefCurrent != null &&
    input.term !== undefined &&
    input.termRefCurrent !== input.term
  ) {
    return { ok: false, reason: "stale-term" };
  }
  return { ok: true, reason: "ok" };
}

/**
 * Plan reaction to WebGL context loss (xterm addon-webgl README).
 * Always dispose the dead addon; optionally schedule one re-attach after sleep/OOM.
 *
 * @param {{
 *   lossCount?: number,
 *   maxRetries?: number,
 *   retryDelayMs?: number,
 * }} [input]
 * @returns {{
 *   action: "dispose-to-canvas" | "retry-webgl",
 *   reason: string,
 *   nextLossCount: number,
 *   retryDelayMs: number,
 * }}
 */
function planWebglContextLoss(input = {}) {
  const maxRetries = Math.max(
    0,
    Math.min(
      10,
      Number.isFinite(Number(input.maxRetries))
        ? Math.floor(Number(input.maxRetries))
        : WEBGL_CONTEXT_LOSS_MAX_RETRIES,
    ),
  );
  const lossCount = Math.max(0, Math.floor(Number(input.lossCount) || 0));
  const nextLossCount = lossCount + 1;
  const retryDelayMs = Math.max(
    0,
    Math.min(
      60_000,
      Number.isFinite(Number(input.retryDelayMs))
        ? Math.round(Number(input.retryDelayMs))
        : WEBGL_CONTEXT_LOSS_RETRY_DELAY_MS,
    ),
  );

  if (lossCount >= maxRetries) {
    return {
      action: "dispose-to-canvas",
      reason: "budget-exhausted",
      nextLossCount,
      retryDelayMs: 0,
    };
  }

  return {
    action: "retry-webgl",
    reason: "retry-after-loss",
    nextLossCount,
    retryDelayMs,
  };
}

module.exports = {
  TERM_FONT_SIZE_MIN,
  TERM_FONT_SIZE_MAX,
  TERM_FONT_SIZE_DEFAULT,
  TERM_SCROLLBACK_MIN,
  TERM_SCROLLBACK_MAX,
  TERM_SCROLLBACK_DEFAULT,
  TERM_MIN_CONTRAST_MIN,
  TERM_MIN_CONTRAST_MAX,
  TERM_MIN_CONTRAST_DEFAULT,
  WEBGL_CONTEXT_LOSS_MAX_RETRIES,
  WEBGL_CONTEXT_LOSS_RETRY_DELAY_MS,
  clampTermFontSize,
  nextTermFontSize,
  clampTermScrollback,
  clampMinimumContrastRatio,
  mayAttachWebglRenderer,
  planWebglContextLoss,
  asBoolean,
};
