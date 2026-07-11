const DEFAULT_PERSISTENT_PARTITION = "persist:vefg-preview";
const DEFAULT_PRIVATE_PARTITION = "vefg-preview-private";

const SENSITIVE_URL_KEYS = new Set([
  "accesstoken",
  "refreshtoken",
  "idtoken",
  "token",
  "authorization",
  "auth",
  "oauth",
  "code",
  "password",
  "passwd",
  "secret",
  "apikey",
  "credential",
  "credentials",
  "accesskey",
  "privatekey",
  "key",
  "session",
  "sessionid",
  "cookie",
  "bearer",
  "jwt",
  "signature",
  "sig",
  "xamzcredential",
  "xamzsignature",
  "xamzsecuritytoken",
  "xgoogcredential",
  "xgoogsignature",
]);

const CLEARABLE_PREVIEW_STORAGES = Object.freeze([
  "cookies",
  "filesystem",
  "indexdb",
  "localstorage",
  "shadercache",
  "serviceworkers",
  "cachestorage",
]);

function compactKey(value) {
  return String(value || "")
    .toLowerCase()
    .replace(/[^a-z0-9]/g, "");
}

function isSensitiveUrlKey(value) {
  const key = compactKey(value);
  return (
    SENSITIVE_URL_KEYS.has(key) ||
    key.endsWith("token") ||
    key.endsWith("password") ||
    key.endsWith("secret") ||
    key.endsWith("signature")
  );
}

function decoded(value) {
  try {
    return decodeURIComponent(value);
  } catch {
    return String(value || "");
  }
}

function containsSensitiveAssignment(value) {
  const source = decoded(value);
  for (const segment of source.split(/[?&#;/]/)) {
    const separator = segment.indexOf("=");
    if (separator <= 0) continue;
    if (isSensitiveUrlKey(segment.slice(0, separator))) return true;
  }
  return false;
}

/**
 * Return a persistable HTTP(S) history URL. Credentials and secret-bearing
 * parameters/fragments are removed, while ordinary query and hash state stay.
 *
 * @param {unknown} value
 * @returns {string | null}
 */
function sanitizeHistoryUrl(value) {
  if (typeof value !== "string" || !value.trim()) return null;
  let url;
  try {
    url = new URL(value.trim());
  } catch {
    return null;
  }
  if (!["http:", "https:"].includes(url.protocol)) return null;

  url.username = "";
  url.password = "";
  for (const [name, paramValue] of Array.from(url.searchParams.entries())) {
    if (isSensitiveUrlKey(name) || containsSensitiveAssignment(paramValue)) {
      url.searchParams.delete(name);
    }
  }
  if (url.hash && containsSensitiveAssignment(url.hash.slice(1))) {
    url.hash = "";
  }
  return url.href;
}

/**
 * Sanitize, de-duplicate and cap a persisted URL history list.
 *
 * @param {unknown} values
 * @param {number} [limit]
 */
function sanitizeHistoryUrls(values, limit = 8) {
  if (!Array.isArray(values)) return [];
  const cap = Number.isFinite(Number(limit))
    ? Math.max(0, Math.floor(Number(limit)))
    : 8;
  const result = [];
  const seen = new Set();
  for (const value of values) {
    const sanitized = sanitizeHistoryUrl(value);
    if (!sanitized || seen.has(sanitized)) continue;
    seen.add(sanitized);
    result.push(sanitized);
    if (result.length >= cap) break;
  }
  return result;
}

/**
 * Downloads are denied unless the product explicitly enables them and the
 * operator confirms this concrete HTTP(S) request.
 *
 * @param {{ url?: unknown, downloadsEnabled?: boolean, userConfirmed?: boolean }} [input]
 * @returns {{ allow: boolean, reason: string | null, url: string | null }}
 */
function evaluateDownloadPolicy(input = {}) {
  if (input.downloadsEnabled !== true) {
    return { allow: false, reason: "downloads-disabled", url: null };
  }
  if (input.userConfirmed !== true) {
    return { allow: false, reason: "confirmation-required", url: null };
  }
  let url;
  try {
    url = new URL(String(input.url || ""));
  } catch {
    return { allow: false, reason: "invalid-url", url: null };
  }
  if (!["http:", "https:"].includes(url.protocol)) {
    return { allow: false, reason: "unsupported-protocol", url: null };
  }
  return { allow: true, reason: null, url: url.href };
}

/**
 * Session construction policy. A partition without `persist:` is in-memory in
 * Electron. Switching modes therefore requires recreating the preview view.
 *
 * @param {{
 *   privateMode?: boolean,
 *   persistentPartition?: string,
 *   privatePartition?: string,
 * }} [input]
 */
function buildPreviewSessionPolicy(input = {}) {
  const privateMode = input.privateMode === true;
  if (privateMode) {
    const requested = String(
      input.privatePartition || DEFAULT_PRIVATE_PARTITION,
    ).replace(/^persist:/i, "");
    return {
      privateMode: true,
      partition: requested || DEFAULT_PRIVATE_PARTITION,
      persistent: false,
      persistHistory: false,
      clearOnClose: true,
    };
  }

  let partition = String(
    input.persistentPartition || DEFAULT_PERSISTENT_PARTITION,
  );
  if (!partition.startsWith("persist:")) partition = `persist:${partition}`;
  return {
    privateMode: false,
    partition,
    persistent: true,
    persistHistory: true,
    clearOnClose: false,
  };
}

/**
 * Pure plan for Electron session.clearStorageData plus cache/auth-cache cleanup.
 *
 * @param {{ scope?: "all" | "origin", currentUrl?: unknown }} [input]
 * @returns {{
 *   ok: boolean,
 *   reason: string | null,
 *   clearStorageData: { origin?: string, storages: string[] } | null,
 *   clearCache: boolean,
 *   clearAuthCache: boolean,
 * }}
 */
function buildPreviewDataClearPlan(input = {}) {
  const scope = input.scope === "origin" ? "origin" : "all";
  const clearStorageData = {
    storages: [...CLEARABLE_PREVIEW_STORAGES],
  };
  if (scope === "origin") {
    const sanitized = sanitizeHistoryUrl(input.currentUrl);
    if (!sanitized) {
      return {
        ok: false,
        reason: "invalid-origin",
        clearStorageData: null,
        clearCache: false,
        clearAuthCache: false,
      };
    }
    clearStorageData.origin = new URL(sanitized).origin;
  }
  return {
    ok: true,
    reason: null,
    clearStorageData,
    clearCache: true,
    clearAuthCache: true,
  };
}

module.exports = {
  DEFAULT_PERSISTENT_PARTITION,
  DEFAULT_PRIVATE_PARTITION,
  CLEARABLE_PREVIEW_STORAGES,
  isSensitiveUrlKey,
  sanitizeHistoryUrl,
  sanitizeHistoryUrls,
  evaluateDownloadPolicy,
  buildPreviewSessionPolicy,
  buildPreviewDataClearPlan,
};
