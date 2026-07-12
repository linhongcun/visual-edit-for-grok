/**
 * LLM-oriented page geometry + fault breadcrumbs (browser-use inspired).
 *
 * Ideas only — not a port of browser-use Python agent/CDP code.
 * PageInfo spirit: viewport, page size, scroll, pixels above/below/left/right.
 * Fault ring spirit: recent browser_errors for the LLM (scrubbed, capped).
 */

const {
  compactScalar,
  sanitizePageUrl,
  stripTerminalControls,
  REDACTED_VALUE,
} = require("./clipboard-payload.cjs");

const MAX_PAGE_INFO_CHARS = 900;
const MAX_FAULTS_IN_PAYLOAD = 8;
const MAX_FAULT_RING = 20;
const MAX_FAULT_MESSAGE = 240;

/**
 * @param {unknown} value
 * @returns {number | null}
 */
function finiteOrNull(value) {
  if (value === undefined || value === null || value === "") return null;
  const n = Number(value);
  return Number.isFinite(n) ? n : null;
}

/**
 * Compute browser-use-style PageInfo fields from geometry inputs.
 *
 * @param {{
 *   viewportWidth?: number | null,
 *   viewportHeight?: number | null,
 *   pageWidth?: number | null,
 *   pageHeight?: number | null,
 *   scrollX?: number | null,
 *   scrollY?: number | null,
 * }} input
 * @returns {{
 *   viewportWidth: number | null,
 *   viewportHeight: number | null,
 *   pageWidth: number | null,
 *   pageHeight: number | null,
 *   scrollX: number | null,
 *   scrollY: number | null,
 *   pixelsAbove: number | null,
 *   pixelsBelow: number | null,
 *   pixelsLeft: number | null,
 *   pixelsRight: number | null,
 * } | null}
 */
function computePageInfo(input) {
  if (!input || typeof input !== "object") return null;
  const viewportWidth = finiteOrNull(input.viewportWidth);
  const viewportHeight = finiteOrNull(input.viewportHeight);
  const pageWidth = finiteOrNull(input.pageWidth);
  const pageHeight = finiteOrNull(input.pageHeight);
  const scrollX = finiteOrNull(input.scrollX);
  const scrollY = finiteOrNull(input.scrollY);

  // Need at least viewport or scroll to be useful
  if (
    viewportWidth == null &&
    viewportHeight == null &&
    scrollX == null &&
    scrollY == null &&
    pageWidth == null &&
    pageHeight == null
  ) {
    return null;
  }

  let pixelsAbove = null;
  let pixelsBelow = null;
  let pixelsLeft = null;
  let pixelsRight = null;

  if (scrollY != null && scrollY >= 0) {
    pixelsAbove = Math.max(0, Math.round(scrollY));
  }
  if (
    pageHeight != null &&
    viewportHeight != null &&
    scrollY != null &&
    pageHeight >= 0 &&
    viewportHeight >= 0
  ) {
    pixelsBelow = Math.max(
      0,
      Math.round(pageHeight - viewportHeight - scrollY),
    );
  }
  if (scrollX != null && scrollX >= 0) {
    pixelsLeft = Math.max(0, Math.round(scrollX));
  }
  if (
    pageWidth != null &&
    viewportWidth != null &&
    scrollX != null &&
    pageWidth >= 0 &&
    viewportWidth >= 0
  ) {
    pixelsRight = Math.max(
      0,
      Math.round(pageWidth - viewportWidth - scrollX),
    );
  }

  return {
    viewportWidth,
    viewportHeight,
    pageWidth,
    pageHeight,
    scrollX,
    scrollY,
    pixelsAbove,
    pixelsBelow,
    pixelsLeft,
    pixelsRight,
  };
}

/**
 * Extract geometry inputs from an Aim selection (captureContext / viewport).
 * @param {object | null | undefined} selection
 */
function pageInfoFromSelection(selection) {
  if (!selection || typeof selection !== "object") return null;
  const context = selection.captureContext || selection.context || {};
  const viewport = context.viewport || selection.viewport || {};
  const scroll = context.scroll || viewport.scroll || selection.scroll || {};
  const page = context.page || selection.page || {};

  return computePageInfo({
    viewportWidth: viewport.width ?? viewport.innerWidth ?? selection.viewportWidth,
    viewportHeight:
      viewport.height ?? viewport.innerHeight ?? selection.viewportHeight,
    pageWidth:
      page.width ??
      page.scrollWidth ??
      context.pageWidth ??
      selection.pageWidth ??
      viewport.pageWidth,
    pageHeight:
      page.height ??
      page.scrollHeight ??
      context.pageHeight ??
      selection.pageHeight ??
      viewport.pageHeight,
    scrollX:
      viewport.scrollX ?? scroll.x ?? scroll.scrollX ?? selection.scrollX,
    scrollY:
      viewport.scrollY ?? scroll.y ?? scroll.scrollY ?? selection.scrollY,
  });
}

/**
 * Format page_info fence body (no fence markers).
 * @param {ReturnType<typeof computePageInfo>} info
 * @param {{ pageUrl?: string, pageTitle?: string, maxChars?: number }} [meta]
 * @returns {string}
 */
