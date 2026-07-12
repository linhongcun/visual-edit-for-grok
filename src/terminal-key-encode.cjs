/**
 * Encode host-level keys for Grok TUI inside xterm.js.
 *
 * xterm.js does not emit distinguishable Super/Cmd chords (they are usually
 * swallowed or ignored). We remap them to sequences Grok understands:
 *
 * Shift+Enter  → ESC+CR (same as Alt+Enter newline)
 * Ctrl+Enter   → Kitty CSI-u Enter+Ctrl (interject)
 * Cmd+A        → Kitty Super+A (select all; Grok enables this when
 *                TERM_PROGRAM looks like Ghostty)
 * Cmd+Backspace / Cmd+Delete → Ctrl+A then Ctrl+K (clear *current* line only,
 *                not the whole multiline composer; Super+A+DEL was wrong)
 * Cmd+← / Cmd+→ → Ctrl+A / Ctrl+E (line start / end; xterm no-ops meta+arrow)
 * Cmd+↑ / Cmd+↓ → Ctrl+Home / Ctrl+End (buffer start / end)
 * Alt+Delete   → ESC d (forward word delete; stock CSI is unreliable in Grok)
 *
 * Always swallow keypress/keyup after a keydown write so xterm cannot emit a
 * second bare character (see v0.7.8 Shift+Enter fix).
 *
 * Warp editor bindings surveyed for product mapping (AGPL ideas only):
 * cmd-left/right → visual line home/end; cmd-up/down → buffer top/bottom;
 * alt-delete → delete word right. We reimplement via PTY sequences, not
 * Warp's first-party multiline editor.
 */

/**
 * @typedef {{ action: "write", sequence: string, reason: string }
 *   | { action: "swallow", reason: string }} HostKeyResult
 */

/** Kitty progressive: Super alone = 1 + 8 = 9 */
const KITTY_MOD_SUPER = 9;
/** Unicode code point for 'a' */
const KITTY_KEY_A = 97;
/** Backspace in Kitty CSI-u */
const KITTY_KEY_BACKSPACE = 127;

/** readline / most TUI composers: beginning of line */
const SEQ_LINE_START = "\x01";
/** readline / most TUI composers: end of line */
const SEQ_LINE_END = "\x05";
/** xterm Ctrl+Home — start of buffer in many multiline editors */
const SEQ_BUFFER_START = "\x1b[1;5H";
/** xterm Ctrl+End — end of buffer in many multiline editors */
const SEQ_BUFFER_END = "\x1b[1;5F";
/** readline kill-word-forward (alt-d) */
const SEQ_WORD_DELETE_FORWARD = "\x1bd";
/**
 * Clear the *current* visual/logical line only: go to line start (Ctrl+A),
 * then kill to end of line (Ctrl+K). Does not select-all the whole buffer.
 */
const SEQ_CLEAR_CURRENT_LINE = "\x01\x0b";

function isEnterKey(event) {
  return (
    event.key === "Enter" ||
    event.keyCode === 13 ||
    event.key === "NumpadEnter"
  );
}

function isBackspaceKey(event) {
  return event.key === "Backspace" || event.keyCode === 8;
}

function isForwardDeleteKey(event) {
  return event.key === "Delete" || event.keyCode === 46;
}

function isLetterA(event) {
  return event.key === "a" || event.key === "A" || event.keyCode === 65;
}

function isArrowLeft(event) {
  return event.key === "ArrowLeft" || event.keyCode === 37;
}

function isArrowRight(event) {
  return event.key === "ArrowRight" || event.keyCode === 39;
}

function isArrowUp(event) {
  return event.key === "ArrowUp" || event.keyCode === 38;
}

function isArrowDown(event) {
  return event.key === "ArrowDown" || event.keyCode === 40;
}

/**
 * @param {string} type
 * @param {string} sequence
 * @param {string} writeReason
 * @param {string} swallowReason
 * @returns {HostKeyResult}
 */
function writeOrSwallow(type, sequence, writeReason, swallowReason) {
  if (type === "keydown") {
    return { action: "write", sequence, reason: writeReason };
  }
  return { action: "swallow", reason: swallowReason };
}

/**
 * @param {{
 *   type?: string,
 *   key?: string,
 *   keyCode?: number,
 *   shiftKey?: boolean,
 *   altKey?: boolean,
 *   ctrlKey?: boolean,
 *   metaKey?: boolean,
 * }} event
 * @returns {HostKeyResult | null}
 */
