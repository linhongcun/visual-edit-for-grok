/**
 * Drives shipped pure helpers used by multimodal delivery.
 */
const assert = require("assert");
const fs = require("fs");
const os = require("os");
const path = require("path");
const { buildClipboardPayload } = require("../electron/clipboard-payload.cjs");
const { cleanupCaptureDir } = require("../electron/capture-cleanup.cjs");
const {
  buildPasteStatus,
  buildDeliveryStatus,
  classifyDeliveryOutcome,
  deliveryOutcomeLabel,
} = require("../electron/delivery-status.cjs");

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
  assert.ok(text.includes("attachment is not confirmed"));
}

function testNoTerminalStatus() {
  const r = buildPasteStatus({
    terminalAlive: false,
    textPasted: false,
    imagePrepared: true,
    imageChipAttempted: false,
  });
  assert.strictEqual(r.pasted, false);
  assert.strictEqual(r.shellAlive, false);
  assert.strictEqual(r.grokReadiness, "unavailable");
  assert.strictEqual(r.deliveryConfirmed, false);
  assert.strictEqual(r.imageChipConfirmed, false);
  assert.strictEqual(r.fallback, "clipboard-only");
  assert.ok(r.statusMessage.includes("Start Grok"));
}

function testZhLocaleStatusMessage() {
  const r = buildPasteStatus({
    locale: "zh",
    terminalAlive: false,
    textPasted: false,
    imagePrepared: true,
    imageChipAttempted: false,
  });
  assert.ok(r.statusMessage.includes("启动 Grok") || r.statusMessage.includes("Grok"));
  assert.ok(!r.statusMessage.includes("Terminal not running"));
}

function testSuccessWithImageChipAttempt() {
  const r = buildPasteStatus({
    terminalAlive: true,
    grokLaunchRequested: true,
    textPasted: true,
    imagePrepared: true,
    imageChipAttempted: true,
    imageChipConfirmed: true,
  });
  assert.strictEqual(r.pasted, true);
  assert.strictEqual(r.shellAlive, true);
  assert.strictEqual(r.grokLaunchRequested, true);
  assert.strictEqual(r.grokReadiness, "unknown");
  assert.strictEqual(r.grokReady, null);
  assert.strictEqual(r.deliveryAttempted, true);
  assert.strictEqual(r.deliveryConfirmed, false);
  assert.strictEqual(r.imageChipAttempted, true);
  assert.strictEqual(r.imageChipConfirmed, false);
  assert.strictEqual(r.imageChip, false);
  assert.strictEqual(r.fallback, "verify-image-paste");
  assert.ok(r.statusMessage.includes("unconfirmed"));
  assert.ok(!/\bsent\b/i.test(r.statusMessage));
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
  assert.ok(!/\bsent\b/i.test(r.statusMessage));
}

function testShellWriteNeverClaimsGrokReceipt() {
  const r = buildDeliveryStatus({
    terminalAlive: true,
    grokLaunchRequested: false,
    textPasteAttempted: true,
    textPasted: true,
    imagePrepared: false,
    imageChipAttempted: false,
  });
  assert.strictEqual(r.pasted, true, "legacy shell-write field retained");
  assert.strictEqual(r.grokLaunchRequested, false);
  assert.strictEqual(r.grokReadiness, "unknown");
  assert.strictEqual(r.deliveryAttempted, true);
  assert.strictEqual(r.deliveryConfirmed, false);
  assert.ok(r.statusMessage.includes("unconfirmed"));
  assert.ok(!/\b(sent|received|confirmed)\b/i.test(r.statusMessage));
}

function testFailedWriteStillRecordsAttemptWithoutConfirmation() {
  const r = buildPasteStatus({
    terminalAlive: true,
    grokLaunchRequested: true,
    textPasteAttempted: true,
    textPasted: false,
    imagePrepared: true,
    imageChipAttempted: false,
  });
  assert.strictEqual(r.deliveryAttempted, true);
  assert.strictEqual(r.deliveryConfirmed, false);
  assert.strictEqual(r.pasted, false);
  assert.strictEqual(r.fallback, "clipboard-only");
}

/**
 * Prep gate: all image clipboard preps failed → never claim image paste inject.
 */
function testImagePrepAllFailedHonestManualPaste() {
  const withText = buildPasteStatus({
    locale: "en",
    terminalAlive: true,
    grokRunning: true,
    textPasted: true,
    textPasteAttempted: true,
    imagePrepared: false,
    imageChipAttempted: false,
    imagesWanted: 2,
    imagePrepOkCount: 0,
  });
  assert.strictEqual(withText.deliveryOutcome, "text-attempted");
  assert.ok(
    /never reached the clipboard|no image paste key was sent/i.test(
      withText.statusMessage,
    ),
    withText.statusMessage,
  );
  assert.ok(!/Attempted image paste/i.test(withText.statusMessage));
  assert.strictEqual(withText.fallback, "manual-image-paste");

  const noText = buildPasteStatus({
    locale: "en",
    terminalAlive: true,
    grokRunning: true,
    textPasted: false,
    textPasteAttempted: false,
    imagePrepared: false,
    imageChipAttempted: false,
    imagesWanted: 1,
    imagePrepOkCount: 0,
  });
  assert.ok(
    /Could not put the capture image on the clipboard/i.test(
      noText.statusMessage,
    ),
    noText.statusMessage,
  );
  assert.ok(!/Attempted image paste/i.test(noText.statusMessage));
  assert.notStrictEqual(noText.deliveryOutcome, "image-attempted");
}

