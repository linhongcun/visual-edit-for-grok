/**
 * Unit tests for shipped runtime policy (single-flight, cleanup throttle,
 * settings debounce, focus handoff, operator busy UX).
 */
const assert = require("assert");
const {
  canStartCapture,
  mayStartCaptureAction,
  classifyGrokUiState,
  validateAimEvent,
  normalizeViewport,
  stampSelectionContext,
  samePreviewIdentity,
  evaluateSelectionFreshness,
  evaluateSelectionStability,
  planFrameCapture,
  shouldRunCleanup,
  shouldFlushSettings,
  focusHandoffDelays,
  operatorActionState,
  planAimPickEvent,
  resolvePickCommit,
  DEFAULT_CLEANUP_MIN_INTERVAL_MS,
  DEFAULT_SETTINGS_DEBOUNCE_MS,
} = require("../electron/runtime-policy.cjs");

const currentPreview = {
  pageUrl: "http://127.0.0.1:8765/products?mode=grid",
  navigationToken: "nav-token-7",
  navigationId: 7,
  sourceId: 42,
  viewport: {
    width: 1280,
    height: 720,
    devicePixelRatio: 2,
  },
  scroll: { x: 0, y: 240 },
};

function validAimInput(overrides = {}) {
  return {
    pickMode: true,
    inFlight: false,
    event: {
      captureContext: {
        navigationToken: currentPreview.navigationToken,
        navigationId: currentPreview.navigationId,
        sourceId: currentPreview.sourceId,
      },
    },
    current: currentPreview,
    ...overrides,
  };
}

function contextualSelection() {
  return stampSelectionContext(
    {
      tag: "button",
      selector: "button#cta",
      pageUrl: currentPreview.pageUrl,
      boundingBox: { top: 30, left: 40, width: 120, height: 48 },
    },
    currentPreview,
  );
}

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

function testAimEventRequiresActivePickMode() {
  const result = validateAimEvent(validAimInput({ pickMode: false }));
  assert.strictEqual(result.proceed, false);
  assert.strictEqual(result.reason, "aim-inactive");
  assert.strictEqual(result.cancelPickMode, false);
}

function testAimEventRequiresIdleCapture() {
  const result = validateAimEvent(validAimInput({ inFlight: true }));
  assert.strictEqual(result.proceed, false);
  assert.strictEqual(result.reason, "busy");
}

function testAimEventAcceptsCurrentTrustedDocument() {
  const result = validateAimEvent(validAimInput());
  assert.strictEqual(result.ok, true);
  assert.strictEqual(result.proceed, true);
  assert.strictEqual(result.reason, null);
}

function testAimEventRejectsStaleNavigationToken() {
  const input = validAimInput();
  input.event.captureContext.navigationToken = "nav-token-6";
  const result = validateAimEvent(input);
  assert.strictEqual(result.proceed, false);
  assert.strictEqual(result.reason, "stale-navigation-token");
}

function testAimEventRejectsStaleNavigationId() {
  const input = validAimInput();
  input.event.captureContext.navigationId = 6;
  const result = validateAimEvent(input);
  assert.strictEqual(result.proceed, false);
  assert.strictEqual(result.reason, "stale-navigation-id");
}

function testAimEventRejectsWrongSource() {
  const input = validAimInput();
  input.event.captureContext.sourceId = 99;
  const result = validateAimEvent(input);
  assert.strictEqual(result.proceed, false);
  assert.strictEqual(result.reason, "source-mismatch");
}

function testAimEventRejectsMissingIdentityEvidence() {
  const result = validateAimEvent({
    pickMode: true,
    event: {},
    current: currentPreview,
  });
  assert.strictEqual(result.proceed, false);
  assert.strictEqual(result.reason, "missing-navigation-token");
}

function testFreshSelectionUsesTargetBounds() {
  const selection = contextualSelection();
  const result = planFrameCapture({ selection, current: currentPreview });
  assert.strictEqual(result.selectionFresh, true);
  assert.strictEqual(result.captureMode, "target");
  assert.strictEqual(result.useTargetBounds, true);
  assert.strictEqual(result.selectionForPayload, selection);
  assert.strictEqual(result.bounds, selection.boundingBox);
}

