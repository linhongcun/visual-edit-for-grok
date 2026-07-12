/**
 * Unit tests for Grok-facing modified Enter encoding (shipped module).
 * Run: node test/terminal-key-encode.test.cjs
 */
const assert = require("assert");
const {
  encodeModifiedEnterForGrok,
} = require("../src/terminal-key-encode.cjs");

function testPlainEnterPassthrough() {
  assert.strictEqual(
    encodeModifiedEnterForGrok({ type: "keydown", key: "Enter" }),
    null,
  );
}

function testShiftEnterIsEscCrNewline() {
  const r = encodeModifiedEnterForGrok({
    type: "keydown",
    key: "Enter",
    shiftKey: true,
  });
  assert.ok(r);
  assert.strictEqual(r.sequence, "\x1b\r");
  assert.strictEqual(r.reason, "shift-enter-newline");
  // Same bytes Grok already accepts for Alt+Enter on xterm.js
  assert.strictEqual(r.sequence, "\x1b" + "\r");
}

function testAltEnterLeftToXtermDefault() {
  // Stock xterm already emits ESC+CR for Alt+Enter — do not double-send.
  assert.strictEqual(
    encodeModifiedEnterForGrok({
      type: "keydown",
      key: "Enter",
      altKey: true,
    }),
    null,
  );
}

function testCtrlEnterKittyCsiU() {
  const r = encodeModifiedEnterForGrok({
    type: "keydown",
    key: "Enter",
    ctrlKey: true,
  });
  assert.ok(r);
  assert.strictEqual(r.sequence, "\x1b[13;5u");
  assert.strictEqual(r.reason, "ctrl-enter-interject");
}

function testKeyupIgnored() {
  assert.strictEqual(
    encodeModifiedEnterForGrok({
      type: "keyup",
      key: "Enter",
      shiftKey: true,
    }),
    null,
  );
}

function testShiftCtrlEnterIgnored() {
  assert.strictEqual(
    encodeModifiedEnterForGrok({
      type: "keydown",
      key: "Enter",
      shiftKey: true,
      ctrlKey: true,
    }),
    null,
  );
}

function testKeyCode13ShiftWorks() {
  const r = encodeModifiedEnterForGrok({
    type: "keydown",
    keyCode: 13,
    shiftKey: true,
  });
  assert.ok(r);
  assert.strictEqual(r.sequence, "\x1b\r");
}

function run() {
  const tests = [
    testPlainEnterPassthrough,
    testShiftEnterIsEscCrNewline,
    testAltEnterLeftToXtermDefault,
    testCtrlEnterKittyCsiU,
    testKeyupIgnored,
    testShiftCtrlEnterIgnored,
    testKeyCode13ShiftWorks,
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
