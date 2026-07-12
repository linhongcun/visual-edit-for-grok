/**
 * Production-oriented stability helpers for the main process.
 * Pure (no Electron imports) — unit-tested, required by main + diagnostics.
 *
 * Ideas (reimplemented, no source copy):
 * - Warp / prior: expected vs actionable, privacy-safe ring, once-per-run
 * - agent-browser: op timeouts, doctor-style health summary
 * - browser-use: hang/crash watchdog spirit (timeout + crash report codes)
 * - playwright-mcp: isolation + scrubbed operator-facing diagnostics
 */

const { sanitizeErrorText, sanitizeDiagnosticUrl } = require("./diagnostics.cjs");

const DEFAULT_RING_SIZE = 30;
/** Default host op timeout (browser-use CDP / agent-browser tool spirit). */
const DEFAULT_OP_TIMEOUT_MS = 30_000;
const MIN_OP_TIMEOUT_MS = 1_000;
const MAX_OP_TIMEOUT_MS = 180_000;

/**
 * @param {unknown} value
 * @param {number} [fallback]
 * @returns {number}
 */
function clampOpTimeoutMs(value, fallback = DEFAULT_OP_TIMEOUT_MS) {
  const n = Number(value);
  if (!Number.isFinite(n)) return fallback;
  return Math.min(MAX_OP_TIMEOUT_MS, Math.max(MIN_OP_TIMEOUT_MS, Math.round(n)));
}

/**
 * Race a promise against a timeout so host ops cannot hang forever
 * (browser-use TimeoutWrappedCDPClient / agent-browser tool timeout spirit).
 *
 * @template T
 * @param {Promise<T>} promise
 * @param {number} [ms]
 * @param {{ code?: string, label?: string }} [opts]
 * @returns {Promise<T>}
 */
function withTimeout(promise, ms, opts = {}) {
  const timeoutMs = clampOpTimeoutMs(ms, DEFAULT_OP_TIMEOUT_MS);
  const code = String(opts.code || "op-timeout").slice(0, 80);
  const label = String(opts.label || "operation").slice(0, 120);
  let timer = null;
  const timeoutPromise = new Promise((_, reject) => {
    timer = setTimeout(() => {
      const err = new Error(
        `${label} timed out after ${timeoutMs}ms`,
      );
      err.name = "TimeoutError";
      err.code = code;
      reject(err);
    }, timeoutMs);
    // Do not unref: unit tests and short-lived scripts must still fire timeouts.
  });
  return Promise.race([
    Promise.resolve(promise).finally(() => {
      if (timer) clearTimeout(timer);
    }),
    timeoutPromise,
  ]);
}

/**
 * Doctor-style health snapshot for diagnostics (agent-browser doctor spirit).
 * Pure: only formats inputs provided by main.
 *
 * @param {{
 *   previewOk?: boolean,
 *   previewLoading?: boolean,
 *   previewError?: string | null,
 *   previewDestroyed?: boolean,
 *   sessionCount?: number,
 *   grokRunningCount?: number,
 *   shellAliveCount?: number,
 *   faultRingSize?: number,
 *   networkRingSize?: number,
 *   stabilityBufferSize?: number,
 *   actionableErrorCount?: number,
 *   lastActionableCode?: string | null,
 *   captureInFlight?: boolean,
 *   now?: number,
 * }} input
 * @returns {{
 *   ok: boolean,
 *   at: string,
 *   preview: { ok: boolean, loading: boolean, destroyed: boolean, error: string },
 *   terminals: { sessions: number, grokRunning: number, shellAlive: number },
 *   rings: { faults: number, network: number, stability: number, actionable: number },
 *   capture: { inFlight: boolean },
 *   lastActionableCode: string | null,
 *   notes: string[],
 * }}
 */
