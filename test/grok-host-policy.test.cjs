/**
 * Unit tests for Grok Build host adaptation policy.
 * Run: node test/grok-host-policy.test.cjs
 */
const assert = require("assert");
const fs = require("fs");
const path = require("path");
const {
  resolveGrokTermProgramIdentity,
  resolveGrokPasteKeySequences,
  resolvePasteDelayMs,
  planGrokMultimodalPaste,
  mayExecuteGrokPasteStep,
  extractOsc52ClipboardPayloads,
  pushOsc52Stream,
  shouldApplyOsc52ToSystemClipboard,
  buildGrokHostDiagnosticBlock,
  DEFAULT_TERM_PROGRAM,
  DEFAULT_PASTE_DELAYS_MS,
  PASTE_DELAY_MAX_MS,
  SEQ_CTRL_V,
  SEQ_SUPER_V,
  TERMINAL_SETUP_HINT,
} = require("../electron/grok-host-policy.cjs");

function testIdentitySpoofsWeakParents() {
  for (const parent of ["", "Apple_Terminal", "Electron", "vscode", "iTerm.app"]) {
    const r = resolveGrokTermProgramIdentity({
      parentTermProgram: parent,
    });
    assert.strictEqual(r.termProgram, DEFAULT_TERM_PROGRAM, parent);
    assert.strictEqual(r.spoofed, true, parent);
  }
}

function testIdentityKeepsGhosttyParent() {
  const r = resolveGrokTermProgramIdentity({
    parentTermProgram: "ghostty",
    parentTermProgramVersion: "1.2.3",
  });
  assert.strictEqual(r.termProgram, "ghostty");
  assert.strictEqual(r.termProgramVersion, "1.2.3");
  assert.strictEqual(r.spoofed, false);
  assert.strictEqual(r.reason, "keep-parent");
}

function testIdentityPreferredGrokDesktop() {
  const r = resolveGrokTermProgramIdentity({
    parentTermProgram: "Electron",
    preferredBrand: "grokdesktop",
  });
  assert.strictEqual(r.termProgram, "grokdesktop");
  assert.strictEqual(r.reason, "preferred-override");
}

function testPasteKeysDarwinCtrlOnlyByDefault() {
  // Dual Super+V was racing Grok's clipboard probe and breaking DOM paste
  const k = resolveGrokPasteKeySequences({ platform: "darwin" });
  assert.strictEqual(k.ctrlV, SEQ_CTRL_V);
  assert.strictEqual(k.useSuperV, false);
  assert.strictEqual(k.superV, null);
}

function testPasteKeysDarwinSuperOptIn() {
  const k = resolveGrokPasteKeySequences({
    platform: "darwin",
    preferSuperV: true,
  });
  assert.strictEqual(k.useSuperV, true);
  assert.strictEqual(k.superV, SEQ_SUPER_V);
  assert.ok(k.superV.includes("118"));
}

function testPasteKeysLinuxCtrlOnly() {
  const k = resolveGrokPasteKeySequences({ platform: "linux" });
  assert.strictEqual(k.ctrlV, SEQ_CTRL_V);
  assert.strictEqual(k.superV, null);
  assert.strictEqual(k.useSuperV, false);
}

function testPlanImageThenTextOrdering() {
  const plan = planGrokMultimodalPaste({
    platform: "darwin",
    imageCount: 1,
    hasText: true,
  });
  const kinds = plan.steps.map((s) => s.kind);
  const imgIdx = kinds.indexOf("clipboard-image-only");
  const ctrlIdx = kinds.indexOf("write");
  const textIdx = kinds.indexOf("bracketed-paste-text");
  const bundleIdx = kinds.indexOf("clipboard-text-and-image");
  assert.ok(imgIdx >= 0);
  assert.ok(ctrlIdx > imgIdx);
  assert.ok(textIdx > ctrlIdx, "text must come after image paste keys");
  assert.ok(bundleIdx > textIdx, "manual fallback bundle after text");

  const writes = plan.steps.filter((s) => s.kind === "write");
  assert.strictEqual(writes.length, 1, "default: Ctrl+V only (no Super+V dual inject)");
  assert.strictEqual(writes[0].sequence, SEQ_CTRL_V);
  assert.strictEqual(writes[0].reason, "ctrl-v-paste");
  assert.ok(!plan.steps.some((s) => s.reason === "super-v-paste"));

  // Image-only phase before text; final bundle is text+image for manual ⌘V
  assert.ok(plan.terminalSetupHint.includes("/terminal-setup"));
}

