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
  planGrokMultimodalPaste,
  extractOsc52ClipboardPayloads,
  buildGrokHostDiagnosticBlock,
  DEFAULT_TERM_PROGRAM,
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

function testPasteKeysDarwinHasSuper() {
  const k = resolveGrokPasteKeySequences({ platform: "darwin" });
  assert.strictEqual(k.ctrlV, SEQ_CTRL_V);
  assert.strictEqual(k.superV, SEQ_SUPER_V);
  assert.strictEqual(k.useSuperV, true);
  // Super+V is Kitty CSI-u for codepoint 'v' with super mod
  assert.ok(k.superV.includes("118"));
  assert.ok(k.superV.includes("9u") || k.superV.endsWith("9u"));
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
  const restoreIdx = kinds.indexOf("clipboard-image-restore");
  assert.ok(imgIdx >= 0);
  assert.ok(ctrlIdx > imgIdx);
  assert.ok(textIdx > ctrlIdx, "text must come after image paste keys");
  assert.ok(restoreIdx > textIdx);

  const writes = plan.steps.filter((s) => s.kind === "write");
  assert.strictEqual(writes[0].sequence, SEQ_CTRL_V);
  assert.strictEqual(writes[0].reason, "ctrl-v-paste");
  assert.strictEqual(writes[1].sequence, SEQ_SUPER_V);
  assert.strictEqual(writes[1].reason, "super-v-paste");

  // Never plan a mixed clipboard-text+image step for auto path
  assert.ok(!kinds.includes("clipboard-bundle-mixed"));
  assert.ok(plan.terminalSetupHint.includes("/terminal-setup"));
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
  assert.strictEqual(block.pasteSuperV, true);
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
  assert.ok(main.includes("extractOsc52ClipboardPayloads"));
  assert.ok(term.includes("resolveGrokTermProgramIdentity"));
  assert.ok(diag.includes("grokHost") || main.includes("grokHost"));
  assert.ok(main.includes("clipboard-image-only") || main.includes("plan.steps"));
}

function run() {
  const tests = [
    testIdentitySpoofsWeakParents,
    testIdentityKeepsGhosttyParent,
    testIdentityPreferredGrokDesktop,
    testPasteKeysDarwinHasSuper,
    testPasteKeysLinuxCtrlOnly,
    testPlanImageThenTextOrdering,
    testPlanTwoImagesTwoCtrlV,
    testOsc52Extract,
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