function buildHealthSnapshot(input = {}) {
  const notes = [];
  const previewDestroyed = Boolean(input.previewDestroyed);
  const previewError = sanitizeErrorText(input.previewError || "");
  const previewLoading = Boolean(input.previewLoading);
  const previewOk =
    input.previewOk === false
      ? false
      : !previewDestroyed && !previewError;
  if (previewDestroyed) notes.push("preview-destroyed");
  if (previewError) notes.push("preview-error");
  if (previewLoading) notes.push("preview-loading");

  const sessions = Math.max(0, Number(input.sessionCount) || 0);
  const grokRunning = Math.max(0, Number(input.grokRunningCount) || 0);
  const shellAlive = Math.max(0, Number(input.shellAliveCount) || 0);
  if (sessions === 0) notes.push("no-terminal-sessions");
  if (sessions > 0 && grokRunning === 0) notes.push("no-grok-running");

  const actionable = Math.max(0, Number(input.actionableErrorCount) || 0);
  if (actionable > 0) notes.push("actionable-errors");

  const captureInFlight = Boolean(input.captureInFlight);
  if (captureInFlight) notes.push("capture-in-flight");

  const at =
    typeof input.now === "number" && Number.isFinite(input.now)
      ? new Date(input.now).toISOString()
      : new Date().toISOString();

  const lastActionableCode =
    typeof input.lastActionableCode === "string" && input.lastActionableCode
      ? input.lastActionableCode.slice(0, 80)
      : null;

  const ok =
    previewOk &&
    !previewDestroyed &&
    actionable === 0 &&
    sessions > 0;

  return {
    ok,
    at,
    preview: {
      ok: previewOk,
      loading: previewLoading,
      destroyed: previewDestroyed,
      error: previewError,
    },
    terminals: {
      sessions,
      grokRunning,
      shellAlive,
    },
    rings: {
      faults: Math.max(0, Number(input.faultRingSize) || 0),
      network: Math.max(0, Number(input.networkRingSize) || 0),
      stability: Math.max(0, Number(input.stabilityBufferSize) || 0),
      actionable,
    },
    capture: { inFlight: captureInFlight },
    lastActionableCode,
    notes,
  };
}

/**
 * @typedef {"actionable"|"expected"|"info"} StabilitySeverity
 * @typedef {{
 *   code: string,
 *   message: string,
 *   severity: StabilitySeverity,
 *   source?: string,
 *   at: number,
 *   count?: number,
 * }} StabilityErrorEntry
 */

/**
 * Classify a failure for buffering / operator attention.
 * Expected failures (user cancel, missing binary, page load) stay quiet;
 * bugs and unexpected exceptions are actionable.
 *
 * @param {{ code?: string, message?: string, error?: unknown, source?: string } | string | Error | null | undefined} input
 * @returns {{ code: string, severity: StabilitySeverity, message: string }}
 */
