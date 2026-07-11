/**
 * Unit tests for velocity-proportional trackpad scroll (shipped helper).
 */
const assert = require("assert");
const {
  trackpadScrollPixels,
  trackpadScrollPixelsFromFrame,
} = require("../src/trackpad-scroll.cjs");

function testZeroDelta() {
  assert.strictEqual(trackpadScrollPixels(0, 0, 14, 400, 16), 0);
  assert.strictEqual(trackpadScrollPixelsFromFrame(0), 0);
}

function testSlowIsUsableButNotHuge() {
  // Tiny glide: a few px/event, relaxed timing
  const px = Math.abs(trackpadScrollPixels(2, 0, 14, 400, 24));
  const gain = px / 2;
  assert.ok(gain >= 2.5 && gain <= 8, `slow gain out of range: ${gain}`);
}

function testFastFlickMuchFasterThanSlow() {
  const slow = Math.abs(trackpadScrollPixels(2, 0, 14, 400, 30));
  // Fast: large delta, short interval (typical flick sample)
  const fast = Math.abs(trackpadScrollPixels(12, 0, 14, 400, 5));
  const slowGain = slow / 2;
  const fastGain = fast / 12;
  assert.ok(
    fastGain > slowGain * 1.8,
    `fast gain (${fastGain.toFixed(2)}) should clearly beat slow (${slowGain.toFixed(2)})`,
  );
  assert.ok(fast > slow * 4, "absolute travel of a flick sample dominates a glide sample");
}

function testFrameBatchBoostsFlicks() {
  const slowFrame = Math.abs(trackpadScrollPixelsFromFrame(8));
  const flickFrame = Math.abs(trackpadScrollPixelsFromFrame(120));
  assert.ok(
    flickFrame / 120 > (slowFrame / 8) * 1.5,
    "frame-level flick gain should exceed slow-frame gain",
  );
  assert.ok(flickFrame > 800, "a strong flick frame should move a lot of viewport");
}

function testDirectionPreserved() {
  const up = trackpadScrollPixels(-15, 0, 14, 400, 8);
  const down = trackpadScrollPixels(15, 0, 14, 400, 8);
  assert.ok(up < 0 && down > 0);
  assert.ok(Math.abs(Math.abs(up) - Math.abs(down)) < 1e-6);
}

function testLineAndPageModes() {
  const line = trackpadScrollPixels(2, 1, 14, 400, 16);
  assert.strictEqual(line, 2 * 14 * 4);
  const page = trackpadScrollPixels(1, 2, 14, 400, 16);
  assert.strictEqual(page, 400);
}

function run() {
  const tests = [
    testZeroDelta,
    testSlowIsUsableButNotHuge,
    testFastFlickMuchFasterThanSlow,
    testFrameBatchBoostsFlicks,
    testDirectionPreserved,
    testLineAndPageModes,
  ];
  let failed = 0;
  for (const t of tests) {
    try {
      t();
      console.log(`ok  - ${t.name}`);
    } catch (err) {
      failed += 1;
      console.error(`fail - ${t.name}`, err);
    }
  }
  console.log(`\n${tests.length - failed}/${tests.length} passed`);
  if (failed) process.exit(1);
}

run();