function testUrlChangeFallsBackAndDropsOldDom() {
  const selection = contextualSelection();
  const result = planFrameCapture({
    selection,
    current: { ...currentPreview, pageUrl: "http://127.0.0.1:8765/cart" },
  });
  assert.strictEqual(result.selectionFresh, false);
  assert.strictEqual(result.reason, "url-changed");
  assert.strictEqual(result.captureMode, "viewport");
  assert.strictEqual(result.bounds, null);
  assert.strictEqual(result.selectionForPayload, null);
  assert.strictEqual(result.preservePreviousSelection, false);
}

function testOffscreenTargetFallsBackAndDropsDom() {
  const selection = {
    ...contextualSelection(),
    boundingBox: { top: 800, left: 40, width: 120, height: 48 },
  };
  const result = planFrameCapture({ selection, current: currentPreview });
  assert.strictEqual(result.selectionFresh, true);
  assert.strictEqual(result.captureMode, "viewport");
  assert.strictEqual(result.reason, "target-outside-viewport");
  assert.strictEqual(result.bounds, null);
  assert.strictEqual(result.selectionForPayload, null);
  assert.strictEqual(result.preservePreviousSelection, false);
}

function testInvalidTargetBoundsFallsBackAndDropsDom() {
  const selection = {
    ...contextualSelection(),
    boundingBox: { top: 30, left: 40, width: 0, height: 48 },
  };
  const result = planFrameCapture({ selection, current: currentPreview });
  assert.strictEqual(result.captureMode, "viewport");
  assert.strictEqual(result.reason, "invalid-target-bounds");
  assert.strictEqual(result.selectionForPayload, null);
}

function testNavigationChangeFallsBackAndDropsOldDom() {
  const result = planFrameCapture({
    selection: contextualSelection(),
    current: {
      ...currentPreview,
      navigationToken: "nav-token-8",
      navigationId: 8,
    },
  });
  assert.strictEqual(result.selectionFresh, false);
  assert.strictEqual(result.reason, "navigation-changed");
  assert.strictEqual(result.selectionForPayload, null);
}

function testViewportOrScrollChangeDropsOldDom() {
  const result = planFrameCapture({
    selection: contextualSelection(),
    current: {
      ...currentPreview,
      viewport: { ...currentPreview.viewport, scrollY: 400 },
    },
  });
  assert.strictEqual(result.selectionFresh, false);
  assert.strictEqual(result.reason, "viewport-changed");
  assert.strictEqual(result.selectionForPayload, null);
}

function testTinyViewportRoundingDifferenceIsFresh() {
  const result = evaluateSelectionFreshness({
    selection: contextualSelection(),
    current: {
      ...currentPreview,
      viewport: { ...currentPreview.viewport, width: 1280.5, scrollY: 240.5 },
    },
  });
  assert.strictEqual(result.fresh, true);
}

function testNormalizerAcceptsSplitViewportAndScrollSnapshot() {
  assert.deepStrictEqual(normalizeViewport(currentPreview), {
    width: 1280,
    height: 720,
    scrollX: 0,
    scrollY: 240,
    devicePixelRatio: 2,
  });
}

function testPreviewIdentityMustRemainCommittedAndIdle() {
  const before = {
    webContentsId: 42,
    navigationId: 7,
    navigationToken: "nav-token-7",
    url: currentPreview.pageUrl,
  };
  assert.strictEqual(
    samePreviewIdentity(before, {
      ...before,
      loading: false,
    }),
    true,
  );
  assert.strictEqual(samePreviewIdentity(before, { ...before, loading: true }), false);
  assert.strictEqual(
    samePreviewIdentity(before, { ...before, navigationId: 8, loading: false }),
    false,
  );
}

function testSelectionStabilityAcceptsUnchangedTarget() {
  const before = contextualSelection();
  const after = {
    ...before,
    boundingBox: { ...before.boundingBox, left: 40.5, x: 40.5 },
  };
  assert.deepStrictEqual(evaluateSelectionStability({ before, after }), {
    stable: true,
    reason: null,
  });
}

function testSelectionStabilityRejectsMovingTarget() {
  const before = contextualSelection();
  const after = {
    ...before,
    boundingBox: { ...before.boundingBox, left: 52, x: 52 },
  };
  assert.deepStrictEqual(evaluateSelectionStability({ before, after }), {
    stable: false,
    reason: "target-moved",
  });
}

