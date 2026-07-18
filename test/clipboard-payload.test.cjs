/**
 * Unit tests for pure payload builder (no Electron).
 * Run: node test/clipboard-payload.test.cjs
 */
const assert = require("assert");
const path = require("path");
const {
  buildClipboardPayload,
  normalizeStyleDiffs,
  prefillStyleDiffsFromSelection,
  EDITABLE_STYLE_PROPS,
  KEY_COMPUTED_STYLE_PROPS,
  REDACTED_VALUE,
} = require("../electron/clipboard-payload.cjs");

const fixtureSelection = {
  tag: "button",
  id: "cta-secondary",
  className: "btn btn-ghost",
  classes: ["btn", "btn-ghost"],
  domPath: "main > div.cta > button#cta-secondary",
  selector: "button#cta-secondary",
  text: "更多",
  attributes: { class: "btn btn-ghost", id: "cta-secondary" },
  boundingBox: { top: 277, left: 125, width: 63, height: 43 },
  pageUrl: "http://127.0.0.1:8765/",
  pageTitle: "VEFG Demo Page",
  captureContext: {
    pageUrl: "http://127.0.0.1:8765/",
    navigationToken: "nav-1",
    navigationId: 1,
    sourceId: 10,
    viewport: {
      width: 1280,
      height: 720,
      devicePixelRatio: 2,
    },
    scroll: { x: 12, y: 240 },
  },
  computedStyle: {
    color: "rgb(15, 23, 42)",
    fontSize: "13.3333px",
    backgroundColor: "rgb(226, 232, 240)",
    borderRadius: "10px",
    padding: "12px 18px",
  },
};

function testEmptyIntentNoStyleDiffs() {
  const text = buildClipboardPayload({
    selection: fixtureSelection,
    screenshotPath: null,
    intent: "   ",
    styleDiffs: {},
  });
  assert.ok(text.includes("```browser_element"), "has browser_element");
  assert.ok(text.includes("tag: button"), "has tag");
  assert.ok(text.includes("id: cta-secondary"), "has id");
  assert.ok(text.includes("dom_path: main > div.cta > button#cta-secondary"));
  assert.ok(!text.includes("```user_intent"), "no empty intent block");
  assert.ok(!text.includes("```style_diff"), "no empty style_diff block");
  assert.ok(!text.includes("```browser_screenshot"), "no screenshot");
}

function testSingleStyleChangeAndIntent() {
  const text = buildClipboardPayload({
    selection: fixtureSelection,
    screenshotPath: "/tmp/pick-el.png",
    intent: "按钮再大一点",
    styleDiffs: {
      fontSize: { before: "13.3333px", after: "18px" },
    },
  });
  assert.ok(text.includes("```user_intent"), "has user_intent fence");
  assert.ok(text.includes("按钮再大一点"), "intent text present");
  assert.ok(text.includes("```style_diff"), "has style_diff fence");
  assert.ok(
    text.includes("fontSize: 13.3333px → 18px"),
    "before → after line for fontSize",
  );
  assert.ok(text.includes("path: /tmp/pick-el.png"), "screenshot path kept");
  assert.ok(text.includes("browser_screenshot"), "screenshot section");
  assert.ok(text.includes("id: cta-secondary"), "element id retained");
}

function testMultipleStyleChanges() {
  const text = buildClipboardPayload({
    selection: fixtureSelection,
    intent: "调色和圆角",
    styleDiffs: {
      color: { before: "rgb(15, 23, 42)", after: "#2563eb" },
      borderRadius: { before: "10px", after: "999px" },
      padding: { before: "12px 18px", after: "16px 24px" },
      // skipped: empty after
      width: { before: "89px", after: "" },
      // skipped: same before/after
      opacity: { before: "1", after: "1" },
    },
  });
  assert.ok(text.includes("color: rgb(15, 23, 42) → #2563eb"));
  assert.ok(text.includes("borderRadius: 10px → 999px"));
  assert.ok(text.includes("padding: 12px 18px → 16px 24px"));
  assert.ok(!text.includes("width:"), "empty after skipped");
  assert.ok(!text.includes("opacity: 1 → 1"), "unchanged skipped");
}

