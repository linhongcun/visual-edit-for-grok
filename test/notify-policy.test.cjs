/**
 * Unit tests for shipped desktop notification policy.
 * Run: node test/notify-policy.test.cjs
 */
const assert = require("assert");
const fs = require("fs");
const path = require("path");
const {
  shouldShowDesktopNotification,
  clampLongTaskThresholdSec,
  DEFAULT_LONG_TASK_THRESHOLD_SEC,
} = require("../electron/notify-policy.cjs");

function testFocusedNeverNotifies() {
  const r = shouldShowDesktopNotification({
    kind: "session-exit",
    windowFocused: true,
    notifyOnGrokExit: true,
  });
  assert.strictEqual(r.show, false);
  assert.strictEqual(r.reason, "window-focused");

  const r2 = shouldShowDesktopNotification({
    kind: "long-task",
    windowFocused: true,
    notifyOnLongTask: true,
    durationMs: 60_000,
    longTaskThresholdSec: 30,
  });
  assert.strictEqual(r2.show, false);
}

function testSessionExitFlag() {
  assert.strictEqual(
    shouldShowDesktopNotification({
      kind: "session-exit",
      windowFocused: false,
      notifyOnGrokExit: true,
    }).show,
    true,
  );
  const off = shouldShowDesktopNotification({
    kind: "session-exit",
    windowFocused: false,
    notifyOnGrokExit: false,
  });
  assert.strictEqual(off.show, false);
  assert.strictEqual(off.reason, "session-exit-disabled");
}

function testLongTaskUnderThresholdNoNotify() {
  const r = shouldShowDesktopNotification({
    kind: "long-task",
    windowFocused: false,
    notifyOnLongTask: true,
    durationMs: 10_000,
    longTaskThresholdSec: DEFAULT_LONG_TASK_THRESHOLD_SEC,
  });
  assert.strictEqual(r.show, false);
  assert.strictEqual(r.reason, "under-threshold");
}

function testLongTaskMeetsThreshold() {
  const r = shouldShowDesktopNotification({
    kind: "long-task",
    windowFocused: false,
    notifyOnLongTask: true,
    durationMs: 30_000,
    longTaskThresholdSec: 30,
  });
  assert.strictEqual(r.show, true);
  assert.strictEqual(r.reason, "long-task");
}

function testLongTaskFlagOff() {
  const r = shouldShowDesktopNotification({
    kind: "long-task",
    windowFocused: false,
    notifyOnLongTask: false,
    durationMs: 120_000,
    longTaskThresholdSec: 30,
  });
  assert.strictEqual(r.show, false);
  assert.strictEqual(r.reason, "long-task-disabled");
}

function testOsUnsupported() {
  const r = shouldShowDesktopNotification({
    kind: "session-exit",
    windowFocused: false,
    osSupported: false,
    notifyOnGrokExit: true,
  });
  assert.strictEqual(r.show, false);
  assert.strictEqual(r.reason, "os-unsupported");
}

function testDefaultThresholdIsWarp30s() {
  assert.strictEqual(DEFAULT_LONG_TASK_THRESHOLD_SEC, 30);
  assert.strictEqual(clampLongTaskThresholdSec(undefined), 30);
  assert.strictEqual(clampLongTaskThresholdSec(1), 5);
  assert.strictEqual(clampLongTaskThresholdSec(9999), 600);
}

function testExactBoundary() {
  const justUnder = shouldShowDesktopNotification({
    kind: "long-task",
    windowFocused: false,
    notifyOnLongTask: true,
    durationMs: 29_999,
    longTaskThresholdSec: 30,
  });
  assert.strictEqual(justUnder.show, false);
  const exact = shouldShowDesktopNotification({
    kind: "long-task",
    windowFocused: false,
    notifyOnLongTask: true,
    durationMs: 30_000,
    longTaskThresholdSec: 30,
  });
  assert.strictEqual(exact.show, true);
}

/**
 * Structural: Aim must go through withCaptureLock so long-task notify applies.
 * Reads the shipped main.cjs source (not a reimplementation).
 */
function testAimPathUsesWithCaptureLock() {
  const mainPath = path.join(__dirname, "../electron/main.cjs");
  const main = fs.readFileSync(mainPath, "utf8");
  const start = main.indexOf("async function handleTrustedAimSelection");
  assert.ok(start >= 0, "handleTrustedAimSelection must exist");
  const nextFn = main.indexOf("\nfunction createPreviewView", start);
  const body =
    nextFn > start ? main.slice(start, nextFn) : main.slice(start, start + 8000);
  assert.ok(
    body.includes("withCaptureLock"),
    "Aim path must call withCaptureLock for long-task notifications",
  );
  assert.ok(
    !body.includes("setCaptureBusy(true)"),
    "Aim must not use bare setCaptureBusy(true); withCaptureLock owns the lock",
  );
  assert.ok(
    body.includes("notify.longTaskAimLabel") || body.includes("longTaskAim"),
    "Aim lock should label notifications as Aim",
  );
}

function run() {
  const tests = [
    testFocusedNeverNotifies,
    testSessionExitFlag,
    testLongTaskUnderThresholdNoNotify,
    testLongTaskMeetsThreshold,
    testLongTaskFlagOff,
    testOsUnsupported,
    testDefaultThresholdIsWarp30s,
    testExactBoundary,
    testAimPathUsesWithCaptureLock,
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
