/**
 * Unit tests for Wave-inspired workspace maximize + preview recovery.
 * Run: node test/workspace-maximize.test.cjs
 */
const assert = require("assert");
const fs = require("fs");
const path = require("path");
const {
  resolveWorkspaceMaximize,
  planPreviewRecovery,
  shouldPersistWorkspaceLayout,
  MAXIMIZE_PREVIEW_SPLIT_RATIO,
  DEFAULT_PREVIEW_RECOVERY_MAX,
  clampSplitRatio,
} = require("../electron/runtime-policy.cjs");

function baseState(overrides = {}) {
  return {
    splitRatio: 0.52,
    previewCollapsed: false,
    maximized: null,
    restoreSplitRatio: null,
    restorePreviewCollapsed: null,
    ...overrides,
  };
}

function testMaximizeTerminalThenRestore() {
  const a = resolveWorkspaceMaximize(baseState(), "terminal");
  assert.strictEqual(a.maximized, "terminal");
  assert.strictEqual(a.previewCollapsed, true);
  assert.strictEqual(a.restoreSplitRatio, 0.52);
  assert.strictEqual(a.restorePreviewCollapsed, false);
  assert.strictEqual(a.changed, true);

  const b = resolveWorkspaceMaximize(a, "toggle-terminal");
  assert.strictEqual(b.maximized, null);
  assert.strictEqual(b.previewCollapsed, false);
  assert.strictEqual(b.splitRatio, 0.52);
  assert.strictEqual(b.restoreSplitRatio, null);
}

function testMaximizePreviewThenRestore() {
  const a = resolveWorkspaceMaximize(baseState({ splitRatio: 0.4 }), "preview");
  assert.strictEqual(a.maximized, "preview");
  assert.strictEqual(a.previewCollapsed, false);
  assert.strictEqual(a.splitRatio, MAXIMIZE_PREVIEW_SPLIT_RATIO);
  assert.strictEqual(a.restoreSplitRatio, 0.4);

  const b = resolveWorkspaceMaximize(a, "preview"); // toggle off
  assert.strictEqual(b.maximized, null);
  assert.strictEqual(b.splitRatio, 0.4);
  assert.strictEqual(b.previewCollapsed, false);
}

function testToggleTwiceReturnsOriginal() {
  const start = baseState({
    splitRatio: 0.61,
    previewCollapsed: true,
  });
  const maxT = resolveWorkspaceMaximize(start, "toggle-terminal");
  const back = resolveWorkspaceMaximize(maxT, "toggle-terminal");
  assert.strictEqual(back.splitRatio, 0.61);
  assert.strictEqual(back.previewCollapsed, true);
  assert.strictEqual(back.maximized, null);

  const maxP = resolveWorkspaceMaximize(start, "toggle-preview");
  const backP = resolveWorkspaceMaximize(maxP, "toggle-preview");
  assert.strictEqual(backP.splitRatio, 0.61);
  assert.strictEqual(backP.previewCollapsed, true);
}

function testSwitchMaximizeKeepsOriginalRestore() {
  const start = baseState({ splitRatio: 0.55, previewCollapsed: false });
  const term = resolveWorkspaceMaximize(start, "terminal");
  const prev = resolveWorkspaceMaximize(term, "preview");
  assert.strictEqual(prev.maximized, "preview");
  assert.strictEqual(prev.restoreSplitRatio, 0.55);
  assert.strictEqual(prev.restorePreviewCollapsed, false);
  const restored = resolveWorkspaceMaximize(prev, "none");
  assert.strictEqual(restored.splitRatio, 0.55);
  assert.strictEqual(restored.previewCollapsed, false);
}

function testNoopNoneWhenNormal() {
  const r = resolveWorkspaceMaximize(baseState(), "none");
  assert.strictEqual(r.changed, false);
  assert.strictEqual(r.maximized, null);
}

function testClampSplitRatio() {
  assert.strictEqual(clampSplitRatio(0.1), 0.22);
  assert.strictEqual(clampSplitRatio(0.9), 0.75);
}

/**
 * Skeptic finding: temporary maximize effects must not hit durable settings.
 * Entering maximize → no persist; restore → persist restored baseline.
 */
function testShouldPersistOnlyWhenNotMaximized() {
  const maxT = resolveWorkspaceMaximize(baseState({ splitRatio: 0.55 }), "terminal");
  assert.strictEqual(maxT.maximized, "terminal");
  assert.strictEqual(maxT.previewCollapsed, true);
  assert.strictEqual(shouldPersistWorkspaceLayout(maxT), false);

  const maxP = resolveWorkspaceMaximize(baseState({ splitRatio: 0.55 }), "preview");
  assert.strictEqual(maxP.splitRatio, MAXIMIZE_PREVIEW_SPLIT_RATIO);
  assert.strictEqual(shouldPersistWorkspaceLayout(maxP), false);

  const restored = resolveWorkspaceMaximize(maxP, "none");
  assert.strictEqual(restored.maximized, null);
  assert.strictEqual(restored.splitRatio, 0.55);
  assert.strictEqual(shouldPersistWorkspaceLayout(restored), true);

  assert.strictEqual(
    shouldPersistWorkspaceLayout(baseState()),
    true,
  );
}

