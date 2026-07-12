/**
 * Unit tests for shipped desktop notification policy.
 * Run: node test/notify-policy.test.cjs
 */
const assert = require("assert");
const fs = require("fs");
const path = require("path");
const {
  shouldShowDesktopNotification,
  planDesktopNotification,
  evaluateNotifyCooldown,
  notifyCooldownKey,
  clampLongTaskThresholdSec,
  clampNotifyCooldownMs,
  planBackoffDelayMs,
  DEFAULT_LONG_TASK_THRESHOLD_SEC,
  DEFAULT_NOTIFY_COOLDOWN_MS,
  DEFAULT_BACKOFF_BASE_MS,
  DEFAULT_BACKOFF_MAX_MS,
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

/** Palot: same key within 30s is suppressed; after window fires again. */
function testCooldownSuppressesSecondFire() {
  const now = 1_000_000;
  const first = planDesktopNotification({
    kind: "session-exit",
    windowFocused: false,
    notifyOnGrokExit: true,
    sessionId: "tab-a",
    lastShownAt: 0,
    now,
    cooldownMs: DEFAULT_NOTIFY_COOLDOWN_MS,
  });
  assert.strictEqual(first.show, true);
  assert.strictEqual(first.recordShown, true);
  assert.strictEqual(first.cooldownKey, "session-exit:tab-a");

  const spam = planDesktopNotification({
    kind: "session-exit",
    windowFocused: false,
    notifyOnGrokExit: true,
    sessionId: "tab-a",
    lastShownAt: now,
    now: now + 5_000,
    cooldownMs: DEFAULT_NOTIFY_COOLDOWN_MS,
  });
  assert.strictEqual(spam.show, false);
  assert.strictEqual(spam.reason, "cooldown");
  assert.ok(spam.remainingMs > 0);
  assert.strictEqual(spam.recordShown, false);

  const after = planDesktopNotification({
    kind: "session-exit",
    windowFocused: false,
    notifyOnGrokExit: true,
    sessionId: "tab-a",
    lastShownAt: now,
    now: now + DEFAULT_NOTIFY_COOLDOWN_MS,
    cooldownMs: DEFAULT_NOTIFY_COOLDOWN_MS,
  });
  assert.strictEqual(after.show, true);
  assert.strictEqual(after.recordShown, true);
}

/** Different scopes do not share cooldown. */
function testCooldownIsPerScope() {
  const now = 2_000_000;
  const a = planDesktopNotification({
    kind: "session-exit",
    windowFocused: false,
    notifyOnGrokExit: true,
    sessionId: "s1",
    lastShownAt: now,
    now: now + 1_000,
  });
  assert.strictEqual(a.show, false);
  assert.strictEqual(a.reason, "cooldown");

  const b = planDesktopNotification({
    kind: "session-exit",
    windowFocused: false,
    notifyOnGrokExit: true,
    sessionId: "s2",
    lastShownAt: 0,
    now: now + 1_000,
  });
  assert.strictEqual(b.show, true);
  assert.strictEqual(b.cooldownKey, "session-exit:s2");
}

/** Base focused gate still wins over cooldown. */
function testPlanStillRespectsFocused() {
  const r = planDesktopNotification({
    kind: "long-task",
    windowFocused: true,
    notifyOnLongTask: true,
    durationMs: 60_000,
    scope: "capture",
    lastShownAt: 0,
    now: Date.now(),
  });
  assert.strictEqual(r.show, false);
  assert.strictEqual(r.reason, "window-focused");
  assert.strictEqual(r.recordShown, false);
}

function testEvaluateNotifyCooldownPure() {
  const cool = evaluateNotifyCooldown({
    lastShownAt: 100,
    now: 100 + DEFAULT_NOTIFY_COOLDOWN_MS - 1,
    cooldownMs: DEFAULT_NOTIFY_COOLDOWN_MS,
  });
  assert.strictEqual(cool.suppress, true);
  assert.strictEqual(cool.reason, "cooldown");

  const ok = evaluateNotifyCooldown({
    lastShownAt: 100,
    now: 100 + DEFAULT_NOTIFY_COOLDOWN_MS,
    cooldownMs: DEFAULT_NOTIFY_COOLDOWN_MS,
  });
  assert.strictEqual(ok.suppress, false);

  assert.strictEqual(notifyCooldownKey("session-exit", "abc"), "session-exit:abc");
  assert.strictEqual(clampNotifyCooldownMs(-1), 0);
  assert.strictEqual(clampNotifyCooldownMs(999_999_999), 600_000);
  assert.strictEqual(DEFAULT_NOTIFY_COOLDOWN_MS, 30_000);
}

function testPlanBackoffDelayMs() {
  assert.strictEqual(planBackoffDelayMs({ attempt: 0 }), DEFAULT_BACKOFF_BASE_MS);
  assert.strictEqual(planBackoffDelayMs({ attempt: 1 }), 2_000);
  assert.strictEqual(planBackoffDelayMs({ attempt: 2 }), 4_000);
  assert.strictEqual(
    planBackoffDelayMs({ attempt: 20 }),
    DEFAULT_BACKOFF_MAX_MS,
  );
  assert.strictEqual(
    planBackoffDelayMs({ attempt: 0, baseMs: 50, maxMs: 200, factor: 2 }),
    50,
  );
  assert.strictEqual(
    planBackoffDelayMs({ attempt: 3, baseMs: 50, maxMs: 200, factor: 2 }),
    200,
  );
}

function testMainWiresPalotCooldown() {
  const main = fs.readFileSync(
    path.join(__dirname, "../electron/main.cjs"),
    "utf8",
  );
  assert.ok(main.includes("planDesktopNotification"));
  assert.ok(main.includes("notifyLastShown"));
  assert.ok(main.includes("DEFAULT_NOTIFY_COOLDOWN_MS"));
  assert.ok(
    main.includes('scope: "capture"') || main.includes("scope: 'capture'"),
    "long-task should use capture scope for cooldown key",
  );
  assert.ok(
    /sessionId:\s*meta\.id/.test(main),
    "session-exit should pass session id into notify plan",
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
    testCooldownSuppressesSecondFire,
    testCooldownIsPerScope,
    testPlanStillRespectsFocused,
    testEvaluateNotifyCooldownPure,
    testPlanBackoffDelayMs,
    testMainWiresPalotCooldown,
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