function testPlanPreferSuperVAddsSecondKey() {
  const plan = planGrokMultimodalPaste({
    platform: "darwin",
    imageCount: 1,
    hasText: false,
    preferSuperV: true,
  });
  const writes = plan.steps.filter((s) => s.kind === "write");
  assert.strictEqual(writes.length, 2);
  assert.strictEqual(writes[1].reason, "super-v-paste");
}

function testPlanTwoImagesTwoCtrlV() {
  const plan = planGrokMultimodalPaste({
    platform: "linux",
    imageCount: 2,
    hasText: false,
  });
  const ctrlWrites = plan.steps.filter(
    (s) => s.kind === "write" && s.reason === "ctrl-v-paste",
  );
  assert.strictEqual(ctrlWrites.length, 2);
  assert.ok(!plan.steps.some((s) => s.reason === "super-v-paste"));
  assert.ok(!plan.steps.some((s) => s.kind === "bracketed-paste-text"));
  // Write steps must carry imageIndex for prep-gate wiring
  assert.ok(ctrlWrites.every((s) => typeof s.imageIndex === "number"));
}

/**
 * Skeptic regression: failed clipboard prep must block Ctrl+V / Super+V
 * for that imageIndex (stale clipboard must not be pasted into Grok).
 */
function testMayExecuteSkipsWritesWhenPrepFailed() {
  const plan = planGrokMultimodalPaste({
    platform: "darwin",
    imageCount: 1,
    hasText: true,
  });
  const prepMap = new Map();
  // No prep recorded yet → image-scoped writes blocked
  const ctrl = plan.steps.find((s) => s.reason === "ctrl-v-paste");
  const text = plan.steps.find((s) => s.kind === "bracketed-paste-text");
  const bundle = plan.steps.find((s) => s.kind === "clipboard-text-and-image");
  assert.ok(ctrl && text && bundle);

  assert.strictEqual(
    mayExecuteGrokPasteStep(ctrl, prepMap).ok,
    false,
    "ctrl-v blocked before prep",
  );
  assert.strictEqual(mayExecuteGrokPasteStep(ctrl, prepMap).reason, "prep-failed");

  // Text path + final clipboard bundle always allowed
  assert.strictEqual(mayExecuteGrokPasteStep(text, prepMap).ok, true);
  assert.strictEqual(mayExecuteGrokPasteStep(bundle, prepMap).ok, true);

  // Prep success unlocks paste keys for that index only
  prepMap.set(0, true);
  assert.strictEqual(mayExecuteGrokPasteStep(ctrl, prepMap).ok, true);

  // Prep failure stays blocked
  prepMap.set(0, false);
  assert.strictEqual(mayExecuteGrokPasteStep(ctrl, prepMap).ok, false);

  // clipboard-image-only always runs (to record prep)
  const prepStep = plan.steps.find((s) => s.kind === "clipboard-image-only");
  assert.strictEqual(
    mayExecuteGrokPasteStep(prepStep, new Map()).ok,
    true,
  );
}

/** Multi-image: failed index 0 does not unlock writes for index 0 */
function testMayExecutePerImageIndex() {
  const plan = planGrokMultimodalPaste({
    platform: "linux",
    imageCount: 2,
    hasText: false,
  });
  const prep = new Map([[0, false], [1, true]]);
  const writes = plan.steps.filter((s) => s.reason === "ctrl-v-paste");
  assert.strictEqual(writes.length, 2);
  assert.strictEqual(mayExecuteGrokPasteStep(writes[0], prep).ok, false);
  assert.strictEqual(mayExecuteGrokPasteStep(writes[1], prep).ok, true);
}