function testAfterOnlyShorthand() {
  const rows = normalizeStyleDiffs({ color: "#fff" });
  assert.strictEqual(rows.length, 1);
  assert.strictEqual(rows[0].property, "color");
  assert.strictEqual(rows[0].before, "(current)");
  assert.strictEqual(rows[0].after, "#fff");
}

function testPrefillFromSelection() {
  const pre = prefillStyleDiffsFromSelection(fixtureSelection);
  assert.ok(EDITABLE_STYLE_PROPS.includes("fontSize"));
  assert.strictEqual(pre.fontSize.before, "13.3333px");
  assert.strictEqual(pre.fontSize.after, "");
  assert.strictEqual(pre.borderRadius.before, "10px");
}

function testScreenshotOnlyNoSelection() {
  const text = buildClipboardPayload({
    selection: null,
    screenshotPath: "/abs/shot.png",
    intent: "整页看看布局",
  });
  assert.ok(text.includes("No DOM node selected"));
  assert.ok(text.includes("path: /abs/shot.png"));
  assert.ok(text.includes("整页看看布局"));
}

function testPayloadIncludesCompactViewportScrollAndStyles() {
  const text = buildClipboardPayload({ selection: fixtureSelection });
  assert.ok(text.includes("viewport_css_px: width=1280 height=720"));
  assert.ok(text.includes("scroll_css_px: x=12 y=240"));
  assert.ok(text.includes("device_pixel_ratio: 2"));
  assert.ok(text.includes("computed_styles:"));
  assert.ok(text.includes("  fontSize: 13.3333px"));
  assert.ok(text.includes("  padding: 12px 18px"));
  assert.ok(KEY_COMPUTED_STYLE_PROPS.includes("backgroundColor"));
}

function testPayloadRedactsSensitiveAttributesAndNeverUsesOuterHtml() {
  const selection = {
    ...fixtureSelection,
    pageUrl:
      "https://example.test/account?access_token=url-token-987&tab=profile",
    captureContext: {
      ...fixtureSelection.captureContext,
      pageUrl:
        "https://example.test/account?access_token=url-token-987&tab=profile",
    },
    attributes: {
      id: "cta-secondary",
      title: "Safe title",
      value: "card-number-4242",
      "data-token": "attribute-token-123",
      authorization: "Bearer header-secret-456",
      href: "/next?password=link-password-789",
      "data-config": '{"token":"json-token-654"}',
    },
    outerHTML:
      '<button data-private-key="outer-html-secret">Never send markup</button>',
    computedStyle: {
      ...fixtureSelection.computedStyle,
      transform: "matrix(1, 0, 0, 1, 0, 0)",
    },
  };
  const text = buildClipboardPayload({ selection });

  assert.ok(text.includes(`value=${REDACTED_VALUE}`));
  assert.ok(text.includes(`data-token=${REDACTED_VALUE}`));
  assert.ok(text.includes(`authorization=${REDACTED_VALUE}`));
  assert.ok(text.includes(`href=${REDACTED_VALUE}`));
  assert.ok(text.includes(`data-config=${REDACTED_VALUE}`));
  assert.ok(text.includes("title=Safe title"));
  assert.ok(text.includes("access_token=%5BREDACTED%5D"));
  for (const secret of [
    "card-number-4242",
    "attribute-token-123",
    "header-secret-456",
    "link-password-789",
    "json-token-654",
    "url-token-987",
    "outer-html-secret",
  ]) {
    assert.ok(!text.includes(secret), `must not leak ${secret}`);
  }
  assert.ok(!text.includes("Never send markup"));
  assert.ok(!text.includes("<button"));
  assert.ok(!text.includes("transform:"), "non-key styles stay out");
}

