/**
 * Encode modified Enter keys for Grok TUI hosted in xterm.js.
 *
 * Root cause (Grok docs / xterm Keyboard.ts):
 * - Plain Enter and Shift+Enter both become bare CR (`\r`) in stock xterm.js
 * - Grok needs a distinct sequence for newline (Shift+Enter / Alt+Enter)
 * - Alt+Enter is already sent as ESC+CR by xterm and works for newline
 * - We remap Shift+Enter → ESC+CR (same as Alt+Enter) so newline works without
 *   full Kitty keyboard protocol negotiation (xterm.js only partially supports it)
 *
 * Ctrl+Enter (interject mid-turn) is sent as Kitty CSI-u when possible:
 *   ESC [ 13 ; 5 u
 *
 * @see https://sw.kovidgoyal.net/kitty/keyboard-protocol/
 * @see ~/.grok/docs/user-guide/21-terminal-support.md (Shift+Enter on VS Code / xterm.js)
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
 * @returns {{ sequence: string, reason: string } | null}
 *   Non-null when the host should swallow the event and write `sequence` to the PTY.
 */
function encodeModifiedEnterForGrok(event) {
  if (!event || typeof event !== "object") return null;
  // Only act on keydown; keypress/keyup must pass through.
  if (event.type && event.type !== "keydown") return null;

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
    return { sequence: "\x1b\r", reason: "shift-enter-newline" };
  }

  // Ctrl+Enter alone → interject / send-now (Kitty CSI-u Enter+Ctrl)
  // Modifier 5 = Control in Kitty progressive enhancement.
  if (ctrl && !shift && !alt && !meta) {
    return { sequence: "\x1b[13;5u", reason: "ctrl-enter-interject" };
  }

  // Ctrl+Shift+Enter — leave to default / unused
  // Alt+Enter — stock xterm already emits ESC+CR; do not double-handle
  return null;
}

module.exports = {
  encodeModifiedEnterForGrok,
};
