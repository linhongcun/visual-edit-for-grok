/**
 * Pure per-terminal capture/workspace state.
 *
 * The important invariant is that a capture freezes its destination before any
 * asynchronous screenshot or clipboard work starts. Later active-tab changes
 * never redirect that frozen target.
 *
 * This module stores screenshot paths and serializable metadata only. It never
 * reads screenshot files and intentionally has no logging surface.
 */

const CAPTURE_COORDINATOR_VERSION = 1;
const DEFAULT_VIEWPORT_PRESET = "fit";
const { sanitizeHistoryUrl } = require("./privacy-policy.cjs");
const { sanitizeAttributes } = require("./clipboard-payload.cjs");

const OMITTED_CONTENT_KEYS = new Set([
  "buffer",
  "bytes",
  "dataurl",
  "imagedata",
  "rawimage",
  "thumbnaildata",
  "outerhtml",
]);

function hasOwn(value, key) {
  return Object.prototype.hasOwnProperty.call(value || {}, key);
}

/**
 * Clone JSON-like metadata without retaining binary/image payloads or cycles.
 * Screenshot paths remain ordinary strings; data-image URLs do not.
 *
 * @param {unknown} value
 * @param {WeakSet<object>} [seen]
 * @returns {unknown}
 */
function sanitizeSerializable(value, seen = new WeakSet()) {
  if (value == null) return value;
  if (typeof value === "string") {
    return /^data:image\//i.test(value) ? undefined : value;
  }
  if (typeof value === "number" || typeof value === "boolean") return value;
  if (["bigint", "function", "symbol", "undefined"].includes(typeof value)) {
    return undefined;
  }
  if (
    (typeof Buffer !== "undefined" && Buffer.isBuffer(value)) ||
    value instanceof ArrayBuffer ||
    ArrayBuffer.isView(value)
  ) {
    return undefined;
  }
  if (value instanceof Date) return value.toISOString();
  if (typeof value !== "object") return undefined;
  if (seen.has(value)) return undefined;
  seen.add(value);

  if (Array.isArray(value)) {
    const out = [];
    for (const item of value) {
      const safe = sanitizeSerializable(item, seen);
      if (safe !== undefined) out.push(safe);
    }
    seen.delete(value);
    return out;
  }

  const out = {};
  for (const [key, item] of Object.entries(value)) {
    const lower = key.toLowerCase();
    if (
      OMITTED_CONTENT_KEYS.has(lower) ||
      key === "__proto__" ||
      key === "constructor" ||
      key === "prototype"
    ) {
      continue;
    }
    const safe =
      typeof item === "string" && lower.endsWith("url")
        ? sanitizeHistoryUrl(item) ?? undefined
        : sanitizeSerializable(item, seen);
    if (safe !== undefined) out[key] = safe;
  }
  seen.delete(value);
  return out;
}

function safeObject(value) {
  const safe = sanitizeSerializable(value);
  return safe && typeof safe === "object" && !Array.isArray(safe) ? safe : null;
}

function normalizeSelection(value) {
  const selection = safeObject(value);
  if (!selection) return null;
  if (selection.attributes && typeof selection.attributes === "object") {
    selection.attributes = Object.fromEntries(
      sanitizeAttributes(selection.attributes, 32).map((row) => [
        row.name,
        row.value,
      ]),
    );
  }
  return selection;
}

function normalizePreviewUrl(value) {
  if (typeof value !== "string" || !value.trim()) return "";
  const trimmed = value.trim();
  try {
    const parsed = new URL(trimmed);
    return ["http:", "https:"].includes(parsed.protocol) ? parsed.href : "";
  } catch {
    return "";
  }
}

function normalizeViewportPreset(value) {
  if (typeof value !== "string" || !value.trim()) {
    return DEFAULT_VIEWPORT_PRESET;
  }
  return value.trim().slice(0, 64);
}

function normalizeViewportOrientation(value) {
  return value === "landscape" ? "landscape" : "portrait";
}

function normalizeScreenshotPath(value) {
  return typeof value === "string" && value.trim() ? value.trim() : null;
}

/**
 * @param {unknown} raw
 * @returns {{ selection: object | null, screenshotPath: string | null, captureMeta: object | null } | null}
 */
