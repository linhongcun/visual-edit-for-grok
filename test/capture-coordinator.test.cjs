/** Unit tests for frozen capture routing and per-terminal capture state. */
const assert = require("assert");
const {
  createCoordinatorState,
  restoreCoordinatorState,
  serializeCoordinatorState,
  getSessionState,
  switchActiveSession,
  updateSessionWorkspace,
  freezeCaptureTarget,
  resolveCaptureRoute,
  commitCapture,
  commitVerifyPair,
  clearSessionCapture,
} = require("../electron/capture-coordinator.cjs");

function baseState() {
  return createCoordinatorState({
    activeSessionId: "term-a",
    sessions: [
      { id: "term-a", cwd: "/projects/a", label: "A" },
      { id: "term-b", cwd: "/projects/b", label: "B" },
    ],
  });
}

function capture(path, selector) {
  return {
    lastSelection: { selector, tag: "button" },
    lastScreenshotPath: path,
    lastCaptureMeta: { kind: "selection", target: selector },
  };
}

function testCaptureKeepsFrozenRouteAfterTabSwitch() {
  const initial = updateSessionWorkspace(baseState(), "term-a", {
    previewUrl: "http://localhost:3000/a",
    viewportPreset: "mobile-390",
  });
  const target = freezeCaptureTarget(initial, {
    captureId: "capture-a-1",
    startedAt: 100,
  });
  assert.deepStrictEqual(
    {
      id: target.targetSessionId,
      cwd: target.cwd,
      label: target.label,
    },
    { id: "term-a", cwd: "/projects/a", label: "A" },
  );
  assert.strictEqual(Object.isFrozen(target), true);

  const switched = switchActiveSession(initial, "term-b");
  const route = resolveCaptureRoute(switched, target);
  assert.strictEqual(route.ok, true);
  assert.strictEqual(route.targetSessionId, "term-a");
  assert.strictEqual(switched.activeSessionId, "term-b");

  const committed = commitCapture(
    switched,
    target,
    capture("/captures/a.png", "#save-a"),
  );
  assert.strictEqual(committed.activeSessionId, "term-b");
  assert.strictEqual(
    getSessionState(committed, "term-a").lastScreenshotPath,
    "/captures/a.png",
  );
  assert.strictEqual(
    getSessionState(committed, "term-a").lastCaptureMeta.targetSessionId,
    "term-a",
  );
  assert.strictEqual(
    getSessionState(committed, "term-b").lastScreenshotPath,
    null,
  );
}

function testEachTabOwnsIndependentReceipt() {
  const initial = baseState();
  const targetA = freezeCaptureTarget(initial);
  const withA = commitCapture(
    initial,
    targetA,
    capture("/captures/a.png", "#a"),
  );
  const onB = switchActiveSession(withA, "term-b");
  const targetB = freezeCaptureTarget(onB);
  const withBoth = commitCapture(
    onB,
    targetB,
    capture("/captures/b.png", "#b"),
  );

  assert.strictEqual(
    getSessionState(withBoth, "term-a").lastSelection.selector,
    "#a",
  );
  assert.strictEqual(
    getSessionState(withBoth, "term-b").lastSelection.selector,
    "#b",
  );
  assert.strictEqual(
    getSessionState(withBoth).lastScreenshotPath,
    "/captures/b.png",
    "default receipt follows active tab",
  );
}

function testVerifyPairAndClearStaySessionScoped() {
  const initial = baseState();
  const targetA = freezeCaptureTarget(initial);
  const withCapture = commitCapture(
    initial,
    targetA,
    capture("/captures/before.png", "#hero"),
  );
  const switched = switchActiveSession(withCapture, "term-b");
  const verified = commitVerifyPair(switched, targetA, {
    before: capture("/captures/before.png", "#hero"),
    after: capture("/captures/after.png", "#hero"),
    verifiedAt: 200,
    comparison: {
      changed: true,
      targetFound: true,
      summary: ["Visible text changed."],
    },
  });

  const a = getSessionState(verified, "term-a");
  assert.strictEqual(a.verifyPair.before.screenshotPath, "/captures/before.png");
  assert.strictEqual(a.verifyPair.after.screenshotPath, "/captures/after.png");
  assert.strictEqual(a.verifyPair.targetSessionId, "term-a");
  assert.strictEqual(a.verifyPair.comparison.changed, true);
  assert.deepStrictEqual(a.verifyPair.comparison.summary, [
    "Visible text changed.",
  ]);
  assert.strictEqual(getSessionState(verified, "term-b").verifyPair, null);

  const cleared = clearSessionCapture(verified, "term-a");
  assert.strictEqual(getSessionState(cleared, "term-a").lastSelection, null);
  assert.strictEqual(getSessionState(cleared, "term-a").verifyPair, null);
  assert.strictEqual(cleared.activeSessionId, "term-b");
}

