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
 * Cmd+Backspace / Cmd+Delete → Super+A then DEL (clear whole prompt buffer)
 *
 * Always swallow keypress/keyup after a keydown write so xterm cannot emit a
 * second bare character (see v0.7.8 Shift+Enter fix).
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
      if (type === "keydown") {
        return {
          action: "write",
          sequence: "\x1b\r",
          reason: "shift-enter-newline",
        };
      }
      return { action: "swallow", reason: "shift-enter-swallow" };
    }
    // Ctrl+Enter alone → interject
    if (ctrl && !shift && !alt) {
      if (type === "keydown") {
        return {
          action: "write",
          sequence: "\x1b[13;5u",
          reason: "ctrl-enter-interject",
        };
      }
      return { action: "swallow", reason: "ctrl-enter-swallow" };
    }
    // Alt+Enter / plain Enter — leave to xterm
    return null;
  }

  // --- macOS Meta (Cmd) edit chords ---
  // Only pure Cmd (no ctrl/alt) so we don't fight real app shortcuts.
  if (!meta || ctrl || alt) return null;

  // Cmd+A → select all (Kitty Super+A). Needs Grok Ghostty-class detection;
  // our PTY env sets TERM_PROGRAM=ghostty for this.
  if (isLetterA(event) && !shift) {
    if (type === "keydown") {
      return {
        action: "write",
        sequence: `\x1b[${KITTY_KEY_A};${KITTY_MOD_SUPER}u`,
        reason: "cmd-a-select-all",
      };
    }
    return { action: "swallow", reason: "cmd-a-swallow" };
  }

  // Cmd+Backspace / Cmd+Delete → select all + delete (clear entire prompt line/buffer)
  // macOS users expect this to wipe the current field/line; Grok has no separate
  // "kill line" chord documented, so select-all + DEL matches whole-line clear.
  if ((isBackspaceKey(event) || isForwardDeleteKey(event)) && !shift) {
    if (type === "keydown") {
      return {
        action: "write",
        sequence: `\x1b[${KITTY_KEY_A};${KITTY_MOD_SUPER}u\x7f`,
        reason: "cmd-backspace-clear-line",
      };
    }
    return { action: "swallow", reason: "cmd-backspace-swallow" };
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
};