function resolveGrokHostKey(event) {
  if (!event || typeof event !== "object") return null;

  const type = event.type || "keydown";
  const shift = Boolean(event.shiftKey);
  const alt = Boolean(event.altKey);
  const ctrl = Boolean(event.ctrlKey);
  const meta = Boolean(event.metaKey);

  // --- Enter family (no Meta) ---
  if (isEnterKey(event) && !meta) {
    // Shift+Enter alone → newline (ESC+CR)
    if (shift && !alt && !ctrl) {
      return writeOrSwallow(
        type,
        "\x1b\r",
        "shift-enter-newline",
        "shift-enter-swallow",
      );
    }
    // Ctrl+Enter alone → interject
    if (ctrl && !shift && !alt) {
      return writeOrSwallow(
        type,
        "\x1b[13;5u",
        "ctrl-enter-interject",
        "ctrl-enter-swallow",
      );
    }
    // Alt+Enter / plain Enter — leave to xterm
    return null;
  }

  // --- Alt-only edit chords (no Meta/Ctrl) ---
  // Warp: alt-delete → delete word right. xterm emits CSI 3;3~ which many
  // TUI editors ignore; ESC d is the classic readline forward-kill-word.
  if (alt && !meta && !ctrl && isForwardDeleteKey(event) && !shift) {
    return writeOrSwallow(
      type,
      SEQ_WORD_DELETE_FORWARD,
      "alt-delete-word-forward",
      "alt-delete-swallow",
    );
  }

  // --- macOS Meta (Cmd) edit chords ---
  // Only pure Cmd (no ctrl/alt) so we don't fight real app shortcuts.
  // Shift is allowed only where we intentionally ignore (no select-extend yet).
  if (!meta || ctrl || alt) return null;

  // Cmd+A → select all (Kitty Super+A). Needs Grok Ghostty-class detection;
  // our PTY env sets TERM_PROGRAM=ghostty for this.
  if (isLetterA(event) && !shift) {
    return writeOrSwallow(
      type,
      `\x1b[${KITTY_KEY_A};${KITTY_MOD_SUPER}u`,
      "cmd-a-select-all",
      "cmd-a-swallow",
    );
  }

  // Cmd+Backspace / Cmd+Delete → clear *current line* only (Ctrl+A + Ctrl+K).
  // Do NOT Super+A+DEL: that wipes the entire multiline Grok composer.
  // Warp splits left-of-cursor vs right-of-cursor; users asked for line clear.
  if ((isBackspaceKey(event) || isForwardDeleteKey(event)) && !shift) {
    return writeOrSwallow(
      type,
      SEQ_CLEAR_CURRENT_LINE,
      "cmd-backspace-clear-line",
      "cmd-backspace-swallow",
    );
  }

  // Cmd+← / → — xterm no-ops meta+arrow (Keyboard.ts break). Map to Ctrl+A/E
  // like Warp's macOS ctrl-a / ctrl-e line motions and Terminal.app defaults.
  if (isArrowLeft(event) && !shift) {
    return writeOrSwallow(
      type,
      SEQ_LINE_START,
      "cmd-left-line-start",
      "cmd-left-swallow",
    );
  }
  if (isArrowRight(event) && !shift) {
    return writeOrSwallow(
      type,
      SEQ_LINE_END,
      "cmd-right-line-end",
      "cmd-right-swallow",
    );
  }

  // Cmd+↑ / ↓ — buffer start / end (Warp cmd-up/down / VS Code document nav).
  if (isArrowUp(event) && !shift) {
    return writeOrSwallow(
      type,
      SEQ_BUFFER_START,
      "cmd-up-buffer-start",
      "cmd-up-swallow",
    );
  }
  if (isArrowDown(event) && !shift) {
    return writeOrSwallow(
      type,
      SEQ_BUFFER_END,
      "cmd-down-buffer-end",
      "cmd-down-swallow",
    );
  }

  return null;
}

/**
 * @deprecated Use resolveGrokHostKey — kept for tests that only assert write sequences.
 * @param {object} event
 * @returns {{ sequence: string, reason: string } | null}
 */
function encodeModifiedEnterForGrok(event) {
  const r = resolveGrokHostKey(event);
  if (!r || r.action !== "write") return null;
  if (
    r.reason === "shift-enter-newline" ||
    r.reason === "ctrl-enter-interject"
  ) {
    return { sequence: r.sequence, reason: r.reason };
  }
  return null;
}

/** @deprecated alias */
function resolveModifiedEnterForGrok(event) {
  const r = resolveGrokHostKey(event);
  if (!r) return null;
  if (
    r.reason.startsWith("shift-enter") ||
    r.reason.startsWith("ctrl-enter")
  ) {
    return r;
  }
  return null;
}

module.exports = {
  resolveGrokHostKey,
  resolveModifiedEnterForGrok,
  encodeModifiedEnterForGrok,
  KITTY_MOD_SUPER,
  KITTY_KEY_A,
  KITTY_KEY_BACKSPACE,
  SEQ_LINE_START,
  SEQ_LINE_END,
  SEQ_BUFFER_START,
  SEQ_BUFFER_END,
  SEQ_WORD_DELETE_FORWARD,
  SEQ_CLEAR_CURRENT_LINE,
};