function normalizeCaptureReference(raw) {
  if (!raw || typeof raw !== "object") return null;
  const row = raw;
  const selection = normalizeSelection(
    hasOwn(row, "selection") ? row.selection : row.lastSelection,
  );
  const screenshotPath = normalizeScreenshotPath(
    hasOwn(row, "screenshotPath")
      ? row.screenshotPath
      : row.lastScreenshotPath,
  );
  const captureMeta = safeObject(
    hasOwn(row, "captureMeta") ? row.captureMeta : row.lastCaptureMeta,
  );
  if (!selection && !screenshotPath && !captureMeta) return null;
  return { selection, screenshotPath, captureMeta };
}

function normalizeVerifyPair(raw) {
  if (!raw || typeof raw !== "object") return null;
  const before = normalizeCaptureReference(raw.before);
  const after = normalizeCaptureReference(raw.after);
  if (!before && !after) return null;
  return {
    before,
    after,
    comparison: safeObject(raw.comparison),
    verifiedAt:
      typeof raw.verifiedAt === "number" && Number.isFinite(raw.verifiedAt)
        ? raw.verifiedAt
        : 0,
    targetSessionId:
      typeof raw.targetSessionId === "string" ? raw.targetSessionId : "",
    targetCwd: typeof raw.targetCwd === "string" ? raw.targetCwd : "",
    targetLabel: typeof raw.targetLabel === "string" ? raw.targetLabel : "",
  };
}

/**
 * Workspace fields shared by terminal persistence and the coordinator.
 * @param {unknown} raw
 */
function normalizeSessionWorkspaceFields(raw = {}) {
  const row = raw && typeof raw === "object" ? raw : {};
  return {
    previewUrl: normalizePreviewUrl(row.previewUrl),
    viewportPreset: normalizeViewportPreset(row.viewportPreset),
    viewportOrientation: normalizeViewportOrientation(row.viewportOrientation),
    lastSelection: normalizeSelection(row.lastSelection),
    lastScreenshotPath: normalizeScreenshotPath(row.lastScreenshotPath),
    lastCaptureMeta: safeObject(row.lastCaptureMeta),
    verifyPair: normalizeVerifyPair(row.verifyPair),
  };
}

function normalizeSessionRecord(raw) {
  if (!raw || typeof raw !== "object") return null;
  const id = typeof raw.id === "string" ? raw.id.trim() : "";
  if (!id) return null;
  const cwd = typeof raw.cwd === "string" ? raw.cwd : "";
  const label =
    typeof raw.label === "string" && raw.label.trim()
      ? raw.label.trim()
      : "Terminal";
  const createdAt =
    typeof raw.createdAt === "number" && Number.isFinite(raw.createdAt)
      ? raw.createdAt
      : 0;
  return {
    id,
    cwd,
    label,
    createdAt,
    ...normalizeSessionWorkspaceFields(raw),
  };
}

/**
 * @param {{ sessions?: unknown[], terminalSessions?: unknown[], activeSessionId?: string, activeTerminalId?: string }} [raw]
 */
function createCoordinatorState(raw = {}) {
  const source = Array.isArray(raw.sessions)
    ? raw.sessions
    : Array.isArray(raw.terminalSessions)
      ? raw.terminalSessions
      : [];
  const sessions = [];
  const seen = new Set();
  for (const item of source) {
    const session = normalizeSessionRecord(item);
    if (!session || seen.has(session.id)) continue;
    seen.add(session.id);
    sessions.push(session);
  }
  const requestedActive =
    typeof raw.activeSessionId === "string"
      ? raw.activeSessionId
      : typeof raw.activeTerminalId === "string"
        ? raw.activeTerminalId
        : "";
  const activeSessionId = sessions.some((item) => item.id === requestedActive)
    ? requestedActive
    : sessions[0]?.id || null;
  return {
    version: CAPTURE_COORDINATOR_VERSION,
    activeSessionId,
    sessions,
  };
}

function getInternalSession(state, sessionId) {
  return state.sessions.find((item) => item.id === sessionId) || null;
}

/** Return a detached session snapshot so callers cannot mutate coordinator state. */
function getSessionState(state, sessionId) {
  const normalized = createCoordinatorState(state);
  const id = sessionId || normalized.activeSessionId;
  const session = id ? getInternalSession(normalized, id) : null;
  return session ? normalizeSessionRecord(session) : null;
}

