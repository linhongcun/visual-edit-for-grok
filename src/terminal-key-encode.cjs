/**
 * Encode modified Enter keys for Grok TUI hosted in xterm.js.
 *
 * Root cause (Grok docs / xterm Keyboard.ts):
 * - Plain Enter and Shift+Enter both become bare CR (`\r`) in stock xterm.js
 * - Grok needs a distinct sequence for newline (Shift+Enter / Alt+Enter)
 * - Alt+Enter is already sent as ESC+CR by xterm and works for newline
 *
 * Critical xterm detail: if attachCustomKeyEventHandler returns false on
 * keydown without setting xterm's internal _keyDownHandled, the subsequent
 * keypress still runs and emits bare CR — so Shift+Enter becomes
 * ESC+CR (our write) + CR (keypress) and Grok treats it as send.
 * Therefore we must also swallow keypress/keyup for the same chords.
 *
 * @see ~/.grok/docs/user-guide/21-terminal-support.md
 */

/**
 * @typedef {{ action: "write", sequence: string, reason: string }
 *   | { action: "swallow", reason: string }} ModifiedEnterResult
 */

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
 * @returns {ModifiedEnterResult | null}
 *   Non-null → custom key handler must return false (do not let xterm handle).
 *   action "write" → also write sequence to the PTY once (keydown only).
 *   action "swallow" → block keypress/keyup only (no second write).
 */
function resolveModifiedEnterForGrok(event) {
  if (!event || typeof event !== "object") return null;

  const type = event.type || "keydown";
  const isEnter =
    event.key === "Enter" ||
    event.keyCode === 13 ||
    event.key === "NumpadEnter";
  if (!isEnter) return null;

  const shift = Boolean(event.shiftKey);
  const alt = Boolean(event.altKey);
  const ctrl = Boolean(event.ctrlKey);
  const meta = Boolean(event.metaKey);

  // Shift+Enter alone → newline for Grok (ESC+CR, same as stock Alt+Enter)
  if (shift && !alt && !ctrl && !meta) {
    if (type === "keydown") {
      return {
        action: "write",
        sequence: "\x1b\r",
        reason: "shift-enter-newline",
      };
    }
    // keypress/keyup: must not fall through to bare CR
    return { action: "swallow", reason: "shift-enter-swallow" };
  }

  // Ctrl+Enter alone → interject (Kitty CSI-u Enter+Ctrl, modifier 5)
  if (ctrl && !shift && !alt && !meta) {
    if (type === "keydown") {
      return {
        action: "write",
        sequence: "\x1b[13;5u",
        reason: "ctrl-enter-interject",
      };
    }
    return { action: "swallow", reason: "ctrl-enter-swallow" };
  }

  // Alt+Enter — stock xterm already emits ESC+CR; leave alone
  return null;
}

/**
 * Back-compat helper used by older call sites / tests that only care about
 * the write sequence on keydown.
 * @param {object} event
 * @returns {{ sequence: string, reason: string } | null}
 */
function encodeModifiedEnterForGrok(event) {
  const r = resolveModifiedEnterForGrok(event);
  if (!r || r.action !== "write") return null;
  return { sequence: r.sequence, reason: r.reason };
}

module.exports = {
  resolveModifiedEnterForGrok,
  encodeModifiedEnterForGrok,
};
