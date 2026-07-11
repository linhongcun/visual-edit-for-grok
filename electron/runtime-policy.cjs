/**
 * Pure runtime policy for capture stability & hot-path efficiency.
 * No I/O — unit-tested with fixtures.
 */

const {
  selectionContentFingerprint,
} = require("./clipboard-payload.cjs");

/** Default min gap between capture-dir cleanups (ms). */
const DEFAULT_CLEANUP_MIN_INTERVAL_MS = 60_000;

/** Default min gap between intermediate settings disk flushes (ms). */
const DEFAULT_SETTINGS_DEBOUNCE_MS = 250;

/**
 * Whether a new capture/deliver may start.
 * @param {{ inFlight?: boolean }} state
 * @returns {{ ok: boolean, reason: string | null, statusMessage: string | null }}
 */
function canStartCapture(state = {}) {
  if (state.inFlight || state.busy) {
    return {
      ok: false,
      reason: "busy",
      statusMessage: "Capture in progress — wait a moment.",
    };
  }
  return { ok: true, reason: null, statusMessage: null };
}

/**
 * Whether UI/keyboard may start Aim toggle, Frame, or Re-send.
 * Same busy single-flight policy as toolbar buttons.
 *
 * @param {{ busy?: boolean, inFlight?: boolean, hasCapture?: boolean, action?: "aim"|"frame"|"resend"|"any" }} state
 * @returns {{ ok: boolean, reason: string | null }}
 */
function mayStartCaptureAction(state = {}) {
  if (state.busy || state.inFlight) {
    return { ok: false, reason: "busy" };
  }
  const action = state.action || "any";
  if (action === "resend" && state.hasCapture === false) {
    return { ok: false, reason: "no-capture" };
  }
  return { ok: true, reason: null };
}

/**
 * Map shell + Grok runtime fields to an honest UI grok state.
 * Never promotes launch-requested / running-process alone to "ready".
 *
 * @param {{
 *   shellAlive?: boolean,
 *   terminalAlive?: boolean,
 *   alive?: boolean,
 *   grokReady?: boolean | null,
 *   grokReadiness?: string,
 *   grokLaunchRequested?: boolean,
 *   grokRunning?: boolean,
 *   grokState?: string,
 *   current?: string,
 * }} input
 * @returns {"idle"|"launching"|"launch-requested"|"ready"|"exited"|"unknown"}
 */
function classifyGrokUiState(input = {}) {
  const shellAlive = Boolean(
    input.shellAlive ?? input.terminalAlive ?? input.alive,
  );
  const raw = String(input.grokState || "").toLowerCase();

  if (
    input.grokReady === true ||
    input.grokReadiness === "ready" ||
    raw === "ready"
  ) {
    return "ready";
  }
  if (raw === "launching") return "launching";
  if (
    input.grokLaunchRequested === true ||
    input.grokRunning === true ||
    raw === "launch-requested" ||
    raw === "requested" ||
    raw === "running"
  ) {
    // Process may be up; readiness still unconfirmed unless grokReady above.
    return "launch-requested";
  }
  if (raw === "exited" || raw === "stopped") return "exited";
  if (raw === "idle" || raw === "not-started") return "idle";
  if (!shellAlive) {
    return input.current === "idle" || !input.current ? "idle" : "exited";
  }
  return "unknown";
}

function firstDefined(...values) {
  return values.find((value) => value !== undefined && value !== null);
}

function hasIdentity(value) {
  return value !== undefined && value !== null && value !== "";
}

