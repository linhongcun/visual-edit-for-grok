/**
 * Unit tests for shipped operator guidance (actionable errors + quit policy).
 */
const assert = require("assert");
const {
  inferOperatorErrorCode,
  buildActionableError,
  shouldConfirmQuit,
  statusLabelKeys,
} = require("../electron/operator-guidance.cjs");

function testInferPreviewNotReady() {
  assert.strictEqual(
    inferOperatorErrorCode({
      message: "Preview is not ready — open a loaded http(s) page first.",
    }),
    "preview-not-ready",
  );
}

function testInferNothingToResend() {
  assert.strictEqual(
    inferOperatorErrorCode({
      message: "Nothing to re-send — Aim or Frame first",
    }),
    "nothing-to-resend",
  );
}

function testInferBusy() {
  assert.strictEqual(
    inferOperatorErrorCode({ message: "Capture in progress — wait a moment." }),
    "busy",
  );
}

function testInferGrokMissing() {
  assert.strictEqual(
    inferOperatorErrorCode({
      message: "spawn grok ENOENT: no such file or directory",
    }),
    "grok-missing",
  );
}

function testInferTerminalStartFail() {
  assert.strictEqual(
    inferOperatorErrorCode({
      message: "node-pty failed to load. Reinstall the app or run: npm run rebuild",
    }),
    "terminal-start-fail",
  );
}

function testBuildActionableIncludesNextStep() {
  const codes = [
    "preview-not-ready",
    "preview-load-fail",
    "grok-missing",
    "grok-launch-fail",
    "terminal-start-fail",
    "nothing-to-resend",
    "busy",
  ];
  for (const code of codes) {
    const r = buildActionableError({ code, locale: "en" });
    assert.strictEqual(r.code, code);
    assert.strictEqual(r.confirmedChip, false);
    assert.ok(r.message && r.message.length > 4, code);
    assert.ok(r.nextStep && r.nextStep.length > 4, code);
    assert.ok(r.text.includes(r.message), code);
    assert.ok(r.text.includes(r.nextStep), `${code} next step in text`);
    assert.ok(
      /next:/i.test(r.nextStep) || /press|click|run|wait|aim|install|set /i.test(r.nextStep),
      `${code} next step actionable: ${r.nextStep}`,
    );
    assert.ok(!/confirmed chip|chip confirmed/i.test(r.text), code);
  }
}

function testBuildActionableZhHasNextStep() {
  const r = buildActionableError({ code: "nothing-to-resend", locale: "zh" });
  assert.strictEqual(r.code, "nothing-to-resend");
  assert.ok(r.nextStep.includes("下一步") || r.nextStep.length > 4);
  assert.ok(!/confirmed chip/i.test(r.text));
}

function testShouldConfirmQuit() {
  assert.strictEqual(shouldConfirmQuit({ sessionAlive: true }), true);
  assert.strictEqual(shouldConfirmQuit({ shellAlive: true }), true);
  assert.strictEqual(shouldConfirmQuit({ grokRunning: true }), true);
  assert.strictEqual(shouldConfirmQuit({ terminalAlive: true }), true);
  assert.strictEqual(shouldConfirmQuit({}), false);
  assert.strictEqual(
    shouldConfirmQuit({ sessionAlive: false, grokRunning: false }),
    false,
  );
}

function testStatusLabelKeysSeparateShellAndGrok() {
  const a = statusLabelKeys({ shellAlive: true, grokState: "launch-requested" });
  assert.strictEqual(a.shellLabelKey, "status.shellOn");
  assert.strictEqual(a.grokLabelKey, "status.grokRequested");
  const b = statusLabelKeys({ shellAlive: true, grokState: "ready" });
  assert.strictEqual(b.grokLabelKey, "status.grokReady");
  const c = statusLabelKeys({ shellAlive: false, grokState: "idle" });
  assert.strictEqual(c.shellLabelKey, "status.shellOff");
}

function run() {
  const tests = [
    testInferPreviewNotReady,
    testInferNothingToResend,
    testInferBusy,
    testInferGrokMissing,
    testInferTerminalStartFail,
    testBuildActionableIncludesNextStep,
    testBuildActionableZhHasNextStep,
    testShouldConfirmQuit,
    testStatusLabelKeysSeparateShellAndGrok,
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
