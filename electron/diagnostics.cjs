const os = require("os");

function sanitizeDiagnosticUrl(value) {
  if (typeof value !== "string" || !value.trim()) return "";
  try {
    const url = new URL(value);
    return `${url.origin}${url.pathname}`;
  } catch {
    return "[invalid-url]";
  }
}

function sanitizeErrorText(value) {
  return String(value || "")
    .replace(/https?:\/\/[^\s)]+/gi, (url) => sanitizeDiagnosticUrl(url))
    .replace(/(token|secret|password|api[-_]?key|authorization)\s*[=:]\s*[^\s,;]+/gi, "$1=[REDACTED]")
    .replace(/[\r\n\t]+/g, " ")
    .slice(0, 500);
}

function buildDiagnosticSummary(input = {}) {
  const sessions = (input.sessions || []).map((session) => ({
    id: String(session.id || "").slice(-8),
    label: String(session.displayLabel || session.label || "Terminal").slice(0, 80),
    cwdValid: Boolean(session.cwdValid),
    shellAlive: Boolean(session.shellAlive),
    grokRunning: Boolean(session.grokRunning),
    mode: session.mode || null,
  }));
  return {
    generatedAt: new Date().toISOString(),
    app: {
      version: String(input.appVersion || "unknown"),
      electron: String(input.electronVersion || process.versions.electron || "unknown"),
      node: String(input.nodeVersion || process.versions.node || "unknown"),
      platform: String(input.platform || process.platform),
      arch: String(input.arch || process.arch),
      osRelease: String(input.osRelease || os.release()),
    },
    grok: {
      binaryFound: Boolean(input.grokBinaryFound),
      activeSessionId: String(input.activeSessionId || "").slice(-8) || null,
    },
    // Grok Build host adaptation (identity + /terminal-setup hint)
    grokHost:
      input.grokHost && typeof input.grokHost === "object"
        ? {
            termProgram: String(input.grokHost.termProgram || "").slice(0, 40),
            termProgramVersion: String(
              input.grokHost.termProgramVersion || "",
            ).slice(0, 32),
            identityReason: String(input.grokHost.identityReason || "").slice(
              0,
              40,
            ),
            spoofed: Boolean(input.grokHost.spoofed),
            pasteCtrlV: Boolean(input.grokHost.pasteCtrlV),
            pasteSuperV: Boolean(input.grokHost.pasteSuperV),
            terminalSetupHint: String(
              input.grokHost.terminalSetupHint || "",
            ).slice(0, 240),
          }
        : undefined,
    preview: {
      url: sanitizeDiagnosticUrl(input.preview?.url),
      loading: Boolean(input.preview?.loading),
      error: sanitizeErrorText(input.preview?.error),
      privateMode: Boolean(input.preview?.privateMode),
      viewportPreset: input.preview?.viewportPreset || "fit",
    },
    sessions,
    paths: {
      settingsDir: input.settingsDir ? "configured" : "unknown",
      captureDir: input.captureDir ? "configured" : "unknown",
    },
    recentErrors: (input.recentErrors || []).slice(-10).map((entry) => ({
      code: String(entry.code || "unknown").slice(0, 80),
      message: sanitizeErrorText(entry.message),
      at: Number(entry.at) || 0,
      severity: entry.severity
        ? String(entry.severity).slice(0, 20)
        : undefined,
      count:
        typeof entry.count === "number" && Number.isFinite(entry.count)
          ? entry.count
          : undefined,
    })),
    // agent-browser doctor / browser-use health spirit (optional block)
    health:
      input.health && typeof input.health === "object"
        ? {
            ok: Boolean(input.health.ok),
            at: String(input.health.at || ""),
            notes: Array.isArray(input.health.notes)
              ? input.health.notes.map((n) => String(n).slice(0, 80)).slice(0, 20)
              : [],
            preview: input.health.preview || undefined,
            terminals: input.health.terminals || undefined,
            rings: input.health.rings || undefined,
            capture: input.health.capture || undefined,
            lastActionableCode: input.health.lastActionableCode
              ? String(input.health.lastActionableCode).slice(0, 80)
              : null,
          }
        : undefined,
  };
}

function formatDiagnosticSummary(input) {
  return JSON.stringify(buildDiagnosticSummary(input), null, 2);
}

module.exports = {
  sanitizeDiagnosticUrl,
  sanitizeErrorText,
  buildDiagnosticSummary,
  formatDiagnosticSummary,
};