function classifyStabilityError(input) {
  let code = "unknown";
  let message = "";
  let source = "";

  if (typeof input === "string") {
    message = input;
  } else if (input instanceof Error) {
    message = input.message || String(input);
    code = input.name && input.name !== "Error" ? input.name : "error";
  } else if (input && typeof input === "object") {
    const o = /** @type {Record<string, unknown>} */ (input);
    if (typeof o.code === "string" && o.code.trim()) code = o.code.trim();
    if (typeof o.message === "string") message = o.message;
    else if (o.error instanceof Error) message = o.error.message;
    else if (typeof o.error === "string") message = o.error;
    if (typeof o.source === "string") source = o.source;
  }

  message = String(message || "").trim();
  const blob = `${code} ${message} ${source}`.toLowerCase();

  // Explicit codes first
  if (
    /^(user-cancel|canceled|cancelled|preview-load|preview-not-ready|grok-missing|invalid-url|busy|nothing-to-resend|pty-exit|settings-write|stability-probe|op-timeout|capture-timeout|preview-crash|preview-unresponsive)$/i.test(
      code,
    )
  ) {
    const severity =
      /^(preview-crash|preview-unresponsive)$/i.test(code)
        ? "actionable"
        : "expected";
    return {
      code: code.slice(0, 80),
      severity,
      message: sanitizeErrorText(message || code),
    };
  }

  // Timeouts — expected host hang (page frozen), not a JS bug
  if (
    /op-timeout|capture-timeout|timed?\s*out|TimeoutError/i.test(blob)
  ) {
    return {
      code: (code !== "unknown" ? code : "op-timeout").slice(0, 80),
      severity: "expected",
      message: sanitizeErrorText(message || code),
    };
  }

  // Expected environmental / user paths
  if (
    /user.?cancel|canceled|cancelled|econnrefused|enotfound|etimedout|net::err_|preview.?load|page.?load|navigation.?fail|aborted|err_aborted|err_failed|err_name_not_resolved|err_connection_refused|err_internet_disconnected/i.test(
      blob,
    )
  ) {
    return {
      code: (code !== "unknown" ? code : "expected-env").slice(0, 80),
      severity: "expected",
      message: sanitizeErrorText(message || code),
    };
  }

  if (
    /enoent|spawn.*enoent|cannot find.*grok|grok.*(not found|missing)|command not found/i.test(
      blob,
    )
  ) {
    return {
      code: (code !== "unknown" ? code : "grok-missing").slice(0, 80),
      severity: "expected",
      message: sanitizeErrorText(message || code),
    };
  }

  // Settings / disk: soft degradations (still buffered as expected unless EPERM on unexpected path)
  if (/settings.?write|persist settings|eexist|ebusy/i.test(blob)) {
    return {
      code: (code !== "unknown" ? code : "settings-io").slice(0, 80),
      severity: "expected",
      message: sanitizeErrorText(message || code),
    };
  }

  // Uncaught / unhandled — always actionable
  if (
    /uncaught|unhandled.?rejection|typeerror|referenceerror|syntaxerror|rangeerror|cannot find module|module_not_found/i.test(
      blob,
    )
  ) {
    return {
      code: (code !== "unknown" ? code : "uncaught").slice(0, 80),
      severity: "actionable",
      message: sanitizeErrorText(message || code),
    };
  }

  if (!message && code === "unknown") {
    return { code: "unknown", severity: "info", message: "" };
  }

  return {
    code: (code !== "unknown" ? code : "error").slice(0, 80),
    severity: "actionable",
    message: sanitizeErrorText(message || code),
  };
}

/**
 * Scrub free-form text for the recent-error buffer (URLs + secret patterns).
 * @param {unknown} value
 * @returns {string}
 */
function scrubStabilityMessage(value) {
  return sanitizeErrorText(value);
}

/**
 * Privacy-safe fixed-size recent-error ring.
 */
class StabilityErrorBuffer {
  /**
   * @param {{ maxSize?: number, now?: () => number }} [opts]
   */
  constructor(opts = {}) {
    this.maxSize = Math.max(1, Number(opts.maxSize) || DEFAULT_RING_SIZE);
    /** @type {StabilityErrorEntry[]} */
    this._entries = [];
    this._now = typeof opts.now === "function" ? opts.now : () => Date.now();
  }

  /**
   * @param {{ code?: string, message?: string, severity?: StabilitySeverity, source?: string, error?: unknown, at?: number }} input
   * @returns {StabilityErrorEntry | null} entry if stored (actionable/expected), null if empty info
   */
  push(input = {}) {
    const classified = classifyStabilityError(input);
    if (!classified.message && classified.severity === "info") return null;

    const at =
      typeof input.at === "number" && Number.isFinite(input.at)
        ? input.at
        : this._now();
    const source =
      typeof input.source === "string" ? input.source.slice(0, 80) : undefined;
    const severity =
      input.severity === "actionable" ||
      input.severity === "expected" ||
      input.severity === "info"
        ? input.severity
        : classified.severity;

    /** @type {StabilityErrorEntry} */
    const entry = {
      code: classified.code,
      message: scrubStabilityMessage(classified.message || classified.code),
      severity,
      at,
      count: 1,
    };
    if (source) entry.source = source;

    // Coalesce identical code+message at tail (flood control)
    const last = this._entries[this._entries.length - 1];
    if (
      last &&
      last.code === entry.code &&
      last.message === entry.message &&
      last.severity === entry.severity
    ) {
      last.count = (last.count || 1) + 1;
      last.at = entry.at;
      return last;
    }

    this._entries.push(entry);
    while (this._entries.length > this.maxSize) {
      this._entries.shift();
    }
    return entry;
  }

