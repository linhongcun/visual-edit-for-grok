/**
 * Pure runtime policy for capture stability & hot-path efficiency.
 * No I/O — unit-tested with fixtures.
 */

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
  if (state.inFlight) {
    return {
      ok: false,
      reason: "busy",
      statusMessage: "Capture in progress — wait a moment.",
    };
  }
  return { ok: true, reason: null, statusMessage: null };
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

    // Frame-only (no DOM node): keep previous selection, update shot path
    if (selection == null && screenshotPath) {
      return {
        committed: true,
        lastSelection: prevSelection,
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
  shouldRunCleanup,
  shouldFlushSettings,
  focusHandoffDelays,
  operatorActionState,
  planAimPickEvent,
  resolvePickCommit,
};
