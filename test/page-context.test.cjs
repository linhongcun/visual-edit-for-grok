/**
 * Unit tests for browser-use-inspired page geometry + fault ring.
 * Run: node test/page-context.test.cjs
 */
const assert = require("assert");
const fs = require("fs");
const path = require("path");
const {
  computePageInfo,
  pageInfoFromSelection,
  formatPageInfoBlock,
  scrubFaultMessage,
  PageFaultRing,
  formatPageFaultsBlock,
} = require("../electron/page-context.cjs");
const {
  buildClipboardPayload,
  REDACTED_VALUE,
} = require("../electron/clipboard-payload.cjs");

function testGeometryPixelsAboveBelow() {
  const info = computePageInfo({
    viewportWidth: 1280,
    viewportHeight: 720,
    pageWidth: 1280,
    pageHeight: 3000,
    scrollX: 0,
    scrollY: 400,
  });
  assert.ok(info);
  assert.strictEqual(info.pixelsAbove, 400);
  assert.strictEqual(info.pixelsBelow, 3000 - 720 - 400);
  assert.strictEqual(info.pixelsLeft, 0);
  assert.strictEqual(info.pixelsRight, 0);
}

function testGeometryFromSelection() {
  const selection = {
    pageTitle: "Tall Page",
    pageUrl: "https://example.test/app?access_token=sekrit",
    captureContext: {
      pageUrl: "https://example.test/app?access_token=sekrit",
      viewport: { width: 800, height: 600, pageWidth: 800, pageHeight: 2000 },
      scroll: { x: 0, y: 100 },
      page: { width: 800, height: 2000 },
    },
  };
  const info = pageInfoFromSelection(selection);
  assert.ok(info);
  assert.strictEqual(info.pixelsAbove, 100);
  assert.strictEqual(info.pixelsBelow, 2000 - 600 - 100);
  const block = formatPageInfoBlock(info, {
    pageUrl: selection.pageUrl,
    pageTitle: selection.pageTitle,
  });
  assert.ok(block.includes("viewport_css_px:"));
  assert.ok(block.includes("pixels_above: 100"));
  assert.ok(block.includes("pixels_below:"));
  assert.ok(block.includes("note: content continues below"));
  assert.ok(!block.includes("sekrit"));
  assert.ok(
    block.includes(REDACTED_VALUE) || block.includes("%5BREDACTED%5D"),
  );
  assert.ok(!block.includes("<html"));
  assert.ok(block.length < 900);
}

function testEmptyGeometry() {
  assert.strictEqual(computePageInfo({}), null);
  assert.strictEqual(pageInfoFromSelection(null), null);
  assert.strictEqual(formatPageInfoBlock(null), "");
}

/** list(0) must return [] — not coerce via `||` to the default limit. */
function testFaultRingListZeroMeansEmpty() {
  const ring = new PageFaultRing({ maxSize: 5 });
  ring.push({ kind: "console:error", message: "boom" });
  ring.push({ kind: "console:warn", message: "soft" });
  assert.deepStrictEqual(ring.list(0), []);
  assert.strictEqual(ring.list(1).length, 1);
}

function testFaultRingCapAndScrub() {
  const ring = new PageFaultRing({ maxSize: 5 });
  assert.strictEqual(formatPageFaultsBlock(ring.list()), "");
  // Secrets first — assert scrubbing on the actual scrubbed entries
  ring.push({
    kind: "fail-load",
    message: "net::ERR_FAILED https://x.test/?password=hunter2",
  });
  ring.push({
    kind: "console:error",
    message: "Uncaught Error token=abc123secret",
  });
  const secretBody = formatPageFaultsBlock(ring.list(8));
  assert.ok(secretBody.includes("fail-load"));
  assert.ok(secretBody.includes("console:error"));
  assert.ok(!secretBody.includes("hunter2"), "password query must not leak");
  assert.ok(
    !secretBody.includes("abc123secret"),
    "bare token= value must not leak",
  );
  assert.ok(
    secretBody.includes(REDACTED_VALUE) ||
      secretBody.includes("%5BREDACTED%5D"),
    "redaction marker present",
  );

  // Cap: older entries drop when ring fills
  for (let i = 0; i < 10; i++) {
    ring.push({ kind: "console:warn", message: `w${i}` });
  }
  const list = ring.list(8);
  assert.ok(list.length <= 5);
  const body = formatPageFaultsBlock(list);
  assert.ok(body.includes("console:warn"));
  assert.ok(!body.includes("hunter2"));
  assert.ok(!body.includes("abc123secret"));
}

