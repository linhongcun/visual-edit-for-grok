/**
 * Unit tests for terminal host settings helpers.
 * Run: node test/term-settings.test.cjs
 */
const assert = require("assert");
const {
  clampTermFontSize,
  nextTermFontSize,
  clampTermScrollback,
  asBoolean,
  TERM_FONT_SIZE_DEFAULT,
  TERM_FONT_SIZE_MIN,
  TERM_FONT_SIZE_MAX,
  TERM_SCROLLBACK_DEFAULT,
} = require("../electron/term-settings.cjs");

function testFontClamp() {
  assert.strictEqual(clampTermFontSize(12), 12);
  assert.strictEqual(clampTermFontSize(9), TERM_FONT_SIZE_MIN);
  assert.strictEqual(clampTermFontSize(99), TERM_FONT_SIZE_MAX);
  assert.strictEqual(clampTermFontSize("14"), 14);
  assert.strictEqual(clampTermFontSize("nope"), TERM_FONT_SIZE_DEFAULT);
  assert.strictEqual(clampTermFontSize(undefined), TERM_FONT_SIZE_DEFAULT);
}

function testFontZoomSteps() {
  assert.strictEqual(nextTermFontSize(12, 1), 13);
  assert.strictEqual(nextTermFontSize(12, -1), 11);
  assert.strictEqual(nextTermFontSize(12, 0), TERM_FONT_SIZE_DEFAULT);
  assert.strictEqual(nextTermFontSize(TERM_FONT_SIZE_MAX, 1), TERM_FONT_SIZE_MAX);
  assert.strictEqual(nextTermFontSize(TERM_FONT_SIZE_MIN, -1), TERM_FONT_SIZE_MIN);
}

function testScrollbackClamp() {
  assert.strictEqual(clampTermScrollback(10000), 10000);
  assert.strictEqual(clampTermScrollback(10), 1000);
  assert.strictEqual(clampTermScrollback(999999), 50000);
  assert.strictEqual(clampTermScrollback("bad"), TERM_SCROLLBACK_DEFAULT);
}

function testAsBoolean() {
  assert.strictEqual(asBoolean(true), true);
  assert.strictEqual(asBoolean(false), false);
  assert.strictEqual(asBoolean("yes", true), true);
  assert.strictEqual(asBoolean(null, true), true);
}

function run() {
  const tests = [
    testFontClamp,
    testFontZoomSteps,
    testScrollbackClamp,
    testAsBoolean,
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
