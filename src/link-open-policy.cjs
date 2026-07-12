/**
 * Terminal link open policy (pure).
 * - Plain click on http(s) → in-app preview
 * - ⌘ (macOS) / Ctrl + click → system default browser
 * - Non-http(s) → none (main openExternal only allows http(s))
 */

/**
 * @param {{ metaKey?: boolean, ctrlKey?: boolean, getModifierState?: (key: string) => boolean } | null | undefined} event
 * @returns {boolean}
 */
function preferSystemBrowserForLinkClick(event) {
  if (!event || typeof event !== "object") return false;
  if (event.metaKey === true || event.ctrlKey === true) return true;
  if (typeof event.getModifierState === "function") {
    try {
      if (
        event.getModifierState("Meta") ||
        event.getModifierState("OS") ||
        event.getModifierState("Control")
      ) {
        return true;
      }
    } catch {
      /* ignore */
    }
  }
  return false;
}

/**
 * @param {string} uri
 * @returns {boolean}
 */
function isHttpUrl(uri) {
  try {
    const parsed = new URL(String(uri || ""));
    return parsed.protocol === "http:" || parsed.protocol === "https:";
  } catch {
    return false;
  }
}

/**
 * @param {string} uri
 * @param {object | null | undefined} event
 * @returns {"preview" | "system" | "none"}
 */
function resolveTerminalLinkTarget(uri, event) {
  if (!isHttpUrl(uri)) return "none";
  return preferSystemBrowserForLinkClick(event) ? "system" : "preview";
}

module.exports = {
  preferSystemBrowserForLinkClick,
  isHttpUrl,
  resolveTerminalLinkTarget,
};
