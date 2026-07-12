/**
 * Unit tests for terminal host settings helpers (incl. xterm-derived policy).
 * Run: node test/term-settings.test.cjs
 */
const assert = require("assert");
const fs = require("fs");
const path = require("path");
const {
  clampTermFontSize,
  nextTermFontSize,
  clampTermScrollback,
  clampMinimumContrastRatio,
  planWebglContextLoss,
  asBoolean,
  TERM_FONT_SIZE_DEFAULT,
  TERM_FONT_SIZE_MIN,
  TERM_FONT_SIZE_MAX,
  TERM_SCROLLBACK_DEFAULT,
  TERM_MIN_CONTRAST_DEFAULT,
  TERM_MIN_CONTRAST_MIN,
  TERM_MIN_CONTRAST_MAX,
  WEBGL_CONTEXT_LOSS_MAX_RETRIES,
  WEBGL_CONTEXT_LOSS_RETRY_DELAY_MS,
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

/** xterm WCAG contrast option clamp */
function testMinimumContrastRatioClamp() {
  assert.strictEqual(TERM_MIN_CONTRAST_DEFAULT, 4.5);
  assert.strictEqual(clampMinimumContrastRatio(undefined), 4.5);
  assert.strictEqual(clampMinimumContrastRatio("nope"), 4.5);
  assert.strictEqual(clampMinimumContrastRatio(0), TERM_MIN_CONTRAST_MIN);
  assert.strictEqual(clampMinimumContrastRatio(-3), TERM_MIN_CONTRAST_MIN);
  assert.strictEqual(clampMinimumContrastRatio(99), TERM_MIN_CONTRAST_MAX);
  assert.strictEqual(clampMinimumContrastRatio(4.5), 4.5);
  assert.strictEqual(clampMinimumContrastRatio(7), 7);
  assert.strictEqual(clampMinimumContrastRatio(1), 1);
}

/**
 * First context loss → retry WebGL; after budget → canvas only.
 * Mirrors inventory contract for planWebglContextLoss.
 */
function testWebglContextLossPlan() {
  const first = planWebglContextLoss({ lossCount: 0 });
  assert.strictEqual(first.action, "retry-webgl");
  assert.strictEqual(first.reason, "retry-after-loss");
  assert.strictEqual(first.nextLossCount, 1);
  assert.strictEqual(first.retryDelayMs, WEBGL_CONTEXT_LOSS_RETRY_DELAY_MS);

  const second = planWebglContextLoss({
    lossCount: first.nextLossCount,
    maxRetries: WEBGL_CONTEXT_LOSS_MAX_RETRIES,
  });
  assert.strictEqual(second.action, "dispose-to-canvas");
  assert.strictEqual(second.reason, "budget-exhausted");
  assert.strictEqual(second.nextLossCount, 2);
  assert.strictEqual(second.retryDelayMs, 0);

  const zeroBudget = planWebglContextLoss({ lossCount: 0, maxRetries: 0 });
  assert.strictEqual(zeroBudget.action, "dispose-to-canvas");
  assert.strictEqual(zeroBudget.reason, "budget-exhausted");

  const custom = planWebglContextLoss({
    lossCount: 0,
    maxRetries: 2,
    retryDelayMs: 1200,
  });
  assert.strictEqual(custom.action, "retry-webgl");
  assert.strictEqual(custom.retryDelayMs, 1200);
  const third = planWebglContextLoss({
    lossCount: 1,
    maxRetries: 2,
    retryDelayMs: 1200,
  });
  assert.strictEqual(third.action, "retry-webgl");
  const done = planWebglContextLoss({ lossCount: 2, maxRetries: 2 });
  assert.strictEqual(done.action, "dispose-to-canvas");
}

/** Renderer + electron copies export the same xterm helpers */
function testSrcAndElectronTermSettingsInSync() {
  const src = require("../src/term-settings.cjs");
  const electron = require("../electron/term-settings.cjs");
  assert.strictEqual(
    src.TERM_MIN_CONTRAST_DEFAULT,
    electron.TERM_MIN_CONTRAST_DEFAULT,
  );
  assert.strictEqual(
    src.WEBGL_CONTEXT_LOSS_MAX_RETRIES,
    electron.WEBGL_CONTEXT_LOSS_MAX_RETRIES,
  );
  const a = src.planWebglContextLoss({ lossCount: 0 });
  const b = electron.planWebglContextLoss({ lossCount: 0 });
  assert.deepStrictEqual(a, b);
  assert.strictEqual(
    src.clampMinimumContrastRatio(4.5),
    electron.clampMinimumContrastRatio(4.5),
  );
}

function testTerminalPaneWiresXtermPolicies() {
  const pane = fs.readFileSync(
    path.join(__dirname, "../src/components/TerminalPane.tsx"),
    "utf8",
  );
  assert.ok(pane.includes("planWebglContextLoss"));
  assert.ok(pane.includes("clampMinimumContrastRatio"));
  assert.ok(pane.includes("minimumContrastRatio"));
  assert.ok(pane.includes("onContextLoss"));
  assert.ok(pane.includes("retry-webgl") || pane.includes('plan.action !== "retry-webgl"'));
  assert.ok(pane.includes("attachWebglRenderer") || pane.includes("WebglAddon"));
}

function run() {
  const tests = [
    testFontClamp,
    testFontZoomSteps,
    testScrollbackClamp,
    testAsBoolean,
    testMinimumContrastRatioClamp,
    testWebglContextLossPlan,
    testSrcAndElectronTermSettingsInSync,
    testTerminalPaneWiresXtermPolicies,
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