function formatPageInfoBlock(info, meta = {}) {
  if (!info) return "";
  const lines = [];
  const title = compactScalar(meta.pageTitle || "", 120);
  const url = meta.pageUrl ? sanitizePageUrl(meta.pageUrl) : "";
  if (title) lines.push(`title: ${title}`);
  if (url) lines.push(`url: ${url}`);
  if (
    info.viewportWidth != null &&
    info.viewportHeight != null
  ) {
    lines.push(
      `viewport_css_px: width=${Math.round(info.viewportWidth)} height=${Math.round(info.viewportHeight)}`,
    );
  }
  if (info.pageWidth != null && info.pageHeight != null) {
    lines.push(
      `page_css_px: width=${Math.round(info.pageWidth)} height=${Math.round(info.pageHeight)}`,
    );
  }
  if (info.scrollX != null && info.scrollY != null) {
    lines.push(
      `scroll_css_px: x=${Math.round(info.scrollX)} y=${Math.round(info.scrollY)}`,
    );
  }
  if (info.pixelsAbove != null) {
    lines.push(`pixels_above: ${info.pixelsAbove}`);
  }
  if (info.pixelsBelow != null) {
    lines.push(`pixels_below: ${info.pixelsBelow}`);
  }
  if (info.pixelsLeft != null) {
    lines.push(`pixels_left: ${info.pixelsLeft}`);
  }
  if (info.pixelsRight != null) {
    lines.push(`pixels_right: ${info.pixelsRight}`);
  }
  if (info.pixelsBelow != null && info.pixelsBelow > 0) {
    lines.push("note: content continues below the viewport");
  } else if (info.pixelsAbove != null && info.pixelsAbove > 0) {
    lines.push("note: content continues above the viewport");
  }

  let body = stripTerminalControls(lines.join("\n")).trim();
  const maxChars = Math.max(200, Number(meta.maxChars) || MAX_PAGE_INFO_CHARS);
  if (body.length > maxChars) body = `${body.slice(0, maxChars - 1)}…`;
  return body;
}

/**
 * Secret key=value in free-form console/load text.
 * Includes bare `token=` (same spirit as clipboard-payload SENSITIVE_ATTRIBUTE_VALUE).
 */
const FAULT_SECRET_ASSIGNMENT =
  /(access[_-]?token|refresh[_-]?token|\btoken\b|secret|auth(?:orization)?|password|passwd|credential|api[_-]?key|session(?:id)?|cookie|bearer)(\s*["']?\s*[=:]\s*["']?)([^\s"'&,;]+)/gi;

/**
 * Scrub free-form fault text (URLs + secret-ish tokens).
 * @param {unknown} message
 * @returns {string}
 */
function scrubFaultMessage(message) {
  let s = stripTerminalControls(String(message ?? ""));
  // Redact query secrets in URLs
  s = s.replace(
    /(https?:\/\/[^\s"'<>]+)/gi,
    (match) => sanitizePageUrl(match) || REDACTED_VALUE,
  );
  // Redact key=value secrets including bare token=abc123secret
  s = s.replace(FAULT_SECRET_ASSIGNMENT, `$1$2${REDACTED_VALUE}`);
  return compactScalar(s, MAX_FAULT_MESSAGE);
}

/**
 * Bounded ring of recent preview faults (browser-use browser_errors spirit).
 */
class PageFaultRing {
  /**
   * @param {{ maxSize?: number }} [opts]
   */
  constructor(opts = {}) {
    this.maxSize = Math.max(1, Math.min(50, Number(opts.maxSize) || MAX_FAULT_RING));
    /** @type {{ at: string, kind: string, message: string }[]} */
    this.items = [];
  }

  /**
   * @param {{ kind?: string, message?: string, at?: string | number }} fault
   */
  push(fault) {
    if (!fault || typeof fault !== "object") return null;
    const message = scrubFaultMessage(fault.message);
    if (!message) return null;
    const kind = compactScalar(fault.kind || "error", 40) || "error";
    let at =
      typeof fault.at === "string" && fault.at
        ? fault.at
        : new Date(
            typeof fault.at === "number" && Number.isFinite(fault.at)
              ? fault.at
              : Date.now(),
          ).toISOString();
    at = compactScalar(at, 40);
    const entry = { at, kind, message };
    // Coalesce identical tail
    const last = this.items[this.items.length - 1];
    if (last && last.kind === kind && last.message === message) {
      last.at = at;
      return last;
    }
    this.items.push(entry);
    while (this.items.length > this.maxSize) this.items.shift();
    return entry;
  }

  /** @param {number} [limit] */
  list(limit = MAX_FAULTS_IN_PAYLOAD) {
    const n = Math.max(0, Math.min(this.maxSize, Number(limit) || MAX_FAULTS_IN_PAYLOAD));
    return this.items.slice(-n);
  }

  clear() {
    this.items = [];
  }
}

/**
 * Format page_faults fence body.
 * @param {{ at: string, kind: string, message: string }[]} faults
 * @param {{ maxChars?: number }} [opts]
 * @returns {string}
 */
function formatPageFaultsBlock(faults, opts = {}) {
  if (!Array.isArray(faults) || faults.length === 0) return "";
  const lines = [];
  for (const f of faults) {
    if (!f || typeof f !== "object") continue;
    const kind = compactScalar(f.kind || "error", 40);
    const msg = scrubFaultMessage(f.message);
    if (!msg) continue;
    const at = compactScalar(f.at || "", 40);
    lines.push(at ? `[${at}] ${kind}: ${msg}` : `${kind}: ${msg}`);
  }
  if (!lines.length) return "";
  let body = stripTerminalControls(lines.join("\n")).trim();
  const maxChars = Math.max(200, Number(opts.maxChars) || 1200);
  if (body.length > maxChars) body = `${body.slice(0, maxChars - 1)}…`;
  return body;
}

module.exports = {
  computePageInfo,
  pageInfoFromSelection,
  formatPageInfoBlock,
  scrubFaultMessage,
  PageFaultRing,
  formatPageFaultsBlock,
  MAX_PAGE_INFO_CHARS,
  MAX_FAULTS_IN_PAYLOAD,
  MAX_FAULT_RING,
};