function testSerializeRestorePreservesWorkspaceState() {
  let state = updateSessionWorkspace(baseState(), "term-a", {
    previewUrl: "https://example.com/app",
    viewportPreset: "tablet-768",
  });
  const targetA = freezeCaptureTarget(state);
  state = commitCapture(
    state,
    targetA,
    capture("/captures/a.png", "main > button"),
  );
  state = commitVerifyPair(state, targetA, {
    before: capture("/captures/a.png", "main > button"),
    after: capture("/captures/a-after.png", "main > button"),
    verifiedAt: 321,
    comparison: {
      changed: true,
      targetFound: true,
      summary: ["Geometry changed."],
    },
  });
  state = switchActiveSession(state, "term-b");

  const serialized = serializeCoordinatorState(state);
  const restored = restoreCoordinatorState(JSON.parse(JSON.stringify(serialized)));
  const a = getSessionState(restored, "term-a");
  assert.strictEqual(restored.activeSessionId, "term-b");
  assert.strictEqual(a.previewUrl, "https://example.com/app");
  assert.strictEqual(a.viewportPreset, "tablet-768");
  assert.strictEqual(a.lastScreenshotPath, "/captures/a.png");
  assert.strictEqual(a.verifyPair.after.screenshotPath, "/captures/a-after.png");
  assert.deepStrictEqual(a.verifyPair.comparison.summary, ["Geometry changed."]);
}

function testMissingFrozenTargetNeverFallsBackToActive() {
  const state = baseState();
  const missing = Object.freeze({
    targetSessionId: "term-removed",
    cwd: "/removed",
    label: "Removed",
  });
  assert.deepStrictEqual(resolveCaptureRoute(state, missing), {
    ok: false,
    reason: "target-session-missing",
    targetSessionId: "term-removed",
  });
  assert.throws(
    () => commitCapture(state, missing, capture("/wrong.png", "#wrong")),
    /no longer exists/,
  );
  assert.strictEqual(getSessionState(state, "term-a").lastScreenshotPath, null);
}

function testFrozenTargetRejectsWorkspaceMutation() {
  const initial = baseState();
  const target = freezeCaptureTarget(initial);
  const changed = updateSessionWorkspace(initial, "term-a", {
    cwd: "/projects/replaced",
    label: "Replaced",
  });
  const route = resolveCaptureRoute(changed, target);
  assert.strictEqual(route.ok, true);
  assert.strictEqual(route.contextChanged, true);
  assert.throws(
    () => commitCapture(changed, target, capture("/wrong.png", "#wrong")),
    /workspace changed/,
  );
}

function testBinaryScreenshotContentIsNeverSerialized() {
  const target = freezeCaptureTarget(baseState());
  const state = commitCapture(baseState(), target, {
    selection: {
      selector: "#safe",
      pageUrl: "https://user:pass@example.com/app?token=TOP_SECRET_URL&tab=one",
      attributes: {
        "data-token": "TOP_SECRET_ATTRIBUTE",
        role: "button",
      },
      outerHTML: "<button>TOP_SECRET_HTML</button>",
      dataUrl: "data:image/png;base64,TOP_SECRET_IMAGE",
      buffer: Buffer.from("TOP_SECRET_BUFFER"),
    },
    screenshotPath: "/captures/safe-path.png",
    captureMeta: {
      thumbnailData: "data:image/png;base64,TOP_SECRET_THUMB",
    },
  });
  const serialized = JSON.stringify(serializeCoordinatorState(state));
  assert.ok(serialized.includes("/captures/safe-path.png"));
  assert.ok(!serialized.includes("TOP_SECRET"));
  assert.ok(!serialized.includes("data:image"));
  const restored = getSessionState(state, "term-a").lastSelection;
  assert.strictEqual(restored.attributes["data-token"], "[REDACTED]");
  assert.strictEqual(restored.attributes.role, "button");
  assert.strictEqual(restored.pageUrl, "https://example.com/app?tab=one");
  assert.strictEqual(restored.outerHTML, undefined);
}

function run() {
  const tests = [
    testCaptureKeepsFrozenRouteAfterTabSwitch,
    testEachTabOwnsIndependentReceipt,
    testVerifyPairAndClearStaySessionScoped,
    testSerializeRestorePreservesWorkspaceState,
    testMissingFrozenTargetNeverFallsBackToActive,
    testFrozenTargetRejectsWorkspaceMutation,
    testBinaryScreenshotContentIsNeverSerialized,
  ];
  let failed = 0;
  for (const test of tests) {
    try {
      test();
      console.log(`ok  - ${test.name}`);
    } catch (error) {
      failed += 1;
      console.error(`fail - ${test.name}`, error);
    }
  }
  console.log(`\n${tests.length - failed}/${tests.length} passed`);
  if (failed) process.exit(1);
}

run();