function testOsc52Extract() {
  const text = "hello-osc52";
  const b64 = Buffer.from(text, "utf8").toString("base64");
  const chunk = `noise\x1b]52;c;${b64}\x07more`;
  const hits = extractOsc52ClipboardPayloads(chunk);
  assert.strictEqual(hits.length, 1);
  assert.strictEqual(hits[0].text, text);

  const st = `pre\x1b]52;c;${b64}\x1b\\post`;
  assert.strictEqual(extractOsc52ClipboardPayloads(st)[0].text, text);
  assert.deepStrictEqual(extractOsc52ClipboardPayloads("no osc"), []);
  assert.deepStrictEqual(
    extractOsc52ClipboardPayloads("\x1b]52;c;?\x07"),
    [],
  );
}

/** Split OSC 52 across two PTY chunks must still yield the payload. */
function testOsc52StreamSplitChunks() {
  const text = "split-frame-payload";
  const b64 = Buffer.from(text, "utf8").toString("base64");
  const full = `\x1b]52;c;${b64}\x07`;
  const mid = Math.floor(full.length / 2);
  const a = pushOsc52Stream({ buffer: "" }, full.slice(0, mid));
  assert.strictEqual(a.payloads.length, 0, "incomplete frame must not invent payload");
  assert.ok(a.buffer.length > 0);
  const b = pushOsc52Stream({ buffer: a.buffer }, full.slice(mid));
  assert.strictEqual(b.payloads.length, 1);
  assert.strictEqual(b.payloads[0].text, text);
  assert.strictEqual(b.buffer, "");

  // Single chunk still works
  const one = pushOsc52Stream({ buffer: "" }, full);
  assert.strictEqual(one.payloads[0].text, text);
}

/**
 * Skeptic regression: split mid ESC]52; header must not drop the frame.
 * e.g. chunk1='\x1b]5' + chunk2='2;c;<b64>\x07'
 */
function testOsc52StreamMidHeaderSplit() {
  const text = "mid-header-ok";
  const b64 = Buffer.from(text, "utf8").toString("base64");
  // Explicit mid-marker splits (not only mid-body)
  const cases = [
    ["\x1b", `]52;c;${b64}\x07`],
    ["\x1b]", `52;c;${b64}\x07`],
    ["\x1b]5", `2;c;${b64}\x07`],
    ["\x1b]52", `;c;${b64}\x07`],
    ["\x1b]52;", `c;${b64}\x07`],
  ];
  for (const [c1, c2] of cases) {
    const a = pushOsc52Stream({ buffer: "" }, c1);
    assert.strictEqual(
      a.payloads.length,
      0,
      `no payload after partial ${JSON.stringify(c1)}`,
    );
    assert.ok(
      a.buffer.length > 0,
      `must retain partial header after ${JSON.stringify(c1)}, got empty buffer`,
    );
    const b = pushOsc52Stream({ buffer: a.buffer }, c2);
    assert.strictEqual(
      b.payloads.length,
      1,
      `decode failed for split ${JSON.stringify(c1)}|${JSON.stringify(c2)}`,
    );
    assert.strictEqual(b.payloads[0].text, text);
  }

  // Noise + partial header still carries
  const n1 = pushOsc52Stream({ buffer: "" }, "noise\x1b]5");
  assert.strictEqual(n1.buffer, "\x1b]5");
  const n2 = pushOsc52Stream({ buffer: n1.buffer }, `2;c;${b64}\x07`);
  assert.strictEqual(n2.payloads[0].text, text);
}

function testPasteDelayClamps() {
  const d = resolvePasteDelayMs();
  assert.strictEqual(d.focusSettleMs, DEFAULT_PASTE_DELAYS_MS.focusSettleMs);
  const hi = resolvePasteDelayMs({ focusSettleMs: 999999, afterCtrlVMs: -10 });
  assert.strictEqual(hi.focusSettleMs, PASTE_DELAY_MAX_MS);
  assert.strictEqual(hi.afterCtrlVMs, 0);
  const plan = planGrokMultimodalPaste({
    platform: "linux",
    imageCount: 1,
    hasText: false,
    focusSettleMs: 50,
  });
  const focus = plan.steps.find((s) => s.reason === "focus-settle");
  assert.strictEqual(focus.ms, 50);
}

