/**
 * Pure multi-terminal session registry (metadata + active routing).
 * PTY instances live in main; this module owns ids, labels, caps, and lists.
 */
const path = require("path");
const {
  normalizeSessionWorkspaceFields,
} = require("./capture-coordinator.cjs");

const MAX_TERMINAL_SESSIONS = 6;

/**
 * @param {string} [cwd]
 * @returns {string}
 */
function labelFromCwd(cwd) {
  if (typeof cwd !== "string" || !cwd.trim()) return "Terminal";
  const trimmed = cwd.trim();
  try {
    const base = path.basename(trimmed);
    return base || trimmed;
  } catch {
    return trimmed;
  }
}

/**
 * @returns {string}
 */
function makeSessionId() {
  return `term-${Date.now().toString(36)}-${Math.random().toString(36).slice(2, 8)}`;
}

/**
 * @param {{ id?: string, cwd?: string, label?: string, createdAt?: number, previewUrl?: string, viewportPreset?: string, viewportOrientation?: string, lastSelection?: object | null, lastScreenshotPath?: string | null, lastCaptureMeta?: object | null, verifyPair?: object | null }} [opts]
 */
function createSessionMeta(opts = {}) {
  const cwd = typeof opts.cwd === "string" ? opts.cwd : "";
  const id =
    typeof opts.id === "string" && opts.id.trim()
      ? opts.id.trim()
      : makeSessionId();
  const label =
    typeof opts.label === "string" && opts.label.trim()
      ? opts.label.trim()
      : labelFromCwd(cwd);
  const createdAt =
    typeof opts.createdAt === "number" && Number.isFinite(opts.createdAt)
      ? opts.createdAt
      : Date.now();
  return {
    id,
    cwd,
    label,
    createdAt,
    ...normalizeSessionWorkspaceFields(opts),
  };
}

/**
 * @param {number} count
 * @param {number} [max]
 * @returns {{ ok: boolean, reason: string | null }}
 */
function canCreateSession(count, max = MAX_TERMINAL_SESSIONS) {
  const n = Number(count) || 0;
  const cap = Math.max(1, Number(max) || MAX_TERMINAL_SESSIONS);
  if (n >= cap) {
    return { ok: false, reason: "max-sessions" };
  }
  return { ok: true, reason: null };
}

/**
 * Pick next active id after closing `closingId`.
 * @param {string[]} orderedIds
 * @param {string | null | undefined} activeId
 * @param {string} closingId
 * @returns {string | null}
 */
function nextActiveAfterClose(orderedIds, activeId, closingId) {
  const ids = (orderedIds || []).filter((id) => id && id !== closingId);
  if (ids.length === 0) return null;
  if (activeId && activeId !== closingId && ids.includes(activeId)) {
    return activeId;
  }
  const idx = (orderedIds || []).indexOf(closingId);
  if (idx > 0 && orderedIds[idx - 1] && orderedIds[idx - 1] !== closingId) {
    const prev = orderedIds[idx - 1];
    if (ids.includes(prev)) return prev;
  }
  if (idx >= 0 && idx < (orderedIds || []).length - 1) {
    const next = orderedIds[idx + 1];
    if (next && next !== closingId && ids.includes(next)) return next;
  }
  return ids[ids.length - 1] || null;
}

/**
 * Normalize persisted session list.
 * @param {unknown} raw
 * @param {string} [fallbackCwd]
 * @returns {{ sessions: Array<{ id: string, cwd: string, label: string, createdAt: number }>, activeId: string | null }}
 */
function normalizeSessionList(raw, fallbackCwd = "") {
  const list = Array.isArray(raw) ? raw : [];
  const sessions = [];
  const seen = new Set();
  for (const item of list) {
    if (!item || typeof item !== "object") continue;
    const o = /** @type {Record<string, unknown>} */ (item);
    const cwd = typeof o.cwd === "string" ? o.cwd : fallbackCwd;
    const meta = createSessionMeta({
      id: typeof o.id === "string" ? o.id : undefined,
      cwd,
      label: typeof o.label === "string" ? o.label : undefined,
      createdAt: typeof o.createdAt === "number" ? o.createdAt : undefined,
      previewUrl: o.previewUrl,
      viewportPreset: o.viewportPreset,
      viewportOrientation: o.viewportOrientation,
      lastSelection: o.lastSelection,
      lastScreenshotPath: o.lastScreenshotPath,
      lastCaptureMeta: o.lastCaptureMeta,
      verifyPair: o.verifyPair,
    });
    if (seen.has(meta.id)) continue;
    seen.add(meta.id);
    sessions.push(meta);
    if (sessions.length >= MAX_TERMINAL_SESSIONS) break;
  }
  if (sessions.length === 0) {
    const one = createSessionMeta({ cwd: fallbackCwd });
    return { sessions: [one], activeId: one.id };
  }
  return { sessions, activeId: sessions[0].id };
}

