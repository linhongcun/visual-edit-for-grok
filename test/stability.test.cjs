/**
 * Unit tests for production stability helpers (real shipped electron/stability.cjs).
 * Run: node test/stability.test.cjs
 */
const assert = require("assert");
const fs = require("fs");
const path = require("path");
const {
  classifyStabilityError,
  StabilityErrorBuffer,
  createOncePerRun,
  reportStabilityFault,
  findForbiddenMainRequires,
  scanMainRequireGraph,
  DEFAULT_RING_SIZE,
} = require("../electron/stability.cjs");

function testClassifyExpectedUserCancel() {
  const a = classifyStabilityError({ code: "user-cancel", message: "dialog dismissed" });
  assert.strictEqual(a.severity, "expected");
  assert.strictEqual(a.code, "user-cancel");
}

function testClassifyExpectedGrokMissing() {
  const a = classifyStabilityError({
    message: "spawn grok ENOENT — cannot find grok binary",
  });
  assert.strictEqual(a.severity, "expected");
  assert.match(a.code, /grok-missing|enoent|error/i);
}

function testClassifyExpectedPreviewNetwork() {
  const a = classifyStabilityError({
    code: "preview-load",
    message: "net::ERR_CONNECTION_REFUSED http://127.0.0.1:9/",
  });
  assert.strictEqual(a.severity, "expected");
}

function testClassifyActionableUncaught() {
  const a = classifyStabilityError({
    code: "uncaughtException",
    message: "Cannot find module '../src/term-settings.cjs'",
  });
  assert.strictEqual(a.severity, "actionable");
  assert.match(a.message, /Cannot find module/i);
}

function testClassifyActionableTypeError() {
  const a = classifyStabilityError(new TypeError("Cannot read properties of null"));
  assert.strictEqual(a.severity, "actionable");
  assert.match(a.message, /null|properties/i);
}

function testRingBufferDropsOldestAndScrubsSecrets() {
  const buf = new StabilityErrorBuffer({ maxSize: 3, now: () => 1000 });
  buf.push({
    code: "a",
    message: "https://evil.example/x?token=supersecret",
    severity: "actionable",
  });
  buf.push({ code: "b", message: "two", severity: "actionable" });
  buf.push({ code: "c", message: "three", severity: "actionable" });
  buf.push({ code: "d", message: "four api_key=abc123xyz", severity: "actionable" });
  assert.strictEqual(buf.size(), 3);
  const list = buf.list();
  assert.strictEqual(list[0].code, "b");
  assert.strictEqual(list[2].code, "d");
  assert.doesNotMatch(JSON.stringify(list), /supersecret|abc123xyz/);
  assert.match(list[2].message, /REDACTED|api_key/i);
}

function testRingCoalescesIdenticalTail() {
  const buf = new StabilityErrorBuffer({ maxSize: 5 });
  buf.push({ code: "x", message: "same", severity: "expected" });
  buf.push({ code: "x", message: "same", severity: "expected" });
  buf.push({ code: "x", message: "same", severity: "expected" });
  assert.strictEqual(buf.size(), 1);
  assert.strictEqual(buf.list()[0].count, 3);
}

function testOncePerRunThrottle() {
  const once = createOncePerRun();
  assert.strictEqual(once("k1"), true);
  assert.strictEqual(once("k1"), false);
  assert.strictEqual(once("k2"), true);
}

function testReportStabilityFaultUsesBuffer() {
  const buf = new StabilityErrorBuffer({ maxSize: 5 });
  const once = createOncePerRun();
  const e1 = reportStabilityFault(
    buf,
    { code: "uncaughtException", message: "boom", source: "process" },
    { once, throttleKey: "boom" },
  );
  assert.ok(e1);
  assert.strictEqual(e1.severity, "actionable");
  const e2 = reportStabilityFault(
    buf,
    { code: "uncaughtException", message: "boom", source: "process" },
    { once, throttleKey: "boom" },
  );
  assert.strictEqual(e2, null);
  assert.strictEqual(buf.size(), 1);
}

function testPackagingGuardDetectsSrcRequire() {
  const bad = `const x = require("../src/term-settings.cjs");\n`;
  const result = findForbiddenMainRequires(bad, "electron/settings-store.cjs");
  assert.strictEqual(result.ok, false);
  assert.ok(result.violations.length >= 1);
  assert.match(result.violations[0].snippet, /term-settings/);
}

function testPackagingGuardAcceptsElectronRelative() {
  const good = `const x = require("./term-settings.cjs");\nconst y = require("./diagnostics.cjs");\n`;
  const result = findForbiddenMainRequires(good, "electron/settings-store.cjs");
  assert.strictEqual(result.ok, true);
}

function testPackagingGuardScansRealElectronTree() {
  const electronDir = path.join(__dirname, "..", "electron");
  const files = {};
  for (const name of fs.readdirSync(electronDir)) {
    if (!name.endsWith(".cjs")) continue;
    files[`electron/${name}`] = fs.readFileSync(
      path.join(electronDir, name),
      "utf8",
    );
  }
  const result = scanMainRequireGraph(files);
  assert.strictEqual(
    result.ok,
    true,
    `Forbidden out-of-asar requires:\n${result.violations
      .map((v) => `${v.file}:${v.line} ${v.snippet}`)
      .join("\n")}`,
  );
  // Ensure we actually scanned the modules that matter
  assert.ok(files["electron/main.cjs"]);
  assert.ok(files["electron/settings-store.cjs"]);
  assert.ok(files["electron/stability.cjs"]);
}

function testDefaultRingSizeIsPositive() {
  assert.ok(DEFAULT_RING_SIZE >= 10);
}

function run() {
  const tests = [
    testClassifyExpectedUserCancel,
    testClassifyExpectedGrokMissing,
    testClassifyExpectedPreviewNetwork,
    testClassifyActionableUncaught,
    testClassifyActionableTypeError,
    testRingBufferDropsOldestAndScrubsSecrets,
    testRingCoalescesIdenticalTail,
    testOncePerRunThrottle,
    testReportStabilityFaultUsesBuffer,
    testPackagingGuardDetectsSrcRequire,
    testPackagingGuardAcceptsElectronRelative,
    testPackagingGuardScansRealElectronTree,
    testDefaultRingSizeIsPositive,
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
