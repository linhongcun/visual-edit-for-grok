/**
 * Unit tests for Grok-facing modified Enter encoding (shipped module).
 * Run: node test/terminal-key-encode.test.cjs
 */
const assert = require("assert");
const {
  encodeModifiedEnterForGrok,
  resolveModifiedEnterForGrok,
} = require("../src/terminal-key-encode.cjs");

function testPlainEnterPassthrough() {
  assert.strictEqual(
    resolveModifiedEnterForGrok({ type: "keydown", key: "Enter" }),
    null,
  );
}

function testShiftEnterKeydownWritesEscCr() {
  const r = resolveModifiedEnterForGrok({
    type: "keydown",
    key: "Enter",
    shiftKey: true,
  });
  assert.ok(r);
  assert.strictEqual(r.action, "write");
  assert.strictEqual(r.sequence, "\x1b\r");
  assert.strictEqual(r.reason, "shift-enter-newline");
}

function testShiftEnterKeypressSwallowsWithoutWrite() {
  // Regression: if keypress is not swallowed, xterm emits bare CR after our
  // ESC+CR and Grok submits the message (user report: Alt+Enter OK, Shift+Enter not).
  const r = resolveModifiedEnterForGrok({
    type: "keypress",
    key: "Enter",
    shiftKey: true,
  });
  assert.ok(r);
  assert.strictEqual(r.action, "swallow");
  assert.strictEqual(r.sequence, undefined);
}

function testShiftEnterKeyupSwallows() {
  const r = resolveModifiedEnterForGrok({
    type: "keyup",
    key: "Enter",
    shiftKey: true,
  });
  assert.ok(r);
  assert.strictEqual(r.action, "swallow");
}

function testAltEnterLeftToXtermDefault() {
  assert.strictEqual(
    resolveModifiedEnterForGrok({
      type: "keydown",
      key: "Enter",
      altKey: true,
    }),
    null,
  );
}

function testCtrlEnterKittyCsiU() {
  const r = resolveModifiedEnterForGrok({
    type: "keydown",
    key: "Enter",
    ctrlKey: true,
  });
  assert.ok(r);
  assert.strictEqual(r.action, "write");
  assert.strictEqual(r.sequence, "\x1b[13;5u");
}

function testCtrlEnterKeypressSwallows() {
  const r = resolveModifiedEnterForGrok({
    type: "keypress",
    key: "Enter",
    ctrlKey: true,
  });
  assert.ok(r);
  assert.strictEqual(r.action, "swallow");
}

function testEncodeCompatOnlyKeydownWrite() {
  assert.ok(
    encodeModifiedEnterForGrok({
      type: "keydown",
      key: "Enter",
      shiftKey: true,
    }),
  );
  assert.strictEqual(
    encodeModifiedEnterForGrok({
      type: "keypress",
      key: "Enter",
      shiftKey: true,
    }),
    null,
  );
}

function run() {
  const tests = [
    testPlainEnterPassthrough,
    testShiftEnterKeydownWritesEscCr,
    testShiftEnterKeypressSwallowsWithoutWrite,
    testShiftEnterKeyupSwallows,
    testAltEnterLeftToXtermDefault,
    testCtrlEnterKittyCsiU,
    testCtrlEnterKeypressSwallows,
    testEncodeCompatOnlyKeydownWrite,
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