function testLiveShellWithoutGrokUsesClipboardOnly() {
  const r = buildDeliveryStatus({
    terminalAlive: false,
    shellAlive: true,
    grokRunning: false,
    grokLaunchRequested: false,
    textPasteAttempted: false,
    textPasted: false,
    imagePrepared: true,
    imageChipAttempted: false,
  });
  assert.strictEqual(r.shellAlive, true);
  assert.strictEqual(r.grokRunning, false);
  assert.strictEqual(r.grokReadiness, "not-running");
  assert.strictEqual(r.grokReady, false);
  assert.strictEqual(r.pasted, false);
  assert.strictEqual(r.fallback, "clipboard-only");
  assert.ok(r.statusMessage.includes("Shell is running"));
  assert.ok(r.statusMessage.includes("Start Grok"));
}

function testLegacyTerminalAliveMeansReceivingGrokPty() {
  const r = buildPasteStatus({
    terminalAlive: true,
    textPasted: true,
    imagePrepared: false,
    imageChipAttempted: false,
  });
  assert.strictEqual(r.shellAlive, true);
  assert.strictEqual(r.grokRunning, true);
  assert.strictEqual(r.grokReadiness, "unknown");
  assert.strictEqual(r.pasted, true);
}

function testClassifyImageAttemptedNeverConfirmed() {
  const r = classifyDeliveryOutcome({
    imageChipAttempted: true,
    textPasted: true,
    pastedToTerminal: true,
    imageChipConfirmed: true, // hostile input — classifier must ignore
  });
  assert.strictEqual(r.kind, "image-attempted");
  assert.strictEqual(r.confirmedChip, false);
  const label = deliveryOutcomeLabel(r.kind, "en");
  assert.ok(/attempted|unconfirmed/i.test(label));
  assert.ok(!/\bconfirmed chip\b/i.test(label));
}

function testClassifyTextAttempted() {
  const r = classifyDeliveryOutcome({
    pastedToTerminal: true,
    textPasted: true,
    imageChipAttempted: false,
  });
  assert.strictEqual(r.kind, "text-attempted");
  assert.strictEqual(r.confirmedChip, false);
}

function testClassifyClipboardOnlyWhenGrokOff() {
  const r = classifyDeliveryOutcome({
    copied: true,
    pastedToTerminal: false,
    imageChipAttempted: false,
    fallback: "clipboard-only",
  });
  assert.strictEqual(r.kind, "clipboard-only");
}

function testClassifyLocalOnly() {
  const r = classifyDeliveryOutcome({
    hasImage: true,
    screenshotPath: "/tmp/a.png",
    copied: false,
    pastedToTerminal: false,
  });
  assert.strictEqual(r.kind, "local-only");
}

function testClassifyFailed() {
  const r = classifyDeliveryOutcome({ kind: "error", message: "boom" });
  assert.strictEqual(r.kind, "failed");
}

function testBuildPasteStatusIncludesOutcomeKind() {
  const r = buildPasteStatus({
    terminalAlive: true,
    grokRunning: true,
    textPasted: true,
    imagePrepared: true,
    imageChipAttempted: true,
  });
  assert.strictEqual(r.deliveryOutcome, "image-attempted");
  assert.strictEqual(r.deliveryConfirmed, false);
  assert.strictEqual(r.imageChipConfirmed, false);
  assert.ok(r.deliveryOutcomeLabel);
  assert.ok(!/chip confirmed|confirmed chip/i.test(r.deliveryOutcomeLabel));
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
    testZhLocaleStatusMessage,
    testSuccessWithImageChipAttempt,
    testManualImageFallback,
    testShellWriteNeverClaimsGrokReceipt,
    testFailedWriteStillRecordsAttemptWithoutConfirmation,
    testImagePrepAllFailedHonestManualPaste,
    testLiveShellWithoutGrokUsesClipboardOnly,
    testLegacyTerminalAliveMeansReceivingGrokPty,
    testClassifyImageAttemptedNeverConfirmed,
    testClassifyTextAttempted,
    testClassifyClipboardOnlyWhenGrokOff,
    testClassifyLocalOnly,
    testClassifyFailed,
    testBuildPasteStatusIncludesOutcomeKind,
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
