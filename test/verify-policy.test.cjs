const assert = require("assert");
const {
  comparablePage,
  canVerifyCapture,
  compareSelections,
  buildVerificationPayload,
} = require("../electron/verify-policy.cjs");

function selection(overrides = {}) {
  return {
    tag: "button",
    id: "save",
    className: "primary",
    selector: "button#save",
    text: "Save",
    pageUrl: "http://127.0.0.1:5173/settings?tab=profile",
    boundingBox: { left: 20, top: 30, width: 100, height: 40 },
    attributes: { type: "button", "aria-pressed": "false" },
    computedStyle: { color: "rgb(0, 0, 0)", width: "100px" },
    ...overrides,
  };
}

function testComparablePageKeepsOrdinaryStateAndRemovesSecrets() {
  assert.strictEqual(
    comparablePage("https://example.com/a?token=x#one"),
    "https://example.com/a#one",
  );
}

function testVerifyRequiresSamePageAndBeforeImage() {
  const capture = { selection: selection(), screenshotPath: "/tmp/before.png" };
  assert.deepStrictEqual(canVerifyCapture(capture, capture.selection.pageUrl), { ok: true, reason: null });
  assert.strictEqual(canVerifyCapture(capture, "http://127.0.0.1:5173/settings?tab=other").reason, "page-changed");
  assert.strictEqual(canVerifyCapture(capture, "http://127.0.0.1:5173/other").reason, "page-changed");
  assert.strictEqual(canVerifyCapture({ selection: selection() }, capture.selection.pageUrl).reason, "missing-before-image");
}

function testVerifyRequiresMatchingViewport() {
  const capture = {
    selection: selection({
      captureContext: { viewport: { width: 390, height: 844 } },
    }),
    screenshotPath: "/tmp/before.png",
    captureMeta: {
      viewportPreset: "phone390",
      viewportOrientation: "portrait",
    },
  };
  assert.strictEqual(
    canVerifyCapture(capture, {
      url: capture.selection.pageUrl,
      viewport: { width: 844, height: 390 },
      viewportPreset: "phone390",
      viewportOrientation: "landscape",
    }).reason,
    "viewport-changed",
  );
  assert.deepStrictEqual(
    canVerifyCapture(capture, {
      url: capture.selection.pageUrl,
      viewport: { width: 390, height: 844 },
      viewportPreset: "phone390",
      viewportOrientation: "portrait",
    }),
    { ok: true, reason: null },
  );
}

function testCompareSelectionsReportsTrackedChanges() {
  const before = selection();
  const after = selection({
    text: "Saved",
    boundingBox: { left: 24, top: 30, width: 120, height: 40 },
    attributes: { type: "button", "aria-pressed": "true" },
    computedStyle: { color: "rgb(0, 128, 0)", width: "120px" },
  });
  const result = compareSelections(before, after);
  assert.strictEqual(result.changed, true);
  assert.strictEqual(result.geometryChanged, true);
  assert.strictEqual(result.textChanged, true);
  assert.ok(result.attributeChanges.includes("aria-pressed"));
  assert.ok(result.styleChanges.some((row) => row.property === "color"));
}

function testCompareSelectionsCanReportNoTrackedChange() {
  const result = compareSelections(selection(), selection());
  assert.strictEqual(result.changed, false);
  assert.match(result.summary[0], /No tracked/);
}

function testMissingTargetAndPayload() {
  const result = compareSelections(selection(), null);
  assert.strictEqual(result.targetFound, false);
  const payload = buildVerificationPayload({
    ...result,
    beforePath: "/tmp/before.png",
    afterPath: "/tmp/after.png",
    pageUrl: "http://localhost:5173/",
  });
  assert.match(payload, /target-missing/);
  assert.match(payload, /before: \/tmp\/before\.png/);
  assert.doesNotMatch(payload, /\x1b/);
}

const tests = [
  testComparablePageKeepsOrdinaryStateAndRemovesSecrets,
  testVerifyRequiresSamePageAndBeforeImage,
  testVerifyRequiresMatchingViewport,
  testCompareSelectionsReportsTrackedChanges,
  testCompareSelectionsCanReportNoTrackedChange,
  testMissingTargetAndPayload,
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