  /**
   * @param {number} [limit]
   * @returns {StabilityErrorEntry[]}
   */
  list(limit = this.maxSize) {
    const n = Math.max(0, Number(limit) || this.maxSize);
    return this._entries.slice(-n).map((e) => ({ ...e }));
  }

  /** @returns {number} */
  size() {
    return this._entries.length;
  }

  clear() {
    this._entries = [];
  }
}

/**
 * Once-per-run throttle: first call for a key returns true; later false.
 * @param {Map<string, true>} [seen]
 * @returns {(key: string) => boolean}
 */
function createOncePerRun(seen = new Map()) {
  return function oncePerRun(key) {
    const k = String(key || "").slice(0, 200);
    if (!k) return true;
    if (seen.has(k)) return false;
    seen.set(k, true);
    return true;
  };
}

/**
 * Process an unexpected main-process fault without rethrowing.
 * Always buffers actionable classification; returns entry for logging/UI.
 *
 * @param {StabilityErrorBuffer} buffer
 * @param {{ code?: string, message?: string, error?: unknown, source?: string }} input
 * @param {{ once?: (key: string) => boolean, throttleKey?: string }} [opts]
 * @returns {StabilityErrorEntry | null}
 */
function reportStabilityFault(buffer, input, opts = {}) {
  const classified = classifyStabilityError(input);
  const throttleKey =
    opts.throttleKey ||
    `${classified.code}|${classified.message}|${input.source || ""}`;
  if (opts.once && !opts.once(throttleKey)) {
    // Still count toward coalesce if same as last — push without once block
    // only when once denies: skip buffer entirely for identical floods.
    return null;
  }
  return buffer.push({
    ...input,
    code: classified.code,
    message: classified.message,
    severity: classified.severity,
  });
}

/**
 * Static packaging guard: detect main-graph requires that leave the asar tree.
 * Forbidden patterns for main-process modules under electron/:
 * - require("../src/...")
 * - require("../../src/...")
 * - require with absolute path to repo src (optional)
 *
 * @param {string} sourceText file contents
 * @param {string} [fileLabel]
 * @returns {{ ok: boolean, violations: Array<{ file: string, line: number, snippet: string }> }}
 */
function findForbiddenMainRequires(sourceText, fileLabel = "unknown") {
  const violations = [];
  const lines = String(sourceText || "").split(/\r?\n/);
  const re =
    /require\s*\(\s*['"`](?:\.\.\/)+src\/[^'"`]+['"`]\s*\)|require\s*\(\s*['"`][^'"`]*\/src\/[^'"`]+['"`]\s*\)/;
  for (let i = 0; i < lines.length; i += 1) {
    const line = lines[i];
    // Skip comments
    const trimmed = line.trim();
    if (trimmed.startsWith("//") || trimmed.startsWith("*")) continue;
    if (re.test(line)) {
      // Allow test-only mentions in strings about the pattern itself
      if (/forbidden|out-of-asar|packaging.?guard|no `require/i.test(line)) {
        continue;
      }
      violations.push({
        file: fileLabel,
        line: i + 1,
        snippet: line.trim().slice(0, 160),
      });
    }
  }
  return { ok: violations.length === 0, violations };
}

/**
 * Scan multiple files (content map).
 * @param {Record<string, string>} filesByPath
 */
function scanMainRequireGraph(filesByPath) {
  /** @type {Array<{ file: string, line: number, snippet: string }>} */
  const violations = [];
  for (const [file, content] of Object.entries(filesByPath || {})) {
    const result = findForbiddenMainRequires(content, file);
    violations.push(...result.violations);
  }
  return { ok: violations.length === 0, violations };
}

module.exports = {
  DEFAULT_RING_SIZE,
  DEFAULT_OP_TIMEOUT_MS,
  MIN_OP_TIMEOUT_MS,
  MAX_OP_TIMEOUT_MS,
  clampOpTimeoutMs,
  withTimeout,
  buildHealthSnapshot,
  classifyStabilityError,
  scrubStabilityMessage,
  StabilityErrorBuffer,
  createOncePerRun,
  reportStabilityFault,
  findForbiddenMainRequires,
  scanMainRequireGraph,
  // re-export scrub helpers used by tests that only load stability
  sanitizeDiagnosticUrl,
};
