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

module.exports = {
  shouldShowUrlClear,
  filterRecentUrls,
  paletteItemMatches,
  filterPaletteItems,
  resolveEscapeAction,
  resolveFocusedChromeEscape,
  normalizeUrlInputValue,
};