function replaceSession(state, nextSession) {
  return {
    ...state,
    sessions: state.sessions.map((item) =>
      item.id === nextSession.id ? nextSession : item,
    ),
  };
}

/**
 * Switch visible state only. Any already-frozen capture keeps its own target.
 */
function switchActiveSession(state, sessionId) {
  const normalized = createCoordinatorState(state);
  if (!getInternalSession(normalized, sessionId)) {
    throw new RangeError(`Unknown terminal session: ${sessionId}`);
  }
  return { ...normalized, activeSessionId: sessionId };
}

/** Add or update a terminal session without disturbing other session receipts. */
function upsertSession(state, rawSession) {
  const normalized = createCoordinatorState(state);
  const incoming = normalizeSessionRecord(rawSession);
  if (!incoming) throw new TypeError("A terminal session id is required");
  const prior = getInternalSession(normalized, incoming.id);
  if (!prior) {
    return {
      ...normalized,
      activeSessionId: normalized.activeSessionId || incoming.id,
      sessions: [...normalized.sessions, incoming],
    };
  }
  const merged = normalizeSessionRecord({ ...prior, ...rawSession });
  return replaceSession(normalized, merged);
}

function updateSessionWorkspace(state, sessionId, patch = {}) {
  const normalized = createCoordinatorState(state);
  const prior = getInternalSession(normalized, sessionId);
  if (!prior) throw new RangeError(`Unknown terminal session: ${sessionId}`);
  const merged = normalizeSessionRecord({ ...prior, ...patch, id: prior.id });
  return replaceSession(normalized, merged);
}

/**
 * Freeze the routing identity before asynchronous capture work begins.
 * @returns {Readonly<{ targetSessionId: string, cwd: string, label: string, previewUrl: string, viewportPreset: string, captureId: string, startedAt: number }>}
 */
function freezeCaptureTarget(state, options = {}) {
  const normalized = createCoordinatorState(state);
  const targetSessionId = options.sessionId || normalized.activeSessionId;
  const session = targetSessionId
    ? getInternalSession(normalized, targetSessionId)
    : null;
  if (!session) throw new RangeError("No target terminal session is available");
  return Object.freeze({
    targetSessionId: session.id,
    cwd: session.cwd,
    label: session.label,
    previewUrl: session.previewUrl,
    viewportPreset: session.viewportPreset,
    viewportOrientation: session.viewportOrientation,
    captureId:
      typeof options.captureId === "string" ? options.captureId.trim() : "",
    startedAt:
      typeof options.startedAt === "number" && Number.isFinite(options.startedAt)
        ? options.startedAt
        : 0,
  });
}

/**
 * Resolve only the frozen id. Never falls back to the currently active tab.
 */
function resolveCaptureRoute(state, target) {
  const normalized = createCoordinatorState(state);
  const targetSessionId =
    target && typeof target.targetSessionId === "string"
      ? target.targetSessionId
      : "";
  const current = targetSessionId
    ? getInternalSession(normalized, targetSessionId)
    : null;
  if (!current) {
    return {
      ok: false,
      reason: "target-session-missing",
      targetSessionId,
    };
  }
  const cwd = typeof target.cwd === "string" ? target.cwd : current.cwd;
  const label = typeof target.label === "string" ? target.label : current.label;
  return {
    ok: true,
    reason: null,
    targetSessionId,
    cwd,
    label,
    currentCwd: current.cwd,
    currentLabel: current.label,
    contextChanged: current.cwd !== cwd || current.label !== label,
  };
}

function captureMetaForTarget(target, captureMeta, screenshotPath) {
  const safeMeta = safeObject(captureMeta) || {};
  return {
    ...safeMeta,
    ...(screenshotPath && !safeMeta.screenshotPath ? { screenshotPath } : {}),
    targetSessionId: target.targetSessionId,
    targetCwd: target.cwd,
    targetLabel: target.label,
  };
}

