/**
 * Unit tests for velocity-proportional trackpad scroll (shipped helper).
 */
const assert = require("assert");
const {
  trackpadScrollPixels,
} = require("../src/trackpad-scroll.cjs");

function testZeroDelta() {
  assert.strictEqual(trackpadScrollPixels(0, 0, 14, 400, 16), 0);
}

function testSlowPixelIsNearLinear() {
  // Small delta, relaxed timing → gain close to ~1.x
  const px = trackpadScrollPixels(2, 0, 14, 400, 24);
  const gain = Math.abs(px / 2);
  assert.ok(gain >= 0.9 && gain <= 2.2, `slow gain should be modest, got ${gain}`);
  assert.ok(px > 0, "sign preserved");
}

function testFastFlickGainsMoreThanSlow() {
  const slow = Math.abs(trackpadScrollPixels(3, 0, 14, 400, 30));
  const fast = Math.abs(trackpadScrollPixels(40, 0, 14, 400, 8));
  // Per-unit gain should be higher for the fast/large gesture
  const slowGain = slow / 3;
  const fastGain = fast / 40;
  assert.ok(
    fastGain > slowGain * 1.3,
    `fast gain (${fastGain}) should exceed slow gain (${slowGain})`,
  );
  // Absolute travel of a flick should dominate a tiny glide
  assert.ok(fast > slow * 5, "fast flick moves much farther");
}

function testDirectionPreserved() {
  const up = trackpadScrollPixels(-20, 0, 14, 400, 10);
  const down = trackpadScrollPixels(20, 0, 14, 400, 10);
  assert.ok(up < 0 && down > 0);
  assert.ok(Math.abs(Math.abs(up) - Math.abs(down)) < 1e-6);
}

function testLineAndPageModes() {
  const line = trackpadScrollPixels(2, 1, 14, 400, 16);
  assert.strictEqual(line, 2 * 14 * 2.5);
  const page = trackpadScrollPixels(1, 2, 14, 400, 16);
  assert.strictEqual(page, 400);
}

function run() {
  const tests = [
    testZeroDelta,
    testSlowPixelIsNearLinear,
    testFastFlickGainsMoreThanSlow,
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
