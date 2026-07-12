/**
 * Unit tests for playwright-mcp-inspired network request summary.
 * Run: node test/network-requests.test.cjs
 */
const assert = require("assert");
const fs = require("fs");
const path = require("path");
const {
  normalizeNetworkEntry,
  NetworkRequestRing,
  formatNetworkRequestsBlock,
} = require("../electron/page-context.cjs");
const {
  buildClipboardPayload,
  REDACTED_VALUE,
} = require("../electron/clipboard-payload.cjs");

function testNormalizeSkipsChromeSchemes() {
  assert.strictEqual(
    normalizeNetworkEntry({ url: "chrome://settings", method: "GET" }),
    null,
  );
  assert.strictEqual(
    normalizeNetworkEntry({ url: "data:text/plain,hi", method: "GET" }),
    null,
  );
}

function testNormalizeScrubsUrlSecrets() {
  const e = normalizeNetworkEntry({
    url: "https://api.example.com/v1?access_token=sekrit999&q=1",
    method: "get",
    status: 200,
    resourceType: "xhr",
  });
  assert.ok(e);
  assert.strictEqual(e.method, "GET");
  assert.strictEqual(e.status, 200);
  assert.ok(!e.url.includes("sekrit999"));
  assert.ok(e.url.includes(REDACTED_VALUE) || e.url.includes("%5BREDACTED%5D"));
}

function testFailedEntry() {
  const e = normalizeNetworkEntry({
    url: "https://example.com/x?token=abc123secret",
    method: "GET",
    error: "net::ERR_FAILED",
    failed: true,
    resourceType: "mainFrame",
  });
  assert.ok(e.failed);
  assert.ok(!e.url.includes("abc123secret"));
  const body = formatNetworkRequestsBlock([e]);
  assert.ok(body.includes("1. GET"));
  assert.ok(body.includes("FAIL") || body.includes("net"));
  assert.ok(!body.includes("abc123secret"));
}

function testEmptyListNoBody() {
  assert.strictEqual(formatNetworkRequestsBlock([]), "");
  assert.strictEqual(formatNetworkRequestsBlock(null), "");
}

function testRingPrefersFailedAndCaps() {
  const ring = new NetworkRequestRing({ maxSize: 30 });
  for (let i = 0; i < 20; i++) {
    ring.push({
      url: `https://cdn.example.com/img${i}.png`,
      method: "GET",
      status: 200,
      resourceType: "image",
    });
  }
  ring.push({
    url: "https://api.example.com/fail?password=hunter2",
    method: "POST",
    status: 500,
    resourceType: "xhr",
    failed: true,
  });
  ring.push({
    url: "https://example.com/",
    method: "GET",
    status: 200,
    resourceType: "mainFrame",
  });
  const list = ring.list(5);
  assert.ok(list.length <= 5);
  assert.ok(list[0].failed, "failed first");
  const body = formatNetworkRequestsBlock(list);
  assert.ok(!body.includes("hunter2"));
  assert.ok(body.length < 1600);
}

function testPayloadFenceWhenNonEmpty() {
  const text = buildClipboardPayload({
    selection: {
      tag: "div",
      text: "x",
      pageUrl: "https://example.com/",
      captureContext: {
        pageUrl: "https://example.com/",
        viewport: { width: 100, height: 100, scrollX: 0, scrollY: 0 },
      },
    },
    networkRequests: [
      {
        method: "GET",
        status: 404,
        resourceType: "xhr",
        url: "https://example.com/api?token=leakme",
        failed: true,
        error: "",
      },
    ],
  });
  assert.ok(text.includes("```network_requests"));
  assert.ok(text.includes("GET"));
  assert.ok(!text.includes("leakme"));
  assert.ok(!text.includes("<html"));
}

function testPayloadOmitsEmptyNetworkFence() {
  const text = buildClipboardPayload({
    selection: {
      tag: "div",
      text: "x",
      pageUrl: "https://example.com/",
    },
    networkRequests: [],
  });
  assert.ok(!text.includes("```network_requests"));
}

function testMainWiresWebRequest() {
  const main = fs.readFileSync(
    path.join(__dirname, "../electron/main.cjs"),
    "utf8",
  );
  assert.ok(main.includes("NetworkRequestRing"));
  assert.ok(main.includes("previewNetworkRing"));
  assert.ok(main.includes("webRequest.onCompleted"));
  assert.ok(main.includes("webRequest.onErrorOccurred"));
  assert.ok(main.includes("networkRequests: previewNetworkRing.list"));
  assert.ok(main.includes("previewNetworkRing.clear"));
}

function run() {
  const tests = [
    testNormalizeSkipsChromeSchemes,
    testNormalizeScrubsUrlSecrets,
    testFailedEntry,
    testEmptyListNoBody,
    testRingPrefersFailedAndCaps,
    testPayloadFenceWhenNonEmpty,
    testPayloadOmitsEmptyNetworkFence,
    testMainWiresWebRequest,
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
