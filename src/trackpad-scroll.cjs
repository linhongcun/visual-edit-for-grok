/**
 * Velocity-proportional trackpad/mouse wheel → viewport pixel delta.
 * Pure (no DOM) — used by TerminalPane and unit tests.
 *
 * Design goals (macOS trackpad):
 * - Slow glide → modest scroll (still usable, not glacial)
 * - Fast flick → much larger travel (clearly tracks finger speed)
 * - Always proportional to signed deltaY (direction preserved)
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
    // Mouse wheel notches — a few lines each
    return deltaY * Math.max(10, Number(rowPx) || 14) * 4;
  }
  if (deltaMode === 2 /* DOM_DELTA_PAGE */) {
    return deltaY * Math.max(1, Number(viewportHeight) || 1);
  }

  // DOM_DELTA_PIXEL — macOS trackpad / precision wheel
  const abs = Math.abs(deltaY);
  const dt = Math.max(3, Math.min(50, Number.isFinite(dtMs) ? dtMs : 16));
  // Instantaneous speed in CSS-px per ms
  const v = abs / dt;

  // Ease-in so only genuinely fast gestures hit high gain:
  // v≈0.1 (slow) → t small; v≈1.0+ (flick) → t→1
  const t = Math.min(1, v / 0.9);
  const ease = t * t; // quadratic ease-in
  // Slow ≈ 3×, fast ≈ 22×  (deltaY already grows with finger speed)
  const speedGain = 3 + 19 * ease;

  // Extra boost when a single event itself is large (coalesced flick samples)
  const magGain = 1 + Math.min(2.5, abs / 18);

  return deltaY * speedGain * magGain;
}

/**
 * Convert a batch of pixel deltas accumulated in one animation frame.
 * Larger frame totals (fast flicks) get higher gain than the same total
 * spread across many slow frames.
 *
 * @param {number} frameDeltaY  sum of pixel-mode deltaY in this frame
 * @returns {number} signed pixels for scrollTop
 */
function trackpadScrollPixelsFromFrame(frameDeltaY) {
  if (!Number.isFinite(frameDeltaY) || frameDeltaY === 0) return 0;
  const abs = Math.abs(frameDeltaY);
  // Frame budget at 60Hz ≈ 16ms; treat |sum| as motion energy this frame
  // slow frame ~4–12px, medium ~30–60, flick often 80–250+
  const t = Math.min(1, abs / 90);
  const ease = t * t * (3 - 2 * t); // smoothstep
  const gain = 2.5 + 20 * ease; // 2.5× … 22.5×
  return frameDeltaY * gain;
}

module.exports = {
  trackpadScrollPixels,
  trackpadScrollPixelsFromFrame,
};
