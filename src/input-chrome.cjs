/**
 * Pure helpers for app-chrome text inputs (URL / find / palette).
 * Warp-inspired keyboard and suggestion behavior — no AGPL code, no Electron.
 */

/**
 * Whether the URL field should show a one-click clear control.
 * @param {unknown} value
 * @returns {boolean}
 */
function shouldShowUrlClear(value) {
  return String(value ?? "").length > 0;
}

/**
 * Filter/rank recent URL history for the preview address field.
 * - Empty query → original order (most recent first), capped
 * - Query → case-insensitive substring match; prefer starts-with, then includes
 * - Drops empty / non-string entries
 *
 * @param {unknown} query
 * @param {unknown} recentUrls
 * @param {{ limit?: number, privateMode?: boolean }} [opts]
 * @returns {string[]}
 */
function filterRecentUrls(query, recentUrls, opts = {}) {
  if (opts.privateMode) return [];
  const limit = Math.max(1, Math.min(20, Number(opts.limit) || 8));
  const list = Array.isArray(recentUrls) ? recentUrls : [];
  const cleaned = [];
  const seen = new Set();
  for (const item of list) {
    if (typeof item !== "string") continue;
    const url = item.trim();
    if (!url || seen.has(url)) continue;
    seen.add(url);
    cleaned.push(url);
  }
  const q = String(query ?? "")
    .trim()
    .toLowerCase();
  if (!q) return cleaned.slice(0, limit);

  /** @type {Array<{ url: string, score: number }>} */
  const scored = [];
  for (const url of cleaned) {
    const lower = url.toLowerCase();
    let score = 0;
    if (lower === q) score = 300;
    else if (lower.startsWith(q)) score = 200;
    else if (lower.includes(q)) score = 100;
    else {
      // Also match host path without scheme for friendlier typing
      try {
        const hostPath = lower.replace(/^https?:\/\//, "");
        if (hostPath.startsWith(q)) score = 180;
        else if (hostPath.includes(q)) score = 90;
      } catch {
        /* ignore */
      }
    }
    if (score > 0) scored.push({ url, score });
  }
  scored.sort((a, b) => b.score - a.score || a.url.localeCompare(b.url));
  return scored.slice(0, limit).map((row) => row.url);
}

/**
 * @param {{ id: string, label: string }} item
 * @param {string} query
 * @returns {boolean}
 */
function paletteItemMatches(item, query) {
  const q = String(query ?? "")
    .trim()
    .toLowerCase();
  if (!q) return true;
  const label = String(item?.label || "").toLowerCase();
  const id = String(item?.id || "").toLowerCase();
  return label.includes(q) || id.includes(q);
}

/**
 * Filter palette command rows by query (substring on label or id).
 * @param {unknown} query
 * @param {Array<{ id: string, label: string }>} items
 * @returns {Array<{ id: string, label: string }>}
 */
function filterPaletteItems(query, items) {
  const list = Array.isArray(items) ? items : [];
  return list.filter((item) => item && paletteItemMatches(item, query));
}

/**
 * Resolve what Escape should do given stacked chrome surfaces.
 * Order: Aim pick → find → palette → settings/shortcuts → URL blur → none
 *
 * @param {{
 *   pickMode?: boolean,
 *   findOpen?: boolean,
 *   paletteOpen?: boolean,
 *   settingsOpen?: boolean,
 *   shortcutsOpen?: boolean,
 *   urlFocused?: boolean,
 * }} state
 * @returns {"aim-cancel"|"close-find"|"close-palette"|"close-settings"|"close-shortcuts"|"blur-url"|"none"}
 */
function resolveEscapeAction(state = {}) {
  if (state.pickMode) return "aim-cancel";
  if (state.findOpen) return "close-find";
  if (state.paletteOpen) return "close-palette";
  if (state.settingsOpen) return "close-settings";
  if (state.shortcutsOpen) return "close-shortcuts";
  if (state.urlFocused) return "blur-url";
  return "none";
}

/**
 * Normalize a pasted/typed URL-ish string for the address field (trim only).
 * Does not invent schemes — openPreviewUrl still owns navigation validation.
 * @param {unknown} value
 * @returns {string}
 */
function normalizeUrlInputValue(value) {
  return String(value ?? "").trim();
}

/**
 * Esc action for a chrome surface that currently has keyboard focus.
 * Local handlers MUST call this so Aim pickMode always wins over close/blur.
 *
 * @param {"url"|"find"|"palette"|"settings"|"shortcuts"} surface
 * @param {boolean} [pickMode]
 * @returns {ReturnType<typeof resolveEscapeAction>}
 */
function resolveFocusedChromeEscape(surface, pickMode = false) {
  return resolveEscapeAction({
    pickMode: Boolean(pickMode),
    findOpen: surface === "find",
    paletteOpen: surface === "palette",
    settingsOpen: surface === "settings",
    shortcutsOpen: surface === "shortcuts",
    urlFocused: surface === "url",
  });
}

/**
 * Normalize a keyboard event-like object for pure policy helpers.
 * @param {{ key?: string, shiftKey?: boolean, metaKey?: boolean, ctrlKey?: boolean, altKey?: boolean } | null | undefined} event
 * @returns {{ key: string, shiftKey: boolean, metaKey: boolean, ctrlKey: boolean, altKey: boolean }}
 */
function normalizeKeyEvent(event) {
  const e = event && typeof event === "object" ? event : {};
  return {
    key: String(e.key || ""),
    shiftKey: Boolean(e.shiftKey),
    metaKey: Boolean(e.metaKey),
    ctrlKey: Boolean(e.ctrlKey),
    altKey: Boolean(e.altKey),
  };
}

/**
 * Preview URL field keyboard contract (single-line address bar).
 * - Enter → submit navigation
 * - Shift+Enter → none (do not invent multi-line URLs; Warp newline is for multiline editors)
 *
 * @param {{ key?: string, shiftKey?: boolean }} event
 * @returns {"submit"|"none"}
 */
function resolveUrlKeyAction(event) {
  const { key, shiftKey, metaKey, ctrlKey, altKey } = normalizeKeyEvent(event);
  if (metaKey || ctrlKey || altKey) return "none";
  if (key !== "Enter") return "none";
  if (shiftKey) return "none";
  return "submit";
}

/**
 * Find-in-terminal keyboard contract (search navigation, not multiline insert).
 * - Enter → next match
 * - Shift+Enter → previous match
 * (Warp Shift+Enter newline maps here to “secondary direction”, not a newline.)
 *
 * @param {{ key?: string, shiftKey?: boolean }} event
 * @returns {"find-next"|"find-prev"|"none"}
 */
function resolveFindKeyAction(event) {
  const { key, shiftKey, metaKey, ctrlKey, altKey } = normalizeKeyEvent(event);
  if (metaKey || ctrlKey || altKey) return "none";
  if (key !== "Enter") return "none";
  return shiftKey ? "find-prev" : "find-next";
}

/**
 * Clamp palette highlight index into [0, itemCount) or -1 when empty.
 * @param {unknown} index
 * @param {unknown} itemCount
 * @returns {number}
 */
function clampPaletteIndex(index, itemCount) {
  const n = Math.max(0, Math.floor(Number(itemCount) || 0));
  if (n <= 0) return -1;
  let i = Math.floor(Number(index));
  if (!Number.isFinite(i)) i = 0;
  if (i < 0) return 0;
  if (i >= n) return n - 1;
  return i;
}

/**
 * Move palette highlight.
 * @param {unknown} index current highlight (-1 or 0..n-1)
 * @param {unknown} itemCount
 * @param {"up"|"down"} direction
 * @returns {number}
 */
function movePaletteIndex(index, itemCount, direction) {
  const n = Math.max(0, Math.floor(Number(itemCount) || 0));
  if (n <= 0) return -1;
  let i = Math.floor(Number(index));
  if (!Number.isFinite(i) || i < 0) {
    // From no selection: down → 0, up → last
    return direction === "up" ? n - 1 : 0;
  }
  if (direction === "up") return i <= 0 ? n - 1 : i - 1;
  return i >= n - 1 ? 0 : i + 1;
}

/**
 * Command palette keyboard contract.
 * - ArrowUp/Down → move highlight (wrap)
 * - Enter → run highlighted item (or first if none and list non-empty)
 * - Shift+Enter → none (no multiline; list accept is plain Enter)
 *
 * @param {{ key?: string, shiftKey?: boolean, metaKey?: boolean, ctrlKey?: boolean, altKey?: boolean }} event
 * @param {{ index?: number, itemCount?: number }} [state]
 * @returns {{ type: "none"|"move"|"run", index?: number }}
 */
function resolvePaletteKeyAction(event, state = {}) {
  const { key, shiftKey, metaKey, ctrlKey, altKey } = normalizeKeyEvent(event);
  if (metaKey || ctrlKey || altKey) return { type: "none" };
  const count = Math.max(0, Math.floor(Number(state.itemCount) || 0));
  const index = clampPaletteIndex(state.index, count);

  if (key === "ArrowDown") {
    if (count <= 0) return { type: "none" };
    return { type: "move", index: movePaletteIndex(index, count, "down") };
  }
  if (key === "ArrowUp") {
    if (count <= 0) return { type: "none" };
    return { type: "move", index: movePaletteIndex(index, count, "up") };
  }
  if (key === "Enter") {
    if (shiftKey) return { type: "none" };
    if (count <= 0) return { type: "none" };
    const runIndex = index >= 0 ? index : 0;
    return { type: "run", index: clampPaletteIndex(runIndex, count) };
  }
  return { type: "none" };
}

module.exports = {
  shouldShowUrlClear,
  filterRecentUrls,
  paletteItemMatches,
  filterPaletteItems,
  resolveEscapeAction,
  resolveFocusedChromeEscape,
  normalizeUrlInputValue,
  normalizeKeyEvent,
  resolveUrlKeyAction,
  resolveFindKeyAction,
  clampPaletteIndex,
  movePaletteIndex,
  resolvePaletteKeyAction,
};