/**
 * Parent/base path segments for disambiguation (no path module for renderer parity).
 * @param {string} cwd
 * @returns {string[]}
 */
function pathSegments(cwd) {
  if (typeof cwd !== "string" || !cwd.trim()) return [];
  return cwd.trim().split(/[/\\]+/).filter(Boolean);
}

/**
 * Display label for one tab given the full list (disambiguate same basename).
 * @param {{ id?: string, cwd?: string, label?: string }} tab
 * @param {Array<{ id?: string, cwd?: string, label?: string }>} allTabs
 * @returns {string}
 */
function displayLabelForTab(tab, allTabs) {
  const list = Array.isArray(allTabs) ? allTabs : [];
  const base =
    (typeof tab?.label === "string" && tab.label.trim()) ||
    labelFromCwd(tab?.cwd) ||
    "Terminal";

  const sameBase = list.filter((other) => {
    const otherBase =
      (typeof other?.label === "string" && other.label.trim()) ||
      labelFromCwd(other?.cwd) ||
      "Terminal";
    return otherBase === base;
  });
  if (sameBase.length <= 1) return base;

  const segs = pathSegments(tab?.cwd || "");
  if (segs.length >= 2) {
    const candidate = `${segs[segs.length - 2]}/${segs[segs.length - 1]}`;
    const sameParent = list.filter((other) => {
      const o = pathSegments(other?.cwd || "");
      if (o.length < 2) return false;
      return `${o[o.length - 2]}/${o[o.length - 1]}` === candidate;
    });
    if (sameParent.length <= 1) return candidate;
  }

  const id = typeof tab?.id === "string" ? tab.id : "";
  const short = id.slice(-4) || "tab";
  return `${base} · ${short}`;
}

/**
 * Attach unique `displayLabel` for every session in the list.
 * @param {Array<{ id: string, cwd?: string, label?: string }>} sessions
 * @returns {Array<{ id: string, cwd?: string, label?: string, displayLabel: string }>}
 */
function withDisplayLabels(sessions) {
  const list = Array.isArray(sessions) ? sessions : [];
  return list.map((s) => ({
    ...s,
    displayLabel: displayLabelForTab(s, list),
  }));
}

/**
 * Closing a tab that has Grok running should confirm first.
 * @param {{ grokRunning?: boolean }} tab
 * @returns {boolean}
 */
function shouldConfirmCloseTab(tab = {}) {
  return Boolean(tab.grokRunning);
}

/**
 * Snapshot for renderer / get-state.
 * @param {Array<{ id: string, cwd: string, label: string, createdAt?: number, shellAlive?: boolean, grokRunning?: boolean, mode?: string | null, previewUrl?: string, viewportPreset?: string, lastSelection?: object | null, lastScreenshotPath?: string | null, lastCaptureMeta?: object | null, verifyPair?: object | null }>} sessions
 * @param {string | null} activeId
 */
function sessionsSnapshot(sessions, activeId) {
  const list = Array.isArray(sessions) ? sessions : [];
  const active =
    activeId && list.some((s) => s.id === activeId)
      ? activeId
      : list[0]?.id || null;
  const mapped = withDisplayLabels(
    list.map((s) => ({
      id: s.id,
      cwd: s.cwd || "",
      label: s.label || labelFromCwd(s.cwd),
      createdAt: s.createdAt || 0,
      shellAlive: Boolean(s.shellAlive),
      grokRunning: Boolean(s.grokRunning),
      mode: s.mode || null,
      ...normalizeSessionWorkspaceFields(s),
    })),
  );
  return {
    sessions: mapped,
    activeId: active,
    maxSessions: MAX_TERMINAL_SESSIONS,
  };
}

/**
 * Whether any embedded session is alive (for quit confirm).
 * @param {Array<{ shellAlive?: boolean, grokRunning?: boolean, alive?: boolean }>} sessions
 */
function anySessionAlive(sessions) {
  return (sessions || []).some(
    (s) => s.shellAlive || s.grokRunning || s.alive,
  );
}

module.exports = {
  MAX_TERMINAL_SESSIONS,
  labelFromCwd,
  pathSegments,
  displayLabelForTab,
  withDisplayLabels,
  shouldConfirmCloseTab,
  makeSessionId,
  createSessionMeta,
  canCreateSession,
  nextActiveAfterClose,
  normalizeSessionList,
  sessionsSnapshot,
  anySessionAlive,
};
