/**
 * Drives shipped pure helpers used by multimodal delivery.
 */
const assert = require("assert");
const fs = require("fs");
const os = require("os");
const path = require("path");
const { buildClipboardPayload } = require("../electron/clipboard-payload.cjs");
const { cleanupCaptureDir } = require("../electron/capture-cleanup.cjs");
const { buildPasteStatus } = require("../electron/delivery-status.cjs");

function testPayloadHasElementAndShotMultimodalHint() {
  const text = buildClipboardPayload({
    selection: {
      tag: "button",
      id: "cta",
      className: "btn",
      classes: ["btn"],
      domPath: "main > button#cta",
      selector: "button#cta",
      text: "Go",
      attributes: { id: "cta" },
      boundingBox: { top: 1, left: 2, width: 3, height: 4 },
      pageUrl: "http://127.0.0.1:8765/",
    },
    screenshotPath: "/tmp/shot.png",
  });
  assert.ok(text.includes("browser_element"));
  assert.ok(text.includes("id: cta"));
  assert.ok(text.includes("path: /tmp/shot.png"));
  assert.ok(text.includes("multimodal"));
}

function testNoTerminalStatus() {
  const r = buildPasteStatus({
    terminalAlive: false,
    textPasted: false,
    imagePrepared: true,
    imageChipAttempted: false,
  });
  assert.strictEqual(r.pasted, false);
  assert.strictEqual(r.fallback, "clipboard-only");
  assert.ok(r.statusMessage.includes("Start Grok"));
}

function testSuccessWithImageChipAttempt() {
  const r = buildPasteStatus({
    terminalAlive: true,
    textPasted: true,
    imagePrepared: true,
    imageChipAttempted: true,
  });
  assert.strictEqual(r.pasted, true);
  assert.strictEqual(r.imageChip, true);
  assert.strictEqual(r.fallback, null);
  assert.ok(r.statusMessage.includes("image chip"));
}

function testManualImageFallback() {
  const r = buildPasteStatus({
    terminalAlive: true,
    textPasted: true,
    imagePrepared: true,
    imageChipAttempted: false,
  });
  assert.strictEqual(r.fallback, "manual-image-paste");
  assert.ok(r.statusMessage.includes("⌘V"));
}

function testCleanupAfterCaptureCap() {
  const dir = path.join(os.tmpdir(), `vefg-clean-demo-${Date.now()}`);
  fs.mkdirSync(dir, { recursive: true });
  const now = Date.now();
  for (let i = 0; i < 5; i++) {
    const f = path.join(dir, `f${i}.png`);
    fs.writeFileSync(f, "x");
    const t = new Date(now - i * 1000);
    fs.utimesSync(f, t, t);
  }
  try {
    const res = cleanupCaptureDir(dir, { maxFiles: 2, maxAgeMs: 0, now });
    assert.strictEqual(res.deleted.length, 3);
    assert.strictEqual(res.kept.length, 2);
  } finally {
    fs.rmSync(dir, { recursive: true, force: true });
  }
}

function run() {
  const tests = [
    testPayloadHasElementAndShotMultimodalHint,
    testNoTerminalStatus,
    testSuccessWithImageChipAttempt,
    testManualImageFallback,
    testCleanupAfterCaptureCap,
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
