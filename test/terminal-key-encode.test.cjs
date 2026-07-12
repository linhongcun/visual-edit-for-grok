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
  SEQ_LINE_START,
  SEQ_LINE_END,
  SEQ_BUFFER_START,
  SEQ_BUFFER_END,
  SEQ_WORD_DELETE_FORWARD,
  SEQ_DELETE_ALL_LEFT,
  SEQ_DELETE_ALL_RIGHT,
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

function testCmdBackspaceDeletesAllLeft() {
  const r = resolveGrokHostKey({
    type: "keydown",
    key: "Backspace",
    metaKey: true,
  });
  assert.ok(r);
  assert.strictEqual(r.action, "write");
  assert.strictEqual(r.reason, "cmd-backspace-delete-left");
  // Ctrl+U — cursor to line start (Warp DeleteAllLeft / macOS)
  assert.strictEqual(r.sequence, SEQ_DELETE_ALL_LEFT);
  assert.strictEqual(r.sequence, "\x15");
  assert.notStrictEqual(
    r.sequence,
    `\x1b[${KITTY_KEY_A};${KITTY_MOD_SUPER}u\x7f`,
  );
}

function testCmdDeleteDeletesAllRight() {
  const r = resolveGrokHostKey({
    type: "keydown",
    key: "Delete",
    metaKey: true,
  });
  assert.ok(r);
  assert.strictEqual(r.action, "write");
  assert.strictEqual(r.reason, "cmd-delete-delete-right");
  // Ctrl+K — cursor to line end (Warp DeleteAllRight / macOS)
  assert.strictEqual(r.sequence, SEQ_DELETE_ALL_RIGHT);
  assert.strictEqual(r.sequence, "\x0b");
}

function testCmdBackspaceKeypressSwallows() {
  const r = resolveGrokHostKey({
    type: "keypress",
    key: "Backspace",
    metaKey: true,
  });
  assert.ok(r);
  assert.strictEqual(r.action, "swallow");
  assert.strictEqual(r.reason, "cmd-backspace-swallow");
}

function testCmdDeleteKeypressSwallows() {
  const r = resolveGrokHostKey({
    type: "keypress",
    key: "Delete",
    metaKey: true,
  });
  assert.ok(r);
  assert.strictEqual(r.action, "swallow");
  assert.strictEqual(r.reason, "cmd-delete-swallow");
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

function testCmdLeftLineStart() {
  const r = resolveGrokHostKey({
    type: "keydown",
    key: "ArrowLeft",
    metaKey: true,
  });
  assert.ok(r);
  assert.strictEqual(r.action, "write");
  assert.strictEqual(r.sequence, SEQ_LINE_START);
  assert.strictEqual(r.reason, "cmd-left-line-start");
}

function testCmdRightLineEnd() {
  const r = resolveGrokHostKey({
    type: "keydown",
    key: "ArrowRight",
    metaKey: true,
  });
  assert.ok(r);
  assert.strictEqual(r.action, "write");
  assert.strictEqual(r.sequence, SEQ_LINE_END);
  assert.strictEqual(r.reason, "cmd-right-line-end");
}

function testCmdLeftKeypressSwallows() {
  const r = resolveGrokHostKey({
    type: "keypress",
    key: "ArrowLeft",
    metaKey: true,
  });
  assert.ok(r);
  assert.strictEqual(r.action, "swallow");
  assert.strictEqual(r.reason, "cmd-left-swallow");
}

function testCmdUpBufferStart() {
  const r = resolveGrokHostKey({
    type: "keydown",
    key: "ArrowUp",
    metaKey: true,
  });
  assert.ok(r);
  assert.strictEqual(r.action, "write");
  assert.strictEqual(r.sequence, SEQ_BUFFER_START);
  assert.strictEqual(r.reason, "cmd-up-buffer-start");
}

function testCmdDownBufferEnd() {
  const r = resolveGrokHostKey({
    type: "keydown",
    key: "ArrowDown",
    metaKey: true,
  });
  assert.ok(r);
  assert.strictEqual(r.action, "write");
  assert.strictEqual(r.sequence, SEQ_BUFFER_END);
  assert.strictEqual(r.reason, "cmd-down-buffer-end");
}

function testCmdArrowWithCtrlIgnored() {
  assert.strictEqual(
    resolveGrokHostKey({
      type: "keydown",
      key: "ArrowLeft",
      metaKey: true,
      ctrlKey: true,
    }),
    null,
  );
}

function testPlainArrowPassthrough() {
  assert.strictEqual(
    resolveGrokHostKey({ type: "keydown", key: "ArrowLeft" }),
    null,
  );
  assert.strictEqual(
    resolveGrokHostKey({ type: "keydown", key: "ArrowUp" }),
    null,
  );
}

function testAltLeftPassthrough() {
  // Word motion left is stock xterm (ESC b); do not steal.
  assert.strictEqual(
    resolveGrokHostKey({
      type: "keydown",
      key: "ArrowLeft",
      altKey: true,
    }),
    null,
  );
}

function testAltDeleteWordForward() {
  const r = resolveGrokHostKey({
    type: "keydown",
    key: "Delete",
    altKey: true,
  });
  assert.ok(r);
  assert.strictEqual(r.action, "write");
  assert.strictEqual(r.sequence, SEQ_WORD_DELETE_FORWARD);
  assert.strictEqual(r.reason, "alt-delete-word-forward");
}

function testAltDeleteKeypressSwallows() {
  const r = resolveGrokHostKey({
    type: "keypress",
    key: "Delete",
    altKey: true,
  });
  assert.ok(r);
  assert.strictEqual(r.action, "swallow");
}

function testCmdShiftArrowNotRemappedYet() {
  // Selection-extend chords reserved; do not emit partial line motion.
  assert.strictEqual(
    resolveGrokHostKey({
      type: "keydown",
      key: "ArrowLeft",
      metaKey: true,
      shiftKey: true,
    }),
    null,
  );
}

function run() {
  const tests = [
    testPlainEnterPassthrough,
    testShiftEnterKeydownWritesEscCr,
    testShiftEnterKeypressSwallows,
    testCmdBackspaceDeletesAllLeft,
    testCmdDeleteDeletesAllRight,
    testCmdBackspaceKeypressSwallows,
    testCmdDeleteKeypressSwallows,
    testCmdASelectAll,
    testCmdAUppercase,
    testCtrlEnterStillWorks,
    testEncodeCompat,
    testCmdLeftLineStart,
    testCmdRightLineEnd,
    testCmdLeftKeypressSwallows,
    testCmdUpBufferStart,
    testCmdDownBufferEnd,
    testCmdArrowWithCtrlIgnored,
    testPlainArrowPassthrough,
    testAltLeftPassthrough,
    testAltDeleteWordForward,
    testAltDeleteKeypressSwallows,
    testCmdShiftArrowNotRemappedYet,
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