/**
 * Strictly validate a selection event emitted by the preview.
 *
 * All three identities are required. The navigation token invalidates events
 * across reloads, navigationId identifies the committed main-frame document,
 * and sourceId prevents another webContents/frame from impersonating it.
 *
 * @param {{
 *   pickMode?: boolean,
 *   inFlight?: boolean,
 *   busy?: boolean,
 *   event?: object,
 *   current?: object,
 *   eventNavigationToken?: string | number,
 *   currentNavigationToken?: string | number,
 *   eventNavigationId?: string | number,
 *   currentNavigationId?: string | number,
 *   eventSourceId?: string | number | object,
 *   currentSourceId?: string | number | object,
 * }} state
 * @returns {{
 *   ok: boolean,
 *   proceed: boolean,
 *   reason: string | null,
 *   statusMessage: string | null,
 *   cancelPickMode: boolean,
 *   clearOverlay: boolean,
 * }}
 */
function validateAimEvent(state = {}) {
  const event = state.event || {};
  const eventContext = event.captureContext || event.context || {};
  const current = state.current || {};

  const eventNavigationToken = firstDefined(
    state.eventNavigationToken,
    event.navigationToken,
    eventContext.navigationToken,
  );
  const currentNavigationToken = firstDefined(
    state.currentNavigationToken,
    current.navigationToken,
  );
  const eventNavigationId = firstDefined(
    state.eventNavigationId,
    event.navigationId,
    eventContext.navigationId,
  );
  const currentNavigationId = firstDefined(
    state.currentNavigationId,
    current.navigationId,
  );
  const eventSourceId = firstDefined(
    state.eventSourceId,
    event.sourceId,
    eventContext.sourceId,
  );
  const currentSourceId = firstDefined(
    state.currentSourceId,
    current.sourceId,
  );

  const reject = (reason, statusMessage, cancelPickMode = true) => ({
    ok: false,
    proceed: false,
    reason,
    statusMessage,
    cancelPickMode,
    clearOverlay: true,
  });

  if (state.pickMode !== true) {
    return reject(
      "aim-inactive",
      "Ignored selection because Aim is not active.",
      false,
    );
  }
  if (state.inFlight || state.busy) {
    return reject("busy", "Capture in progress — wait a moment.");
  }
  if (
    !hasIdentity(eventNavigationToken) ||
    !hasIdentity(currentNavigationToken)
  ) {
    return reject(
      "missing-navigation-token",
      "Ignored selection without a current navigation token.",
    );
  }
  if (!Object.is(eventNavigationToken, currentNavigationToken)) {
    return reject(
      "stale-navigation-token",
      "Ignored selection from a previous page navigation.",
    );
  }
  if (!hasIdentity(eventNavigationId) || !hasIdentity(currentNavigationId)) {
    return reject(
      "missing-navigation-id",
      "Ignored selection without a current navigation id.",
    );
  }
  if (!Object.is(eventNavigationId, currentNavigationId)) {
    return reject(
      "stale-navigation-id",
      "Ignored selection from a previous page document.",
    );
  }
  if (!hasIdentity(eventSourceId) || !hasIdentity(currentSourceId)) {
    return reject(
      "missing-source",
      "Ignored selection without a trusted preview source.",
    );
  }
  if (!Object.is(eventSourceId, currentSourceId)) {
    return reject(
      "source-mismatch",
      "Ignored selection from an untrusted preview source.",
    );
  }

  return {
    ok: true,
    proceed: true,
    reason: null,
    statusMessage: null,
    cancelPickMode: true,
    clearOverlay: false,
  };
}

function normalizeUrl(value) {
  if (typeof value !== "string" || !value.trim()) return null;
  try {
    return new URL(value).href;
  } catch {
    return value.trim();
  }
}

/**
 * Normalize renderer viewport data into a stable, serializable shape.
 * @param {object | null | undefined} viewport
 * @returns {{ width: number, height: number, scrollX: number, scrollY: number, devicePixelRatio?: number } | null}
 */
