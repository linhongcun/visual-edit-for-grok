/**
 * Pure terminal host settings helpers (font, scrollback, clamps).
 * Inspired by mature terminal UX (e.g. Warp) — reimplemented for our product.
 */

const TERM_FONT_SIZE_MIN = 10;
const TERM_FONT_SIZE_MAX = 22;
const TERM_FONT_SIZE_DEFAULT = 12;

const TERM_SCROLLBACK_MIN = 1000;
const TERM_SCROLLBACK_MAX = 50000;
const TERM_SCROLLBACK_DEFAULT = 10000;

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
 * @param {1 | -1 | 0} delta  1=zoom in, -1=zoom out, 0=reset
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

module.exports = {
  TERM_FONT_SIZE_MIN,
  TERM_FONT_SIZE_MAX,
  TERM_FONT_SIZE_DEFAULT,
  TERM_SCROLLBACK_MIN,
  TERM_SCROLLBACK_MAX,
  TERM_SCROLLBACK_DEFAULT,
  clampTermFontSize,
  nextTermFontSize,
  clampTermScrollback,
  asBoolean,
};
