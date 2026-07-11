/**
 * Pure-ish settings persistence for Visual Capture for Grok.
 * File I/O is isolated so unit tests can pass a temp path.
 */
const fs = require("fs");
const path = require("path");

const SETTINGS_VERSION = 1;
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
  splitRatio: 0.46,
  /** UI language: "en" | "zh" (empty means detect on first run) */
  locale: "",
  recentPreviewUrls: [],
  recentProjectCwds: [],
};

/**
 * @param {unknown} raw
 * @returns {{ settingsVersion: number, previewUrl: string, projectCwd: string, splitRatio: number, locale: string, recentPreviewUrls: string[], recentProjectCwds: string[] }}
 */
function normalizeSettings(raw) {
  const out = { ...DEFAULTS };
  if (!raw || typeof raw !== "object") return out;

  const o = /** @type {Record<string, unknown>} */ (raw);
  if (typeof o.previewUrl === "string" && o.previewUrl.trim()) {
    const u = o.previewUrl.trim();
    const isLegacyDefault =
      o.settingsVersion == null && LEGACY_DEMO_URLS.has(u);
    if (/^https?:\/\//i.test(u) && !isLegacyDefault) out.previewUrl = u;
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
  if (Array.isArray(o.recentPreviewUrls)) {
    out.recentPreviewUrls = Array.from(
      new Set(
        o.recentPreviewUrls
          .filter((value) => typeof value === "string" && /^https?:\/\//i.test(value))
          .map((value) => value.trim()),
      ),
    ).slice(0, 8);
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
  return out;
}

/**
 * @param {string} filePath
 * @returns {{ settingsVersion: number, previewUrl: string, projectCwd: string, splitRatio: number, locale: string, recentPreviewUrls: string[], recentProjectCwds: string[] }}
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
 * @param {Partial<{ settingsVersion: number, previewUrl: string, projectCwd: string, splitRatio: number, locale: string, recentPreviewUrls: string[], recentProjectCwds: string[] }>} partial
 * @returns {{ settingsVersion: number, previewUrl: string, projectCwd: string, splitRatio: number, locale: string, recentPreviewUrls: string[], recentProjectCwds: string[] }}
 */
function saveSettings(filePath, partial = {}) {
  const prev = loadSettings(filePath);
  const next = normalizeSettings({ ...prev, ...partial });
  const dir = path.dirname(filePath);
  fs.mkdirSync(dir, { recursive: true });
  fs.writeFileSync(filePath, JSON.stringify(next, null, 2), "utf8");
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