function normalizeViewport(viewport) {
  if (!viewport || typeof viewport !== "object") return null;
  const dimensions = viewport.viewport || viewport;
  const scroll = viewport.scroll || dimensions.scroll || {};
  const width = Number(
    firstDefined(
      dimensions.width,
      dimensions.innerWidth,
      dimensions.viewportWidth,
    ),
  );
  const height = Number(
    firstDefined(
      dimensions.height,
      dimensions.innerHeight,
      dimensions.viewportHeight,
    ),
  );
  const scrollX = Number(
    firstDefined(
      dimensions.scrollX,
      dimensions.pageXOffset,
      scroll.x,
      scroll.scrollX,
      dimensions.x,
    ),
  );
  const scrollY = Number(
    firstDefined(
      dimensions.scrollY,
      dimensions.pageYOffset,
      scroll.y,
      scroll.scrollY,
      dimensions.y,
    ),
  );
  if (
    !Number.isFinite(width) ||
    !Number.isFinite(height) ||
    !Number.isFinite(scrollX) ||
    !Number.isFinite(scrollY) ||
    width <= 0 ||
    height <= 0
  ) {
    return null;
  }
  const normalized = { width, height, scrollX, scrollY };
  const dpr = Number(
    firstDefined(
      dimensions.devicePixelRatio,
      dimensions.deviceScaleFactor,
      dimensions.dpr,
    ),
  );
  if (Number.isFinite(dpr) && dpr > 0) normalized.devicePixelRatio = dpr;
  return normalized;
}

/**
 * Attach the document identity used by freshness checks without mutating the
 * selection emitted by the picker.
 * @param {object} selection
 * @param {object} context
 * @returns {object}
 */
function stampSelectionContext(selection, context = {}) {
  return {
    ...selection,
    pageUrl: context.pageUrl || selection?.pageUrl || null,
    captureContext: {
      pageUrl: context.pageUrl || selection?.pageUrl || null,
      navigationToken: context.navigationToken,
      navigationId: context.navigationId,
      sourceId: context.sourceId,
      viewport: normalizeViewport(context),
    },
  };
}

function valuesWithinTolerance(left, right, tolerance) {
  return Math.abs(left - right) <= tolerance;
}

/**
 * Compare the main-process identity of a preview before and after async work.
 * A loading document is never stable, even if Electron has not committed the
 * next navigation yet.
 *
 * @param {object | null | undefined} snapshot
 * @param {object | null | undefined} current
 * @returns {boolean}
 */
function samePreviewIdentity(snapshot, current) {
  if (!snapshot || !current || current.loading === true) return false;
  const required = ["webContentsId", "navigationId", "navigationToken", "url"];
  if (required.some((key) => !hasIdentity(snapshot[key]) || !hasIdentity(current[key]))) {
    return false;
  }
  return Boolean(
    Object.is(snapshot.webContentsId, current.webContentsId) &&
      Object.is(snapshot.navigationId, current.navigationId) &&
      Object.is(snapshot.navigationToken, current.navigationToken) &&
      normalizeUrl(snapshot.url) === normalizeUrl(current.url),
  );
}

/**
 * Decide whether DOM coordinates still describe the current preview document.
 * Missing evidence is stale: callers must never guess that old DOM is current.
 *
 * @param {{
 *   selection?: object | null,
 *   current?: object,
 *   currentUrl?: string,
 *   currentNavigationToken?: string | number,
 *   currentNavigationId?: string | number,
 *   currentSourceId?: string | number | object,
 *   currentViewport?: object,
 *   currentScroll?: object,
 *   viewportTolerancePx?: number,
 * }} input
 * @returns {{ fresh: boolean, reason: string | null }}
 */
