/**
 * Pure multi-terminal session registry (metadata + active routing).
 * PTY instances live in main; this module owns ids, labels, caps, and lists.
 */
const path = require("path");

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
 * @param {{ id?: string, cwd?: string, label?: string, createdAt?: number }} [opts]
 * @returns {{ id: string, cwd: string, label: string, createdAt: number }}
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
  return { id, cwd, label, createdAt };
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
 * Snapshot for renderer / get-state.
 * @param {Array<{ id: string, cwd: string, label: string, createdAt?: number, shellAlive?: boolean, grokRunning?: boolean, mode?: string | null }>} sessions
 * @param {string | null} activeId
 */
function sessionsSnapshot(sessions, activeId) {
  const list = Array.isArray(sessions) ? sessions : [];
  const active =
    activeId && list.some((s) => s.id === activeId)
      ? activeId
      : list[0]?.id || null;
  return {
    sessions: list.map((s) => ({
      id: s.id,
      cwd: s.cwd || "",
      label: s.label || labelFromCwd(s.cwd),
      createdAt: s.createdAt || 0,
      shellAlive: Boolean(s.shellAlive),
      grokRunning: Boolean(s.grokRunning),
      mode: s.mode || null,
    })),
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
  makeSessionId,
  createSessionMeta,
  canCreateSession,
  nextActiveAfterClose,
  normalizeSessionList,
  sessionsSnapshot,
  anySessionAlive,
};