function testPreviewRecoveryRecreate() {
  const r = planPreviewRecovery({
    hasMainWindow: true,
    previewDestroyed: true,
    recoveryCount: 0,
  });
  assert.strictEqual(r.action, "recreate");
  assert.strictEqual(r.nextRecoveryCount, 1);
}

function testPreviewRecoveryBudget() {
  const r = planPreviewRecovery({
    hasMainWindow: true,
    previewDestroyed: true,
    recoveryCount: DEFAULT_PREVIEW_RECOVERY_MAX,
  });
  assert.strictEqual(r.action, "none");
  assert.strictEqual(r.reason, "recovery-budget-exhausted");
}

function testPreviewRecoveryNoWindow() {
  const r = planPreviewRecovery({
    hasMainWindow: false,
    previewMissing: true,
  });
  assert.strictEqual(r.action, "none");
  assert.strictEqual(r.reason, "no-main-window");
}

function testPreviewRecoveryOk() {
  const r = planPreviewRecovery({
    hasMainWindow: true,
    previewDestroyed: false,
    previewMissing: false,
  });
  assert.strictEqual(r.action, "none");
  assert.strictEqual(r.reason, "preview-ok");
}

/**
 * Skeptic finding: after crash, view still held and isDestroyed() false
 * → without force, plan is preview-ok (no-op). force must recreate.
 */
function testPreviewRecoveryForceAfterCrashShape() {
  // Crash-shaped inputs: view present, not destroyed, but unusable
  const zombie = planPreviewRecovery({
    hasMainWindow: true,
    previewMissing: false,
    previewDestroyed: false,
    recoveryCount: 0,
  });
  assert.strictEqual(zombie.action, "none");
  assert.strictEqual(zombie.reason, "preview-ok");

  const forced = planPreviewRecovery({
    hasMainWindow: true,
    previewMissing: false,
    previewDestroyed: false,
    force: true,
    forceReason: "crash",
    recoveryCount: 0,
  });
  assert.strictEqual(forced.action, "recreate");
  assert.strictEqual(forced.reason, "crash");
  assert.strictEqual(forced.nextRecoveryCount, 1);

  const manual = planPreviewRecovery({
    hasMainWindow: true,
    previewMissing: false,
    previewDestroyed: false,
    force: true,
    forceReason: "manual",
    recoveryCount: 1,
  });
  assert.strictEqual(manual.action, "recreate");
  assert.strictEqual(manual.reason, "manual");
  assert.strictEqual(manual.nextRecoveryCount, 2);
}

function testPreviewRecoveryForceStillRespectsBudget() {
  const r = planPreviewRecovery({
    hasMainWindow: true,
    force: true,
    forceReason: "crash",
    recoveryCount: DEFAULT_PREVIEW_RECOVERY_MAX,
  });
  assert.strictEqual(r.action, "none");
  assert.strictEqual(r.reason, "recovery-budget-exhausted");
}

function testMainWiresMaximizeAndRecovery() {
  const main = fs.readFileSync(
    path.join(__dirname, "../electron/main.cjs"),
    "utf8",
  );
  assert.ok(main.includes("resolveWorkspaceMaximize"));
  assert.ok(main.includes("planPreviewRecovery"));
  assert.ok(main.includes("shouldPersistWorkspaceLayout"));
  assert.ok(main.includes("layout:maximize") || main.includes("applyWorkspaceMaximize"));
  assert.ok(main.includes("softRecoverPreview") || main.includes("recreatePreview"));
  // Crash path must force recreate (not bare softRecoverPreview())
  assert.ok(
    /softRecoverPreview\s*\(\s*\{\s*force\s*:\s*true/.test(main),
    "softRecoverPreview must be called with force:true on crash/manual path",
  );
  assert.ok(
    main.includes('forceReason: "crash"') || main.includes("forceReason: 'crash'"),
    "render-process-gone must pass forceReason crash",
  );
  // Must not always force-persist layout while maximized
  assert.ok(
    main.includes("shouldPersistWorkspaceLayout"),
    "applyWorkspaceMaximize must gate disk writes via shouldPersistWorkspaceLayout",
  );
}

function run() {
  const tests = [
    testMaximizeTerminalThenRestore,
    testMaximizePreviewThenRestore,
    testToggleTwiceReturnsOriginal,
    testSwitchMaximizeKeepsOriginalRestore,
    testNoopNoneWhenNormal,
    testClampSplitRatio,
    testShouldPersistOnlyWhenNotMaximized,
    testPreviewRecoveryRecreate,
    testPreviewRecoveryBudget,
    testPreviewRecoveryNoWindow,
    testPreviewRecoveryOk,
    testPreviewRecoveryForceAfterCrashShape,
    testPreviewRecoveryForceStillRespectsBudget,
    testMainWiresMaximizeAndRecovery,
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
