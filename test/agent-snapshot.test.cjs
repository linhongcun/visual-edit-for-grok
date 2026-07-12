/**
 * Unit tests for agent-browser-inspired compact snapshot (shipped helper).
 * Run: node test/agent-snapshot.test.cjs
 */
const assert = require("assert");
const fs = require("fs");
const path = require("path");
const {
  buildAgentSnapshot,
  inferRole,
  accessibleName,
  shouldHideScrollbarsForCapture,
  HIDE_SCROLLBAR_CSS,
  MAX_SNAPSHOT_CHARS,
} = require("../electron/agent-snapshot.cjs");
const {
  buildClipboardPayload,
  REDACTED_VALUE,
} = require("../electron/clipboard-payload.cjs");

const fixture = {
  tag: "button",
  id: "cta-secondary",
  className: "btn btn-ghost",
  domPath: "main > div.cta > button#cta-secondary",
  selector: "button#cta-secondary",
  text: "更多",
  role: "button",
  accessibleName: "更多",
  attributes: {
    class: "btn btn-ghost",
    id: "cta-secondary",
    "data-token": "secret-token-xyz",
  },
  pageUrl: "https://example.test/app?access_token=url-secret-999",
  pageTitle: "Demo",
  captureContext: {
    pageUrl: "https://example.test/app?access_token=url-secret-999",
  },
  neighbors: [
    {
      tag: "a",
      role: "link",
      name: "Home",
      selector: "a.home",
      text: "Home",
    },
    {
      tag: "input",
      role: "textbox",
      name: "Email",
      attributes: { type: "email", placeholder: "Email" },
      text: "",
    },
  ],
  outerHTML: '<button data-private-key="never">x</button>',
};

function testSnapshotHasRefsNotOuterHtml() {
  const snap = buildAgentSnapshot(fixture);
  assert.ok(snap.includes("@e1 [button]"), "target ref");
  assert.ok(snap.includes('"更多"') || snap.includes("更多"), "name");
  assert.ok(snap.includes("@e2 [link]"), "neighbor ref");
  assert.ok(snap.includes("Nearby:"), "neighborhood section");
  assert.ok(!snap.includes("outerHTML"));
  assert.ok(!snap.includes("<button"));
  assert.ok(!snap.includes("never"));
  assert.ok(!snap.includes("data-private-key"));
}

function testSensitiveRedaction() {
  const snap = buildAgentSnapshot(fixture);
  assert.ok(!snap.includes("secret-token-xyz"));
  assert.ok(!snap.includes("url-secret-999"));
  // URL redaction via sanitizePageUrl
  assert.ok(snap.includes("URL:"));
  assert.ok(
    snap.includes(REDACTED_VALUE) || snap.includes("%5BREDACTED%5D"),
    "token redacted in URL or attrs",
  );
}

function testSizeBounded() {
  const huge = {
    ...fixture,
    text: "x".repeat(5000),
    neighbors: Array.from({ length: 40 }, (_, i) => ({
      tag: "button",
      role: "button",
      name: `Btn ${i} ${"y".repeat(200)}`,
      text: `Btn ${i}`,
    })),
  };
  const snap = buildAgentSnapshot(huge, { maxChars: 800, maxNeighbors: 3 });
  assert.ok(snap.length <= 800, `len=${snap.length}`);
  // At most 3 neighbors → refs up to @e4
  assert.ok(!snap.includes("@e10"));
}

function testEmptySelection() {
  assert.strictEqual(buildAgentSnapshot(null), "");
  assert.strictEqual(buildAgentSnapshot({}), "");
}

function testInferRole() {
  assert.strictEqual(inferRole({ tag: "a" }), "link");
  assert.strictEqual(inferRole({ tag: "button" }), "button");
  assert.strictEqual(
    inferRole({ tag: "input", attributes: { type: "password" } }),
    "textbox",
  );
  assert.strictEqual(inferRole({ tag: "div", role: "tab" }), "tab");
}

function testAccessibleNamePrefersAria() {
  assert.strictEqual(
    accessibleName({
      text: "visible",
      attributes: { "aria-label": "Aria Name" },
    }),
    "Aria Name",
  );
}

function testPayloadIncludesAgentSnapshotFence() {
  const text = buildClipboardPayload({ selection: fixture });
  assert.ok(text.includes("```agent_snapshot"), "fence present");
  assert.ok(text.includes("@e1 [button]"), "ref in paste");
  assert.ok(text.includes("```browser_element"), "legacy block kept");
  assert.ok(!text.includes("secret-token-xyz"));
  assert.ok(!text.includes("<button"));
}

function testHideScrollbarsDefaultOn() {
  assert.strictEqual(shouldHideScrollbarsForCapture({}), true);
  assert.strictEqual(shouldHideScrollbarsForCapture(null), true);
  assert.strictEqual(shouldHideScrollbarsForCapture({ hideScrollbars: false }), false);
  assert.ok(HIDE_SCROLLBAR_CSS.includes("scrollbar"));
  assert.ok(HIDE_SCROLLBAR_CSS.includes("::-webkit-scrollbar"));
}

function testMainWiresScrollbarHide() {
  const main = fs.readFileSync(
    path.join(__dirname, "../electron/main.cjs"),
    "utf8",
  );
  const start = main.indexOf("async function takeScreenshotFile");
  assert.ok(start >= 0);
  const body = main.slice(start, start + 3500);
  assert.ok(body.includes("HIDE_SCROLLBAR_CSS") || body.includes("shouldHideScrollbarsForCapture"));
  assert.ok(body.includes("insertCSS"));
  assert.ok(body.includes("removeInsertedCSS"));
}

function run() {
  const tests = [
    testSnapshotHasRefsNotOuterHtml,
    testSensitiveRedaction,
    testSizeBounded,
    testEmptySelection,
    testInferRole,
    testAccessibleNamePrefersAria,
    testPayloadIncludesAgentSnapshotFence,
    testHideScrollbarsDefaultOn,
    testMainWiresScrollbarHide,
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