function evaluateSelectionFreshness(input = {}) {
  const selection = input.selection;
  if (!selection || typeof selection !== "object") {
    return { fresh: false, reason: "no-selection" };
  }

  const saved = selection.captureContext || selection.context || {};
  const current = input.current || {};
  const selectedUrl = normalizeUrl(saved.pageUrl || selection.pageUrl);
  const currentUrl = normalizeUrl(input.currentUrl || current.pageUrl || current.url);
  if (!selectedUrl || !currentUrl) {
    return { fresh: false, reason: "missing-url" };
  }
  if (selectedUrl !== currentUrl) {
    return { fresh: false, reason: "url-changed" };
  }

  const savedNavigationToken = firstDefined(
    saved.navigationToken,
    selection.navigationToken,
  );
  const currentNavigationToken = firstDefined(
    input.currentNavigationToken,
    current.navigationToken,
  );
  const savedNavigationId = firstDefined(
    saved.navigationId,
    selection.navigationId,
  );
  const currentNavigationId = firstDefined(
    input.currentNavigationId,
    current.navigationId,
  );
  const hasTokenPair =
    hasIdentity(savedNavigationToken) && hasIdentity(currentNavigationToken);
  const hasIdPair =
    hasIdentity(savedNavigationId) && hasIdentity(currentNavigationId);

  if (!hasTokenPair && !hasIdPair) {
    return { fresh: false, reason: "missing-navigation" };
  }
  if (
    hasIdentity(savedNavigationToken) !== hasIdentity(currentNavigationToken) ||
    (hasTokenPair && !Object.is(savedNavigationToken, currentNavigationToken))
  ) {
    return { fresh: false, reason: "navigation-changed" };
  }
  if (
    hasIdentity(savedNavigationId) !== hasIdentity(currentNavigationId) ||
    (hasIdPair && !Object.is(savedNavigationId, currentNavigationId))
  ) {
    return { fresh: false, reason: "navigation-changed" };
  }

  const savedSourceId = firstDefined(saved.sourceId, selection.sourceId);
  const currentSourceId = firstDefined(input.currentSourceId, current.sourceId);
  if (
    hasIdentity(savedSourceId) !== hasIdentity(currentSourceId) ||
    (hasIdentity(savedSourceId) && !Object.is(savedSourceId, currentSourceId))
  ) {
    return { fresh: false, reason: "source-changed" };
  }

  const hasSavedViewport = Boolean(
    saved.viewport || saved.scroll || selection.viewport || selection.scroll,
  );
  const savedViewportSource = hasSavedViewport
    ? {
        viewport: saved.viewport || selection.viewport,
        scroll: saved.scroll || selection.scroll,
      }
    : null;
  const hasCurrentViewport = Boolean(
    input.currentViewport ||
      input.currentScroll ||
      current.viewport ||
      current.scroll,
  );
  const currentViewportSource = hasCurrentViewport
    ? {
        viewport: input.currentViewport || current.viewport,
        scroll: input.currentScroll || current.scroll,
      }
    : null;
  const savedViewport = normalizeViewport(savedViewportSource);
  const currentViewport = normalizeViewport(currentViewportSource);
  if (!savedViewport || !currentViewport) {
    return { fresh: false, reason: "missing-viewport" };
  }
  const tolerance = Number.isFinite(input.viewportTolerancePx)
    ? Math.max(0, input.viewportTolerancePx)
    : 1;
  for (const key of ["width", "height", "scrollX", "scrollY"]) {
    if (!valuesWithinTolerance(savedViewport[key], currentViewport[key], tolerance)) {
      return { fresh: false, reason: "viewport-changed" };
    }
  }

  return { fresh: true, reason: null };
}

/**
 * Ensure a target did not move, resize, scroll, or change document identity
 * while capturePage was resolving. Callers discard the screenshot on failure
 * so pixels are never paired with stale DOM coordinates.
 *
 * @param {{ before?: object | null, after?: object | null, boundsTolerancePx?: number }} input
 * @returns {{ stable: boolean, reason: string | null }}
 */
