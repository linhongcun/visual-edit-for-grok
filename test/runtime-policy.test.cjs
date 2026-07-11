/**
 * Unit tests for shipped runtime policy (single-flight, cleanup throttle,
 * settings debounce, focus handoff, operator busy UX).
 */
const assert = require("assert");
const {
  canStartCapture,
  shouldRunCleanup,
  shouldFlushSettings,
  focusHandoffDelays,
  operatorActionState,
  planAimPickEvent,
  resolvePickCommit,
  DEFAULT_CLEANUP_MIN_INTERVAL_MS,
  DEFAULT_SETTINGS_DEBOUNCE_MS,
} = require("../electron/runtime-policy.cjs");

function testCanStartWhenIdle() {
  const r = canStartCapture({ inFlight: false });
  assert.strictEqual(r.ok, true);
  assert.strictEqual(r.reason, null);
}

function testRejectWhenBusy() {
  const r = canStartCapture({ inFlight: true });
  assert.strictEqual(r.ok, false);
  assert.strictEqual(r.reason, "busy");
  assert.ok(r.statusMessage && r.statusMessage.includes("progress"));
}

function testCleanupNeverRun() {
  const r = shouldRunCleanup({ lastCleanupAt: null, now: 1000 });
  assert.strictEqual(r.run, true);
  assert.strictEqual(r.reason, "never-run");
}

function testCleanupThrottled() {
  const now = 50_000;
  const r = shouldRunCleanup({
    lastCleanupAt: now - 1000,
    now,
    minIntervalMs: DEFAULT_CLEANUP_MIN_INTERVAL_MS,
  });
  assert.strictEqual(r.run, false);
  assert.strictEqual(r.reason, "throttled");
}

function testCleanupIntervalElapsed() {
  const now = 200_000;
  const r = shouldRunCleanup({
    lastCleanupAt: now - DEFAULT_CLEANUP_MIN_INTERVAL_MS - 1,
    now,
    minIntervalMs: DEFAULT_CLEANUP_MIN_INTERVAL_MS,
  });
  assert.strictEqual(r.run, true);
  assert.strictEqual(r.reason, "interval-elapsed");
}

function testCleanupForce() {
  const r = shouldRunCleanup({
    lastCleanupAt: Date.now(),
    now: Date.now(),
    force: true,
  });
  assert.strictEqual(r.run, true);
  assert.strictEqual(r.reason, "force");
}

function testSettingsDebounced() {
  const now = 10_000;
  const r = shouldFlushSettings({
    lastFlushAt: now - 50,
    now,
    minIntervalMs: DEFAULT_SETTINGS_DEBOUNCE_MS,
    dirty: true,
  });
  assert.strictEqual(r.flush, false);
  assert.strictEqual(r.reason, "debounced");
}

function testSettingsFlushAfterDebounce() {
  const now = 10_000;
  const r = shouldFlushSettings({
    lastFlushAt: now - DEFAULT_SETTINGS_DEBOUNCE_MS - 1,
    now,
    minIntervalMs: DEFAULT_SETTINGS_DEBOUNCE_MS,
    dirty: true,
  });
  assert.strictEqual(r.flush, true);
}

function testSettingsForceFlush() {
  const r = shouldFlushSettings({
    lastFlushAt: Date.now(),
    now: Date.now(),
    dirty: true,
    force: true,
  });
  assert.strictEqual(r.flush, true);
  assert.strictEqual(r.reason, "force");
}

function testSettingsCleanNoFlush() {
  const r = shouldFlushSettings({ dirty: false, force: false });
  assert.strictEqual(r.flush, false);
  assert.strictEqual(r.reason, "clean");
}

function testFocusHandoffDelaysShape() {
  const delays = focusHandoffDelays();
  assert.ok(Array.isArray(delays));
  assert.ok(delays.length >= 1 && delays.length <= 3);
  assert.strictEqual(delays[0], 0);
  // Strictly non-decreasing, no storm of many retries
  for (let i = 1; i < delays.length; i++) {
    assert.ok(delays[i] >= delays[i - 1]);
  }
}

function testOperatorBusyBlocksActions() {
  const r = operatorActionState({
    busy: true,
    terminalAlive: true,
    hasCapture: true,
  });
  assert.strictEqual(r.busy, true);
  assert.strictEqual(r.canAim, false);
  assert.strictEqual(r.canFrame, false);
  assert.strictEqual(r.canResend, false);
  assert.ok(r.hint && r.hint.includes("Busy"));
}

function testOperatorIdleWithCapture() {
  const r = operatorActionState({
    busy: false,
    terminalAlive: true,
    hasCapture: true,
  });
  assert.strictEqual(r.canAim, true);
  assert.strictEqual(r.canFrame, true);
  assert.strictEqual(r.canResend, true);
}

function testOperatorResendNeedsCapture() {
  const r = operatorActionState({
    busy: false,
    terminalAlive: true,
    hasCapture: false,
  });
  assert.strictEqual(r.canResend, false);
}

