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

function run() {
  const tests = [
    testEmptyIntentNoStyleDiffs,
    testSingleStyleChangeAndIntent,
    testMultipleStyleChanges,
    testAfterOnlyShorthand,
    testPrefillFromSelection,
    testScreenshotOnlyNoSelection,
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