function evaluateSelectionStability(input = {}) {
  const before = input.before;
  const after = input.after;
  if (!before || !after) return { stable: false, reason: "target-not-found" };
  if (
    typeof before.selector !== "string" ||
    !before.selector ||
    before.selector !== after.selector
  ) {
    return { stable: false, reason: "target-changed" };
  }

  const freshness = evaluateSelectionFreshness({
    selection: before,
    current: after.captureContext || after.context || {},
    currentUrl: after.pageUrl,
  });
  if (!freshness.fresh) return { stable: false, reason: freshness.reason };

  const beforeBounds = before.boundingBox;
  const afterBounds = after.boundingBox;
  if (!validTargetBounds(beforeBounds) || !validTargetBounds(afterBounds)) {
    return { stable: false, reason: "missing-bounds" };
  }
  const tolerance = Number.isFinite(input.boundsTolerancePx)
    ? Math.max(0, input.boundsTolerancePx)
    : 1;
  const pairs = [
    [firstDefined(beforeBounds.left, beforeBounds.x), firstDefined(afterBounds.left, afterBounds.x)],
    [firstDefined(beforeBounds.top, beforeBounds.y), firstDefined(afterBounds.top, afterBounds.y)],
    [beforeBounds.width, afterBounds.width],
    [beforeBounds.height, afterBounds.height],
  ];
  if (
    pairs.some(([left, right]) => {
      const a = Number(left);
      const b = Number(right);
      return !Number.isFinite(a) || !Number.isFinite(b) || !valuesWithinTolerance(a, b, tolerance);
    })
  ) {
    return { stable: false, reason: "target-moved" };
  }

  const beforeViewport = normalizeViewport(before.captureContext || before.context);
  const afterViewport = normalizeViewport(after.captureContext || after.context);
  const beforeDpr = beforeViewport?.devicePixelRatio;
  const afterDpr = afterViewport?.devicePixelRatio;
  if (
    Number.isFinite(beforeDpr) &&
    Number.isFinite(afterDpr) &&
    !valuesWithinTolerance(beforeDpr, afterDpr, 0.01)
  ) {
    return { stable: false, reason: "viewport-changed" };
  }

  if (
    selectionContentFingerprint(before) !== selectionContentFingerprint(after)
  ) {
    return { stable: false, reason: "target-content-changed" };
  }

  return { stable: true, reason: null };
}

function validTargetBounds(bounds) {
  if (!bounds || typeof bounds !== "object") return false;
  const width = Number(bounds.width);
  const height = Number(bounds.height);
  const left = Number(firstDefined(bounds.left, bounds.x));
  const top = Number(firstDefined(bounds.top, bounds.y));
  return (
    Number.isFinite(width) &&
    Number.isFinite(height) &&
    Number.isFinite(left) &&
    Number.isFinite(top) &&
    width > 0 &&
    height > 0
  );
}

function targetIntersectsViewport(bounds, viewport) {
  if (!validTargetBounds(bounds)) return false;
  const normalizedViewport = normalizeViewport(viewport);
  if (!normalizedViewport) return false;
  const left = Number(firstDefined(bounds.left, bounds.x));
  const top = Number(firstDefined(bounds.top, bounds.y));
  const right = left + Number(bounds.width);
  const bottom = top + Number(bounds.height);
  return Boolean(
    right > 0 &&
      bottom > 0 &&
      left < normalizedViewport.width &&
      top < normalizedViewport.height,
  );
}

/**
 * Frame capture policy. A stale selection is removed from both the crop and
 * payload plans so a new screenshot can never be paired with old DOM context.
 *
 * @param {object} input evaluateSelectionFreshness input
 * @returns {{
 *   selectionFresh: boolean,
 *   captureMode: "target" | "viewport",
 *   useTargetBounds: boolean,
 *   bounds: object | null,
 *   selectionForPayload: object | null,
 *   preservePreviousSelection: boolean,
 *   reason: string | null,
 * }}
 */
