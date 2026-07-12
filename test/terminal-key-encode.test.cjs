/**
 * Unit tests for Grok host key encoding (shipped module).
 * Run: node test/terminal-key-encode.test.cjs
 */
const assert = require("assert");
const {
  resolveGrokHostKey,
  encodeModifiedEnterForGrok,
  KITTY_MOD_SUPER,
  KITTY_KEY_A,
} = require("../src/terminal-key-encode.cjs");

function testPlainEnterPassthrough() {
  assert.strictEqual(
    resolveGrokHostKey({ type: "keydown", key: "Enter" }),
    null,
  );
}

function testShiftEnterKeydownWritesEscCr() {
  const r = resolveGrokHostKey({
    type: "keydown",
    key: "Enter",
    shiftKey: true,
  });
  assert.ok(r);
  assert.strictEqual(r.action, "write");
  assert.strictEqual(r.sequence, "\x1b\r");
}

function testShiftEnterKeypressSwallows() {
  const r = resolveGrokHostKey({
    type: "keypress",
    key: "Enter",
    shiftKey: true,
  });
  assert.ok(r);
  assert.strictEqual(r.action, "swallow");
}

function testCmdBackspaceClearsViaSelectAllDelete() {
  const r = resolveGrokHostKey({
    type: "keydown",
    key: "Backspace",
    metaKey: true,
  });
  assert.ok(r);
  assert.strictEqual(r.action, "write");
  assert.strictEqual(r.reason, "cmd-backspace-clear-line");
  // Super+A then DEL
  assert.strictEqual(
    r.sequence,
    `\x1b[${KITTY_KEY_A};${KITTY_MOD_SUPER}u\x7f`,
  );
}

function testCmdDeleteSameAsCmdBackspace() {
  const r = resolveGrokHostKey({
    type: "keydown",
    key: "Delete",
    metaKey: true,
  });
  assert.ok(r);
  assert.strictEqual(r.action, "write");
  assert.strictEqual(r.reason, "cmd-backspace-clear-line");
}

function testCmdBackspaceKeypressSwallows() {
  const r = resolveGrokHostKey({
    type: "keypress",
    key: "Backspace",
    metaKey: true,
  });
  assert.ok(r);
  assert.strictEqual(r.action, "swallow");
}

function testCmdASelectAll() {
  const r = resolveGrokHostKey({
    type: "keydown",
    key: "a",
    metaKey: true,
  });
  assert.ok(r);
  assert.strictEqual(r.action, "write");
  assert.strictEqual(r.sequence, `\x1b[${KITTY_KEY_A};${KITTY_MOD_SUPER}u`);
  assert.strictEqual(r.reason, "cmd-a-select-all");
}

function testCmdAUppercase() {
  const r = resolveGrokHostKey({
    type: "keydown",
    key: "A",
    metaKey: true,
  });
  assert.ok(r);
  assert.strictEqual(r.action, "write");
}

function testCtrlEnterStillWorks() {
  const r = resolveGrokHostKey({
    type: "keydown",
    key: "Enter",
    ctrlKey: true,
  });
  assert.ok(r);
  assert.strictEqual(r.sequence, "\x1b[13;5u");
}

function testEncodeCompat() {
  assert.ok(
    encodeModifiedEnterForGrok({
      type: "keydown",
      key: "Enter",
      shiftKey: true,
    }),
  );
}

function run() {
  const tests = [
    testPlainEnterPassthrough,
    testShiftEnterKeydownWritesEscCr,
    testShiftEnterKeypressSwallows,
    testCmdBackspaceClearsViaSelectAllDelete,
    testCmdDeleteSameAsCmdBackspace,
    testCmdBackspaceKeypressSwallows,
    testCmdASelectAll,
    testCmdAUppercase,
    testCtrlEnterStillWorks,
    testEncodeCompat,
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