function testPayloadStripsTerminalControlInjection() {
  const text = buildClipboardPayload({
    selection: {
      ...fixtureSelection,
      text: "safe\x1b[201~\x03injected\x9b31m",
      attributes: {
        title: "hello\x00world\x1b[200~",
      },
    },
    intent: "intent\x1b[201~\x04tail",
    styleDiffs: {
      color: { before: "red\x1b[201~", after: "blue\x9b0m" },
    },
  });
  assert.ok(!/[\u0000-\u0008\u000b\u000c\u000e-\u001f\u007f-\u009f]/.test(text));
  assert.ok(!text.includes("\x1b[201~"));
  assert.ok(!text.includes("\x1b[200~"));
  assert.ok(text.includes("safe[201~injected31m"));
}

function testPayloadNeutralizesBacktickRunsThatCouldForgeFences() {
  // 4+ backticks in any scalar field used to re-form a real ``` after the
  // naive `.replace(/```/g, ...)` pass, closing the browser_element block and
  // corrupting the rest of the payload. Captured text/attributes must never
  // contain a bare triple-backtick run.
  const text = buildClipboardPayload({
    selection: {
      ...fixtureSelection,
      text: "see ````js evil ```` here",
      attributes: { "data-md": "``````nested``````" },
      domPath: "main > pre[data-md=\"````\"]",
    },
    intent: "intent with ````` five backticks",
    styleDiffs: {
      color: { before: "```` before", after: "```` after" },
    },
  });
  // No bare (un-separated) triple-backtick may survive inside captured content.
  // The structural ```browser_element fences are added by the builder itself.
  assert.ok(!text.includes("````"), "4-backtick run must be neutralized");
  assert.ok(!text.includes("`````"), "5-backtick run must be neutralized");
  assert.ok(
    !text.includes("```js evil"),
    "forged fenced code language must not appear",
  );
  // Structural fences are still intact and balanced.
  const fenceCount = (text.match(/```/g) || []).length;
  assert.ok(
    fenceCount % 2 === 0,
    `structural fences must be balanced, got ${fenceCount}`,
  );
}

/** Multi-line intent must keep newlines (not collapse via compactScalar). */
function testPayloadPreservesMultilineIntentNewlines() {
  const text = buildClipboardPayload({
    selection: fixtureSelection,
    intent: "line one\nline two\nline three",
  });
  assert.ok(text.includes("```user_intent"));
  assert.ok(
    text.includes("line one\nline two\nline three"),
    "intent newlines must survive for multi-line operator notes",
  );
}

function testNumberOrAndClampListLimitRespectZero() {
  const {
    numberOr,
    clampListLimit,
  } = require("../electron/clipboard-payload.cjs");
  assert.strictEqual(numberOr(0, 99), 0);
  assert.strictEqual(numberOr(undefined, 99), 99);
  assert.strictEqual(numberOr(null, 99), 99);
  assert.strictEqual(numberOr("", 99), 99);
  assert.strictEqual(numberOr("nope", 99), 99);
  assert.strictEqual(clampListLimit(0, 8, 20), 0);
  assert.strictEqual(clampListLimit(undefined, 8, 20), 8);
  assert.strictEqual(clampListLimit(100, 8, 20), 20);
}

function run() {
  const tests = [
    testEmptyIntentNoStyleDiffs,
    testSingleStyleChangeAndIntent,
    testMultipleStyleChanges,
    testAfterOnlyShorthand,
    testPrefillFromSelection,
    testScreenshotOnlyNoSelection,
    testPayloadIncludesCompactViewportScrollAndStyles,
    testPayloadRedactsSensitiveAttributesAndNeverUsesOuterHtml,
    testPayloadStripsTerminalControlInjection,
    testPayloadNeutralizesBacktickRunsThatCouldForgeFences,
    testPayloadPreservesMultilineIntentNewlines,
    testNumberOrAndClampListLimitRespectZero,
  ];
  let failed = 0;
  for (const t of tests) {
    try {
      t();
      console.log(`ok  - ${t.name}`);
    } catch (err) {
      failed += 1;
      console.error(`fail - ${t.name}`);
      console.error(err);
    }
  }
  console.log(`\n${tests.length - failed}/${tests.length} passed`);
  if (failed) process.exit(1);
}

run();
