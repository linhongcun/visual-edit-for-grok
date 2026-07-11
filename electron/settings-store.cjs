/**
 * Pure-ish settings persistence for Visual Capture for Grok.
 * File I/O is isolated so unit tests can pass a temp path.
 */
const fs = require("fs");
const path = require("path");

const DEFAULTS = {
  previewUrl: "http://127.0.0.1:8765",
  projectCwd: "",
  splitRatio: 0.46,
};

/**
 * @param {unknown} raw
 * @returns {{ previewUrl: string, projectCwd: string, splitRatio: number }}
 */
function normalizeSettings(raw) {
  const out = { ...DEFAULTS };
  if (!raw || typeof raw !== "object") return out;

  const o = /** @type {Record<string, unknown>} */ (raw);
  if (typeof o.previewUrl === "string" && o.previewUrl.trim()) {
    const u = o.previewUrl.trim();
    if (/^https?:\/\//i.test(u)) out.previewUrl = u;
  }
  if (typeof o.projectCwd === "string") {
    out.projectCwd = o.projectCwd;
  }
  if (typeof o.splitRatio === "number" && Number.isFinite(o.splitRatio)) {
    out.splitRatio = Math.min(0.75, Math.max(0.22, o.splitRatio));
  }
  return out;
}

/**
 * @param {string} filePath
 * @returns {{ previewUrl: string, projectCwd: string, splitRatio: number }}
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
 * @param {Partial<{ previewUrl: string, projectCwd: string, splitRatio: number }>} partial
 * @returns {{ previewUrl: string, projectCwd: string, splitRatio: number }}
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
  DEFAULTS,
  normalizeSettings,
  loadSettings,
  saveSettings,
  defaultSettingsPath,
};
