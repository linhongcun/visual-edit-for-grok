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

function testMainWiresMaximizeAndRecovery() {
  const main = fs.readFileSync(
    path.join(__dirname, "../electron/main.cjs"),
    "utf8",
  );
  assert.ok(main.includes("resolveWorkspaceMaximize"));
  assert.ok(main.includes("planPreviewRecovery"));
  assert.ok(main.includes("layout:maximize") || main.includes("applyWorkspaceMaximize"));
  assert.ok(main.includes("softRecoverPreview") || main.includes("recreatePreview"));
}

function run() {
  const tests = [
    testMaximizeTerminalThenRestore,
    testMaximizePreviewThenRestore,
    testToggleTwiceReturnsOriginal,
    testSwitchMaximizeKeepsOriginalRestore,
    testNoopNoneWhenNormal,
    testClampSplitRatio,
    testPreviewRecoveryRecreate,
    testPreviewRecoveryBudget,
    testPreviewRecoveryNoWindow,
    testPreviewRecoveryOk,
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
