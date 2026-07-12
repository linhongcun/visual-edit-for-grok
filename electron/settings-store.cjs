/**
 * Pure-ish settings persistence for Visual Capture for Grok.
 * File I/O is isolated so unit tests can pass a temp path.
 */
const fs = require("fs");
const path = require("path");
const {
  normalizeSessionWorkspaceFields,
} = require("./capture-coordinator.cjs");
const {
  sanitizeHistoryUrl,
  sanitizeHistoryUrls,
} = require("./privacy-policy.cjs");
const {
  clampTermFontSize,
  clampTermScrollback,
  asBoolean,
  TERM_FONT_SIZE_DEFAULT,
  TERM_SCROLLBACK_DEFAULT,
} = require("./term-settings.cjs");

const SETTINGS_VERSION = 3;
const LEGACY_DEMO_URLS = new Set([
  "http://127.0.0.1:8765",
  "http://127.0.0.1:8765/",
]);

const DEFAULTS = {
  settingsVersion: SETTINGS_VERSION,
  // Empty means the bundled first-run guide; the old localhost:8765 default
  // produced a failure screen in installed builds unless the demo was started.
  previewUrl: "",
  projectCwd: "",
  // Slightly wider terminal pane so Grok TUI tables get more columns by default
  splitRatio: 0.52,
  /** UI language: "en" | "zh" (empty means detect on first run) */
  locale: "",
  /** Hide website preview + URL chrome; terminal uses full width */
  previewCollapsed: false,
  /** Use an in-memory preview partition and avoid persisting URL history. */
  privateMode: false,
  /** Multi-terminal tabs: [{ id, cwd, label, createdAt }] */
  terminalSessions: [],
  /** Active terminal tab id */
  activeTerminalId: "",
  recentPreviewUrls: [],
  recentProjectCwds: [],
  /** Terminal host font size (px) */
  termFontSize: TERM_FONT_SIZE_DEFAULT,
  /** Show hover tooltip for terminal http(s) links */
  linkTooltip: true,
  /** Copy selection to clipboard on mouseup (default off — noisy for Grok TUI) */
  copyOnSelect: false,
  /** xterm scrollback rows */
  termScrollback: TERM_SCROLLBACK_DEFAULT,
  /** OS notification when Grok exits while app is in background */
  notifyOnGrokExit: true,
};

/**
 * @param {unknown} raw
 * @returns {{ settingsVersion: number, previewUrl: string, projectCwd: string, splitRatio: number, locale: string, previewCollapsed: boolean, recentPreviewUrls: string[], recentProjectCwds: string[] }}
 */