function testBusyRejectCancelsAimAndClearsOverlay() {
  const plan = planAimPickEvent({ inFlight: true });
  assert.strictEqual(plan.proceed, false);
  assert.strictEqual(plan.cancelPickMode, true);
  assert.strictEqual(plan.clearOverlay, true);
  assert.strictEqual(plan.reason, "busy");
  assert.ok(plan.statusMessage && plan.statusMessage.includes("progress"));
}

function testIdlePickProceedsWithoutClearingYet() {
  const plan = planAimPickEvent({ inFlight: false });
  assert.strictEqual(plan.proceed, true);
  assert.strictEqual(plan.cancelPickMode, true);
  // Overlay kept until success/failure commit
  assert.strictEqual(plan.clearOverlay, false);
  assert.strictEqual(plan.reason, null);
}

function testCommitSuccessPairsSelectionAndShot() {
  const prev = { tag: "old" };
  const next = { tag: "button", id: "cta" };
  const r = resolvePickCommit({
    ok: true,
    selection: next,
    screenshotPath: "/tmp/pick-el.png",
    prevSelection: prev,
    prevScreenshotPath: "/tmp/old.png",
  });
  assert.strictEqual(r.committed, true);
  assert.strictEqual(r.lastSelection, next);
  assert.strictEqual(r.lastScreenshotPath, "/tmp/pick-el.png");
  assert.strictEqual(r.clearOverlay, true);
  assert.strictEqual(r.cancelPickMode, true);
}

function testCommitFailureKeepsPreviousPair() {
  const prev = { tag: "old" };
  const r = resolvePickCommit({
    ok: false,
    selection: { tag: "new" },
    screenshotPath: "/tmp/new.png",
    prevSelection: prev,
    prevScreenshotPath: "/tmp/old.png",
  });
  assert.strictEqual(r.committed, false);
  assert.strictEqual(r.lastSelection, prev);
  assert.strictEqual(r.lastScreenshotPath, "/tmp/old.png");
  assert.strictEqual(r.clearOverlay, true);
  assert.strictEqual(r.cancelPickMode, true);
}

function testCommitRejectsSelectionWithoutShot() {
  const prev = { tag: "old" };
  const r = resolvePickCommit({
    ok: true,
    selection: { tag: "new" },
    screenshotPath: null,
    prevSelection: prev,
    prevScreenshotPath: "/tmp/old.png",
  });
  assert.strictEqual(r.committed, false);
  assert.strictEqual(r.lastSelection, prev);
  assert.strictEqual(r.lastScreenshotPath, "/tmp/old.png");
}

function testCommitFrameOnlyUpdatesShotKeepsPrevSelection() {
  const prev = { tag: "old" };
  const r = resolvePickCommit({
    ok: true,
    selection: null,
    screenshotPath: "/tmp/frame.png",
    prevSelection: prev,
    prevScreenshotPath: "/tmp/old.png",
  });
  assert.strictEqual(r.committed, true);
  assert.strictEqual(r.lastSelection, prev);
  assert.strictEqual(r.lastScreenshotPath, "/tmp/frame.png");
}

function testBusyRejectThenFailureNeverPairsNewDomWithOldShot() {
  // Overlapping Frame+Aim: busy reject must not leave half-committed pick
  const plan = planAimPickEvent({ inFlight: true });
  assert.strictEqual(plan.proceed, false);
  assert.strictEqual(plan.cancelPickMode, true);
  assert.strictEqual(plan.clearOverlay, true);

  const prevSel = { tag: "button", id: "keep" };
  const prevShot = "/captures/prev.png";
  // Simulate main never assigning lastSelection on reject — commit not called
  // On a failed proceed path mid-flight:
  const failed = resolvePickCommit({
    ok: false,
    selection: { tag: "div", id: "new" },
    screenshotPath: null,
    prevSelection: prevSel,
    prevScreenshotPath: prevShot,
  });
  assert.strictEqual(failed.lastSelection, prevSel);
  assert.strictEqual(failed.lastScreenshotPath, prevShot);
  // Re-send would still see coherent pair
  assert.ok(failed.lastSelection && failed.lastScreenshotPath);
}

function run() {
  const tests = [
    testCanStartWhenIdle,
    testRejectWhenBusy,
    testCleanupNeverRun,
    testCleanupThrottled,
    testCleanupIntervalElapsed,
    testCleanupForce,
    testSettingsDebounced,
    testSettingsFlushAfterDebounce,
    testSettingsForceFlush,
    testSettingsCleanNoFlush,
    testFocusHandoffDelaysShape,
    testOperatorBusyBlocksActions,
    testOperatorIdleWithCapture,
    testOperatorResendNeedsCapture,
    testBusyRejectCancelsAimAndClearsOverlay,
    testIdlePickProceedsWithoutClearingYet,
    testCommitSuccessPairsSelectionAndShot,
    testCommitFailureKeepsPreviousPair,
    testCommitRejectsSelectionWithoutShot,
    testCommitFrameOnlyUpdatesShotKeepsPrevSelection,
    testBusyRejectThenFailureNeverPairsNewDomWithOldShot,
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
