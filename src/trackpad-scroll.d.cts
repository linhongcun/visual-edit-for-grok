export function trackpadScrollPixels(
  deltaY: number,
  deltaMode: number,
  rowPx: number,
  viewportHeight: number,
  dtMs: number,
): number;

export function trackpadScrollPixelsFromFrame(frameDeltaY: number): number;

export function trackpadTuiWheelImpulseFromFrame(
  frameDeltaY: number,
  rowPx: number,
): number;