function normalizeSettings(raw) {
  const out = { ...DEFAULTS };
  if (!raw || typeof raw !== "object") return out;

  const o = /** @type {Record<string, unknown>} */ (raw);
  if (typeof o.previewUrl === "string" && o.previewUrl.trim()) {
    const u = o.previewUrl.trim();
    const isLegacyDefault =
      o.settingsVersion == null && LEGACY_DEMO_URLS.has(u);
    const safeUrl = sanitizeHistoryUrl(u);
    if (safeUrl && !isLegacyDefault) out.previewUrl = safeUrl;
  }
  if (typeof o.projectCwd === "string") {
    out.projectCwd = o.projectCwd;
  }
  if (typeof o.splitRatio === "number" && Number.isFinite(o.splitRatio)) {
    out.splitRatio = Math.min(0.75, Math.max(0.22, o.splitRatio));
  }
  if (typeof o.locale === "string") {
    const loc = o.locale.trim().toLowerCase();
    if (loc === "en" || loc === "zh") out.locale = loc;
    else if (loc.startsWith("zh")) out.locale = "zh";
    else if (loc.startsWith("en")) out.locale = "en";
    else if (loc === "") out.locale = "";
  }
  if (typeof o.previewCollapsed === "boolean") {
    out.previewCollapsed = o.previewCollapsed;
  }
  if (typeof o.privateMode === "boolean") {
    out.privateMode = o.privateMode;
  }
  if (Array.isArray(o.terminalSessions)) {
    out.terminalSessions = o.terminalSessions
      .filter((item) => item && typeof item === "object")
      .map((item) => {
        const row = /** @type {Record<string, unknown>} */ (item);
        const workspace = normalizeSessionWorkspaceFields(row);
        return {
          id: typeof row.id === "string" ? row.id : "",
          cwd: typeof row.cwd === "string" ? row.cwd : "",
          label: typeof row.label === "string" ? row.label : "",
          createdAt:
            typeof row.createdAt === "number" && Number.isFinite(row.createdAt)
              ? row.createdAt
              : 0,
          ...workspace,
          previewUrl: sanitizeHistoryUrl(workspace.previewUrl) || "",
        };
      })
      .filter((item) => item.id)
      .slice(0, 6);
  }
  if (typeof o.activeTerminalId === "string") {
    out.activeTerminalId = o.activeTerminalId.trim();
  }
  if (Array.isArray(o.recentPreviewUrls)) {
    out.recentPreviewUrls = sanitizeHistoryUrls(o.recentPreviewUrls, 8);
  }
  if (Array.isArray(o.recentProjectCwds)) {
    out.recentProjectCwds = Array.from(
      new Set(
        o.recentProjectCwds
          .filter((value) => typeof value === "string" && value.trim())
          .map((value) => value.trim()),
      ),
    ).slice(0, 8);
  }
  if (o.termFontSize != null) {
    out.termFontSize = clampTermFontSize(o.termFontSize, TERM_FONT_SIZE_DEFAULT);
  }
  if (typeof o.linkTooltip === "boolean") {
    out.linkTooltip = o.linkTooltip;
  }
  if (typeof o.copyOnSelect === "boolean") {
    out.copyOnSelect = o.copyOnSelect;
  }
  if (o.termScrollback != null) {
    out.termScrollback = clampTermScrollback(
      o.termScrollback,
      TERM_SCROLLBACK_DEFAULT,
    );
  }
  if (typeof o.notifyOnGrokExit === "boolean") {
    out.notifyOnGrokExit = o.notifyOnGrokExit;
  } else if (o.notifyOnGrokExit != null) {
    out.notifyOnGrokExit = asBoolean(o.notifyOnGrokExit, true);
  }
  return out;
}

/**
 * @param {string} filePath
 * @returns {{ settingsVersion: number, previewUrl: string, projectCwd: string, splitRatio: number, locale: string, previewCollapsed: boolean, recentPreviewUrls: string[], recentProjectCwds: string[] }}
 */
function loadSettings(filePath) {
  try {
    if (!filePath || !fs.existsSync(filePath)) return { ...DEFAULTS };
    const raw = JSON.parse(fs.readFileSync(filePath, "utf8"));
    return normalizeSettings(raw);
  } catch {
    return { ...DEFAULTS };
  }
}

/**
 * @param {string} filePath
 * @param {Partial<{ settingsVersion: number, previewUrl: string, projectCwd: string, splitRatio: number, locale: string, previewCollapsed: boolean, recentPreviewUrls: string[], recentProjectCwds: string[] }>} partial
 * @returns {{ settingsVersion: number, previewUrl: string, projectCwd: string, splitRatio: number, locale: string, previewCollapsed: boolean, recentPreviewUrls: string[], recentProjectCwds: string[] }}
 */
function saveSettings(filePath, partial = {}) {
  const prev = loadSettings(filePath);
  const next = normalizeSettings({ ...prev, ...partial });
  const dir = path.dirname(filePath);
  fs.mkdirSync(dir, { recursive: true, mode: 0o700 });
  const tempPath = `${filePath}.${process.pid}.${Date.now()}.tmp`;
  try {
    fs.writeFileSync(tempPath, JSON.stringify(next, null, 2), {
      encoding: "utf8",
      flag: "wx",
      mode: 0o600,
    });
    fs.renameSync(tempPath, filePath);
    fs.chmodSync(filePath, 0o600);
  } finally {
    try {
      fs.unlinkSync(tempPath);
    } catch {
      // Rename succeeded or no temporary file was created.
    }
  }
  return next;
}

/**
 * Default settings path under a user-data style root.
 * @param {string} userDataDir
 */
function defaultSettingsPath(userDataDir) {
  return path.join(userDataDir, "visual-capture-settings.json");
}

module.exports = {
  SETTINGS_VERSION,
  DEFAULTS,
  normalizeSettings,
  loadSettings,
  saveSettings,
  defaultSettingsPath,
};