function testOsc52ApplyGate() {
  assert.strictEqual(
    shouldApplyOsc52ToSystemClipboard({ text: "" }).apply,
    false,
  );
  assert.strictEqual(
    shouldApplyOsc52ToSystemClipboard({ text: "   " }).apply,
    false,
  );
  assert.strictEqual(
    shouldApplyOsc52ToSystemClipboard({ text: "hello" }).apply,
    true,
  );
  assert.strictEqual(
    shouldApplyOsc52ToSystemClipboard({
      text: "hello",
      lastWriteAt: 1000,
      now: 1100,
      minIntervalMs: 400,
    }).apply,
    false,
  );
  assert.strictEqual(
    shouldApplyOsc52ToSystemClipboard({
      text: "hello",
      lastWriteAt: 1000,
      now: 1500,
      minIntervalMs: 400,
    }).apply,
    true,
  );
}

function testDiagnosticBlock() {
  const id = resolveGrokTermProgramIdentity({
    parentTermProgram: "Electron",
  });
  const block = buildGrokHostDiagnosticBlock({
    identity: id,
    platform: "darwin",
  });
  assert.strictEqual(block.termProgram, "ghostty");
  assert.strictEqual(block.pasteCtrlV, true);
  // Super+V is opt-in only (default false — dual inject broke DOM paste)
  assert.strictEqual(block.pasteSuperV, false);
  assert.strictEqual(block.pastePrepGate, true);
  assert.strictEqual(block.osc52Stream, true);
  assert.ok(block.pasteDelaysMs);
  assert.ok(block.terminalSetupHint.includes("/terminal-setup"));
  assert.strictEqual(TERMINAL_SETUP_HINT.includes("terminal-setup"), true);
}

function testMainAndTerminalWiring() {
  const main = fs.readFileSync(
    path.join(__dirname, "../electron/main.cjs"),
    "utf8",
  );
  const term = fs.readFileSync(
    path.join(__dirname, "../electron/terminal.cjs"),
    "utf8",
  );
  const diag = fs.readFileSync(
    path.join(__dirname, "../electron/diagnostics.cjs"),
    "utf8",
  );
  assert.ok(main.includes("planGrokMultimodalPaste"));
  assert.ok(main.includes("mayExecuteGrokPasteStep"));
  assert.ok(main.includes("prepOkByIndex"));
  assert.ok(main.includes("pushOsc52Stream"));
  assert.ok(main.includes("shouldApplyOsc52ToSystemClipboard"));
  assert.ok(main.includes("imagesWanted"));
  assert.ok(main.includes("clipboard-text-and-image"));
  assert.ok(main.includes("clipboard-sanitized-write"));
  assert.ok(term.includes("resolveGrokTermProgramIdentity"));
  assert.ok(diag.includes("grokHost") || main.includes("grokHost"));
  assert.ok(main.includes("clipboard-image-only") || main.includes("plan.steps"));
  // Gate paste writes through mayExecuteGrokPasteStep (not bare write loop)
  assert.ok(
    /mayExecuteGrokPasteStep\s*\(/.test(main),
    "main must call mayExecuteGrokPasteStep before paste writes",
  );
  assert.ok(
    /pushOsc52Stream\s*\(/.test(main),
    "PTY onData must use pushOsc52Stream for cross-chunk OSC 52",
  );
}

function run() {
  const tests = [
    testIdentitySpoofsWeakParents,
    testIdentityKeepsGhosttyParent,
    testIdentityPreferredGrokDesktop,
    testPasteKeysDarwinCtrlOnlyByDefault,
    testPasteKeysDarwinSuperOptIn,
    testPasteKeysLinuxCtrlOnly,
    testPlanImageThenTextOrdering,
    testPlanPreferSuperVAddsSecondKey,
    testPlanTwoImagesTwoCtrlV,
    testMayExecuteSkipsWritesWhenPrepFailed,
    testMayExecutePerImageIndex,
    testOsc52Extract,
    testOsc52StreamSplitChunks,
    testOsc52StreamMidHeaderSplit,
    testPasteDelayClamps,
    testOsc52ApplyGate,
    testDiagnosticBlock,
    testMainAndTerminalWiring,
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