function testSelectionStabilityRejectsChangedPayloadContent() {
  const before = {
    ...contextualSelection(),
    text: "Save",
    attributes: { "aria-pressed": "false" },
    computedStyle: { color: "rgb(0, 0, 0)" },
  };
  const after = {
    ...before,
    text: "Saved",
    attributes: { "aria-pressed": "true" },
    computedStyle: { color: "rgb(0, 128, 0)" },
  };
  assert.deepStrictEqual(evaluateSelectionStability({ before, after }), {
    stable: false,
    reason: "target-content-changed",
  });
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

function testStrictFrameCommitClearsStaleSelectionForNewShot() {
  const prev = contextualSelection();
  const framePlan = planFrameCapture({
    selection: prev,
    current: { ...currentPreview, pageUrl: "http://127.0.0.1:8765/new" },
  });
  const r = resolvePickCommit({
    ok: true,
    selection: framePlan.selectionForPayload,
    screenshotPath: "/tmp/new-page-frame.png",
    prevSelection: prev,
    prevScreenshotPath: "/tmp/old-page-frame.png",
    preservePreviousSelection: framePlan.preservePreviousSelection,
  });
  assert.strictEqual(r.committed, true);
  assert.strictEqual(r.lastSelection, null);
  assert.strictEqual(r.lastScreenshotPath, "/tmp/new-page-frame.png");
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

function testMayStartCaptureActionBusy() {
  assert.deepStrictEqual(mayStartCaptureAction({ busy: true }), {
    ok: false,
    reason: "busy",
  });
  assert.deepStrictEqual(mayStartCaptureAction({ inFlight: true }), {
    ok: false,
    reason: "busy",
  });
  assert.deepStrictEqual(mayStartCaptureAction({ busy: false }), {
    ok: true,
    reason: null,
  });
}

function testMayStartCaptureActionResendNeedsCapture() {
  assert.deepStrictEqual(
    mayStartCaptureAction({ action: "resend", hasCapture: false }),
    { ok: false, reason: "no-capture" },
  );
  assert.deepStrictEqual(
    mayStartCaptureAction({ action: "resend", hasCapture: true }),
    { ok: true, reason: null },
  );
}

function testClassifyGrokUiStateNeverPromotesRequestedToReady() {
  assert.strictEqual(
    classifyGrokUiState({
      shellAlive: true,
      grokLaunchRequested: true,
      grokState: "running",
    }),
    "launch-requested",
  );
  assert.strictEqual(
    classifyGrokUiState({
      shellAlive: true,
      grokReady: true,
      grokState: "running",
    }),
    "ready",
  );
  assert.strictEqual(
    classifyGrokUiState({ shellAlive: false, current: "launch-requested" }),
    "exited",
  );
  assert.strictEqual(
    classifyGrokUiState({ shellAlive: false, current: "idle" }),
    "idle",
  );
}

function run() {
  const tests = [
    testCanStartWhenIdle,
    testRejectWhenBusy,
    testMayStartCaptureActionBusy,
    testMayStartCaptureActionResendNeedsCapture,
    testClassifyGrokUiStateNeverPromotesRequestedToReady,
    testAimEventRequiresActivePickMode,
    testAimEventRequiresIdleCapture,
    testAimEventAcceptsCurrentTrustedDocument,
    testAimEventRejectsStaleNavigationToken,
    testAimEventRejectsStaleNavigationId,
    testAimEventRejectsWrongSource,
    testAimEventRejectsMissingIdentityEvidence,
    testFreshSelectionUsesTargetBounds,
    testUrlChangeFallsBackAndDropsOldDom,
    testOffscreenTargetFallsBackAndDropsDom,
    testInvalidTargetBoundsFallsBackAndDropsDom,
    testNavigationChangeFallsBackAndDropsOldDom,
    testViewportOrScrollChangeDropsOldDom,
    testTinyViewportRoundingDifferenceIsFresh,
    testNormalizerAcceptsSplitViewportAndScrollSnapshot,
    testPreviewIdentityMustRemainCommittedAndIdle,
    testSelectionStabilityAcceptsUnchangedTarget,
    testSelectionStabilityRejectsMovingTarget,
    testSelectionStabilityRejectsChangedPayloadContent,
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
    testStrictFrameCommitClearsStaleSelectionForNewShot,
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