function testScrubFaultMessage() {
  const s = scrubFaultMessage(
    "fail https://example.com/a?access_token=tok123&ok=1",
  );
  assert.ok(!s.includes("tok123"));

  const bare = scrubFaultMessage("Uncaught Error token=abc123secret at line 1");
  assert.ok(!bare.includes("abc123secret"), "bare token= must redact");
  assert.ok(bare.includes(REDACTED_VALUE));
  assert.ok(bare.includes("token="), "key prefix may remain");
}

function testPayloadFences() {
  const selection = {
    tag: "div",
    id: "main",
    text: "hi",
    pageTitle: "P",
    pageUrl: "https://example.test/",
    captureContext: {
      pageUrl: "https://example.test/",
      viewport: { width: 400, height: 300, pageWidth: 400, pageHeight: 900 },
      scroll: { x: 0, y: 50 },
      page: { width: 400, height: 900 },
    },
  };
  const text = buildClipboardPayload({
    selection,
    pageFaults: [
      { at: "2026-01-01T00:00:00.000Z", kind: "fail-load", message: "boom" },
    ],
  });
  assert.ok(text.includes("```page_info"));
  assert.ok(text.includes("pixels_above:"));
  assert.ok(text.includes("```page_faults"));
  assert.ok(text.includes("fail-load"));
  assert.ok(text.includes("```browser_element"));
  assert.ok(!text.includes("outerHTML"));
}

function testMainWiresFaultRing() {
  const main = fs.readFileSync(
    path.join(__dirname, "../electron/main.cjs"),
    "utf8",
  );
  assert.ok(main.includes("PageFaultRing"));
  assert.ok(main.includes("previewFaultRing"));
  assert.ok(main.includes("pageFaults: previewFaultRing.list"));
  assert.ok(main.includes("did-fail-load"));
  assert.ok(main.includes("console-message"));
}

/**
 * Regression: real Aim path stamps selection via stampSelectionContext.
 * Preload-shaped captureContext with pageHeight must survive stamp so
 * buildClipboardPayload emits page_css_px + pixels_below.
 */
function testStampSelectionPreservesPageGeometryForPayload() {
  const { stampSelectionContext } = require("../electron/runtime-policy.cjs");
  // Shape emitted by preview-preload describe() before main stamps
  const rawSelection = {
    tag: "button",
    id: "cta",
    text: "Go",
    pageUrl: "https://example.test/tall",
    pageTitle: "Tall",
    captureContext: {
      navigationId: 3,
      pageUrl: "https://example.test/tall",
      viewport: {
        width: 800,
        height: 600,
        devicePixelRatio: 2,
        pageWidth: 800,
        pageHeight: 2400,
      },
      page: { width: 800, height: 2400, scrollWidth: 800, scrollHeight: 2400 },
      pageWidth: 800,
      pageHeight: 2400,
      scroll: { x: 0, y: 200 },
    },
  };
  // Same merge pattern as main attachSelectionContext
  const prior = rawSelection.captureContext;
  const priorViewport = prior.viewport || {};
  const priorScroll = prior.scroll || {};
  const stamped = stampSelectionContext(rawSelection, {
    navigationId: 3,
    navigationToken: "tok",
    sourceId: 9,
    pageUrl: rawSelection.pageUrl,
    viewport: {
      ...priorViewport,
      scrollX: priorViewport.scrollX ?? priorScroll.x ?? 0,
      scrollY: priorViewport.scrollY ?? priorScroll.y ?? 0,
    },
  });

  assert.ok(stamped.captureContext, "stamped captureContext");
  assert.ok(
    stamped.captureContext.pageHeight === 2400 ||
      stamped.captureContext.page?.height === 2400 ||
      stamped.captureContext.viewport?.pageHeight === 2400,
    "pageHeight must survive stamp",
  );

  const info = pageInfoFromSelection(stamped);
  assert.ok(info, "pageInfo from stamped selection");
  assert.strictEqual(info.pixelsAbove, 200);
  assert.strictEqual(info.pixelsBelow, 2400 - 600 - 200);

  const text = buildClipboardPayload({ selection: stamped });
  assert.ok(text.includes("```page_info"), "page_info fence after stamp");
  assert.ok(text.includes("page_css_px:"), "page size after stamp");
  assert.ok(text.includes("pixels_below: 1600"), "pixels_below after stamp");
}

function run() {
  const tests = [
    testGeometryPixelsAboveBelow,
    testGeometryFromSelection,
    testEmptyGeometry,
    testFaultRingListZeroMeansEmpty,
    testFaultRingCapAndScrub,
    testScrubFaultMessage,
    testPayloadFences,
    testMainWiresFaultRing,
    testStampSelectionPreservesPageGeometryForPayload,
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