function planFrameCapture(input = {}) {
  const freshness = evaluateSelectionFreshness(input);
  const selection = freshness.fresh ? input.selection : null;
  const bounds = selection?.boundingBox;
  const viewport =
    input.currentViewport ||
    input.current ||
    selection?.captureContext ||
    selection?.context;
  const boundsValid = Boolean(selection && validTargetBounds(bounds));
  const targetVisible = Boolean(
    boundsValid && targetIntersectsViewport(bounds, viewport),
  );
  const useTargetBounds = Boolean(selection && boundsValid && targetVisible);
  const fallbackReason = freshness.reason ||
    (!boundsValid ? "invalid-target-bounds" :
      !targetVisible ? "target-outside-viewport" : null);
  return {
    selectionFresh: freshness.fresh,
    captureMode: useTargetBounds ? "target" : "viewport",
    useTargetBounds,
    bounds: useTargetBounds ? bounds : null,
    selectionForPayload: useTargetBounds ? selection : null,
    preservePreviousSelection: freshness.fresh && useTargetBounds,
    reason: fallbackReason,
  };
}

/**
 * Whether cleanup should run now (throttle full-dir walks).
 * @param {{
 *   lastCleanupAt?: number | null,
 *   now?: number,
 *   minIntervalMs?: number,
 *   force?: boolean,
 * }} opts
 * @returns {{ run: boolean, reason: string }}
 */
function shouldRunCleanup(opts = {}) {
  const force = Boolean(opts.force);
  if (force) return { run: true, reason: "force" };

  const now = opts.now ?? Date.now();
  const minIntervalMs =
    opts.minIntervalMs ?? DEFAULT_CLEANUP_MIN_INTERVAL_MS;
  const last = opts.lastCleanupAt;

  if (last == null || !Number.isFinite(last) || last <= 0) {
    return { run: true, reason: "never-run" };
  }
  if (now - last >= minIntervalMs) {
    return { run: true, reason: "interval-elapsed" };
  }
  return { run: false, reason: "throttled" };
}

/**
 * Whether settings should be flushed to disk now.
 * Intermediate samples (e.g. splitter drag) use debounce; final flush forces.
 *
 * @param {{
 *   lastFlushAt?: number | null,
 *   now?: number,
 *   minIntervalMs?: number,
 *   force?: boolean,
 *   dirty?: boolean,
 * }} opts
 * @returns {{ flush: boolean, reason: string }}
 */
function shouldFlushSettings(opts = {}) {
  if (!opts.dirty && !opts.force) {
    return { flush: false, reason: "clean" };
  }
  if (opts.force) return { flush: true, reason: "force" };

  const now = opts.now ?? Date.now();
  const minIntervalMs = opts.minIntervalMs ?? DEFAULT_SETTINGS_DEBOUNCE_MS;
  const last = opts.lastFlushAt;

  if (last == null || !Number.isFinite(last) || last <= 0) {
    return { flush: true, reason: "never-flushed" };
  }
  if (now - last >= minIntervalMs) {
    return { flush: true, reason: "debounce-elapsed" };
  }
  return { flush: false, reason: "debounced" };
}

/**
 * Coordinated post-deliver focus handoff delays (ms) relative to t0.
 * One owner schedules these; avoid multi-path storm of independent timers.
 * @returns {number[]}
 */
function focusHandoffDelays() {
  // Immediate reclaim + one deferred pass after BrowserView/React settle
  return [0, 100];
}

/**
 * Busy / operator-facing status line helpers (no second prompt panel).
 * @param {{
 *   busy?: boolean,
 *   terminalAlive?: boolean,
 *   pickMode?: boolean,
 *   hasCapture?: boolean,
 * }} state
 * @returns {{
 *   busy: boolean,
 *   canAim: boolean,
 *   canFrame: boolean,
 *   canResend: boolean,
 *   hint: string | null,
 * }}
 */
function operatorActionState(state = {}) {
  const busy = Boolean(state.busy);
  const terminalAlive = Boolean(state.terminalAlive);
  const hasCapture = Boolean(state.hasCapture);

  return {
    busy,
    canAim: !busy,
    canFrame: !busy,
    canResend: !busy && hasCapture,
    hint: busy
      ? "Busy — capture in flight"
      : !terminalAlive
        ? "Terminal off — Start Grok for auto-send"
        : null,
  };
}

