/**
 * Velocity-proportional trackpad/mouse wheel → viewport pixel delta.
 * Pure (no DOM) — used by TerminalPane and unit tests.
 *
 * @param {number} deltaY
 * @param {number} deltaMode  0=pixel, 1=line, 2=page
 * @param {number} rowPx
 * @param {number} viewportHeight
 * @param {number} dtMs  ms since previous wheel event
 * @returns {number} signed pixels to add to scrollTop
 */
function trackpadScrollPixels(
  deltaY,
  deltaMode,
  rowPx,
  viewportHeight,
  dtMs,
) {
  if (!Number.isFinite(deltaY) || deltaY === 0) return 0;

  if (deltaMode === 1 /* DOM_DELTA_LINE */) {
    return deltaY * Math.max(10, Number(rowPx) || 14) * 2.5;
  }
  if (deltaMode === 2 /* DOM_DELTA_PAGE */) {
    return deltaY * Math.max(1, Number(viewportHeight) || 1);
  }

  // DOM_DELTA_PIXEL — macOS trackpad / precision wheel
  const abs = Math.abs(deltaY);
  // Magnitude: slow tiny deltas stay near 1×; larger flicks rise toward ~5×
  const magT = abs / (abs + 14);
  const magGain = 1 + 4 * magT;

  // Instantaneous speed (px/ms). Slow glide is low; quick flick is high.
  const dt = Math.max(4, Math.min(48, Number.isFinite(dtMs) ? dtMs : 16));
  const pxPerMs = abs / dt;
  const speedT = Math.min(1, pxPerMs / 1.6);
  const speedEase = speedT * speedT * (3 - 2 * speedT);
  const speedGain = 1 + 2.8 * speedEase;

  return deltaY * magGain * speedGain;
}

module.exports = { trackpadScrollPixels };
