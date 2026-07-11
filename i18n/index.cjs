/**
 * Shared i18n catalogs for main process + tests.
 * Renderer loads the same JSON via Vite (src/i18n.ts).
 */
const path = require("path");
const en = require("./en.json");
const zh = require("./zh.json");

const CATALOGS = {
  en,
  zh,
};

/**
 * @param {unknown} value
 * @returns {"en" | "zh"}
 */
function normalizeLocale(value) {
  if (typeof value !== "string") return "en";
  const v = value.trim().toLowerCase().replace(/_/g, "-");
  if (v === "zh" || v.startsWith("zh-")) return "zh";
  if (v === "en" || v.startsWith("en-")) return "en";
  return "en";
}

/**
 * Best-effort system locale (Electron app.getLocale or process env).
 * @param {string | null | undefined} systemLocale
 * @returns {"en" | "zh"}
 */
function detectLocale(systemLocale) {
  return normalizeLocale(systemLocale || process.env.LANG || process.env.LC_ALL || "en");
}

/**
 * @param {"en" | "zh"} locale
 * @param {string} key
 * @param {Record<string, string | number> | null | undefined} [vars]
 * @returns {string}
 */
function t(locale, key, vars) {
  const lang = normalizeLocale(locale);
  const catalog = CATALOGS[lang] || en;
  let text = catalog[key] ?? en[key] ?? key;
  if (vars && typeof text === "string") {
    for (const [k, v] of Object.entries(vars)) {
      text = text.replace(new RegExp(`\\{${k}\\}`, "g"), String(v));
    }
  }
  return text;
}

/**
 * @param {"en" | "zh"} locale
 */
function catalogFor(locale) {
  return CATALOGS[normalizeLocale(locale)] || en;
}

module.exports = {
  CATALOGS,
  normalizeLocale,
  detectLocale,
  t,
  catalogFor,
  messagesDir: path.join(__dirname),
};