/** Commit a completed capture to its frozen session, regardless of active tab. */
function commitCapture(state, target, capture = {}) {
  const normalized = createCoordinatorState(state);
  const route = resolveCaptureRoute(normalized, target);
  if (!route.ok) {
    throw new RangeError(`Capture target no longer exists: ${route.targetSessionId}`);
  }
  if (route.contextChanged) {
    throw new RangeError(`Capture target workspace changed: ${route.targetSessionId}`);
  }
  const prior = getInternalSession(normalized, route.targetSessionId);
  const selectionValue = hasOwn(capture, "selection")
    ? capture.selection
    : hasOwn(capture, "lastSelection")
      ? capture.lastSelection
      : prior.lastSelection;
  const pathValue = hasOwn(capture, "screenshotPath")
    ? capture.screenshotPath
    : hasOwn(capture, "lastScreenshotPath")
      ? capture.lastScreenshotPath
      : prior.lastScreenshotPath;
  const metaValue = hasOwn(capture, "captureMeta")
    ? capture.captureMeta
    : hasOwn(capture, "lastCaptureMeta")
      ? capture.lastCaptureMeta
      : prior.lastCaptureMeta;
  const screenshotPath = normalizeScreenshotPath(pathValue);
  const next = normalizeSessionRecord({
    ...prior,
    previewUrl: hasOwn(capture, "previewUrl")
      ? capture.previewUrl
      : prior.previewUrl,
    viewportPreset: hasOwn(capture, "viewportPreset")
      ? capture.viewportPreset
      : prior.viewportPreset,
    viewportOrientation: hasOwn(capture, "viewportOrientation")
      ? capture.viewportOrientation
      : prior.viewportOrientation,
    lastSelection: selectionValue,
    lastScreenshotPath: screenshotPath,
    lastCaptureMeta: captureMetaForTarget(target, metaValue, screenshotPath),
    // A new independent capture becomes a new baseline. Verification can be
    // committed explicitly once both before/after references are coherent.
    verifyPair: capture.preserveVerifyPair ? prior.verifyPair : null,
  });
  return replaceSession(normalized, next);
}

/** Store a before/after verification pair on the frozen session only. */
function commitVerifyPair(state, target, pair = {}) {
  const normalized = createCoordinatorState(state);
  const route = resolveCaptureRoute(normalized, target);
  if (!route.ok) {
    throw new RangeError(`Verification target no longer exists: ${route.targetSessionId}`);
  }
  if (route.contextChanged) {
    throw new RangeError(`Verification target workspace changed: ${route.targetSessionId}`);
  }
  const prior = getInternalSession(normalized, route.targetSessionId);
  const verifyPair = normalizeVerifyPair({
    before: pair.before,
    after: pair.after,
    comparison: pair.comparison,
    verifiedAt: pair.verifiedAt,
    targetSessionId: target.targetSessionId,
    targetCwd: target.cwd,
    targetLabel: target.label,
  });
  if (!verifyPair) {
    throw new TypeError("Verification requires a before or after capture reference");
  }
  return replaceSession(
    normalized,
    normalizeSessionRecord({ ...prior, verifyPair }),
  );
}

function clearSessionCapture(state, sessionId) {
  const normalized = createCoordinatorState(state);
  const prior = getInternalSession(normalized, sessionId);
  if (!prior) throw new RangeError(`Unknown terminal session: ${sessionId}`);
  return replaceSession(
    normalized,
    normalizeSessionRecord({
      ...prior,
      lastSelection: null,
      lastScreenshotPath: null,
      lastCaptureMeta: null,
      verifyPair: null,
    }),
  );
}

function serializeCoordinatorState(state) {
  const normalized = createCoordinatorState(state);
  return {
    version: CAPTURE_COORDINATOR_VERSION,
    activeSessionId: normalized.activeSessionId,
    sessions: normalized.sessions.map((session) => normalizeSessionRecord(session)),
  };
}

function restoreCoordinatorState(raw) {
  return createCoordinatorState(raw);
}

module.exports = {
  CAPTURE_COORDINATOR_VERSION,
  DEFAULT_VIEWPORT_PRESET,
  sanitizeSerializable,
  normalizeCaptureReference,
  normalizeVerifyPair,
  normalizeSessionWorkspaceFields,
  createCoordinatorState,
  restoreCoordinatorState,
  serializeCoordinatorState,
  getSessionState,
  switchActiveSession,
  upsertSession,
  updateSessionWorkspace,
  freezeCaptureTarget,
  resolveCaptureRoute,
  commitCapture,
  commitVerifyPair,
  clearSessionCapture,
};