/**
 * Plan reaction when Aim emits a DOM selection while capture may be in flight.
 * Picker page has already exited pickMode locally; main must stay consistent:
 * busy reject still cancels Aim UI and clears sticky highlight.
 *
 * @param {{ inFlight?: boolean }} state
 * @returns {{
 *   proceed: boolean,
 *   cancelPickMode: boolean,
 *   clearOverlay: boolean,
 *   reason: string | null,
 *   statusMessage: string | null,
 * }}
 */
function planAimPickEvent(state = {}) {
  const gate = canStartCapture({ inFlight: state.inFlight });
  if (!gate.ok) {
    return {
      proceed: false,
      cancelPickMode: true,
      clearOverlay: true,
      reason: gate.reason || "busy",
      statusMessage:
        gate.statusMessage || "Capture in progress — wait a moment.",
    };
  }
  return {
    proceed: true,
    // Exit Aim while capture runs (picker already set pickMode false locally)
    cancelPickMode: true,
    // Keep element highlight until success/failure resolves
    clearOverlay: false,
    reason: null,
    statusMessage: null,
  };
}

/**
 * Success-only commit of lastSelection + lastScreenshotPath.
 * On failure, keep previous pair so Re-send never pairs new DOM with old/missing frame.
 *
 * @param {{
 *   ok: boolean,
 *   selection?: object | null,
 *   screenshotPath?: string | null,
 *   prevSelection?: object | null,
 *   prevScreenshotPath?: string | null,
 *   preservePreviousSelection?: boolean,
 * }} input
 * @returns {{
 *   committed: boolean,
 *   lastSelection: object | null,
 *   lastScreenshotPath: string | null,
 *   cancelPickMode: boolean,
 *   clearOverlay: boolean,
 * }}
 */
function resolvePickCommit(input = {}) {
  const prevSelection = input.prevSelection ?? null;
  const prevScreenshotPath = input.prevScreenshotPath ?? null;

  if (input.ok) {
    const selection = input.selection ?? null;
    const screenshotPath =
      typeof input.screenshotPath === "string" && input.screenshotPath
        ? input.screenshotPath
        : null;

    // Aim pick: commit selection + shot together only
    if (selection != null && screenshotPath) {
      return {
        committed: true,
        lastSelection: selection,
        lastScreenshotPath: screenshotPath,
        cancelPickMode: true,
        clearOverlay: true,
      };
    }

    // Legacy Frame calls keep the previous selection. Strict Frame policy sets
    // preservePreviousSelection=false when freshness could not be proven.
    if (selection == null && screenshotPath) {
      return {
        committed: true,
        lastSelection:
          input.preservePreviousSelection === false ? null : prevSelection,
        lastScreenshotPath: screenshotPath,
        cancelPickMode: true,
        clearOverlay: true,
      };
    }

    // Selection without shot (or empty path) is inconsistent — do not commit
  }

  return {
    committed: false,
    lastSelection: prevSelection,
    lastScreenshotPath: prevScreenshotPath,
    cancelPickMode: true,
    clearOverlay: true,
  };
}

module.exports = {
  DEFAULT_CLEANUP_MIN_INTERVAL_MS,
  DEFAULT_SETTINGS_DEBOUNCE_MS,
  canStartCapture,
  mayStartCaptureAction,
  classifyGrokUiState,
  validateAimEvent,
  normalizeViewport,
  stampSelectionContext,
  samePreviewIdentity,
  evaluateSelectionFreshness,
  evaluateSelectionStability,
  planFrameCapture,
  shouldRunCleanup,
  shouldFlushSettings,
  focusHandoffDelays,
  operatorActionState,
  planAimPickEvent,
  resolvePickCommit,
};
