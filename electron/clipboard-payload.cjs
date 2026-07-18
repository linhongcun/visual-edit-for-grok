/**
 * Pure paste payload builder for native Grok Build TUI.
 * Shape aligned with Cursor's browser_element + additive intent / style diffs.
 * Also attaches agent-browser-inspired compact @eN snapshot (see agent-snapshot.cjs).
 *
 * @typedef {{ before?: string, after?: string }} StyleChange
 * @typedef {Record<string, StyleChange | string>} StyleDiffMap
 *
 */

const REDACTED_VALUE = "[REDACTED]";
const SENSITIVE_ATTRIBUTE_NAME =
  /(value|token|secret|auth|password|passwd|credential|api[-_]?key|access[-_]?key|private[-_]?key|session|cookie|bearer)/i;
const SENSITIVE_ATTRIBUTE_VALUE =
  /(?:^|[^a-z0-9])(access[_-]?token|refresh[_-]?token|token|secret|auth(?:orization)?|password|passwd|credential|api[_-]?key|session(?:id)?|cookie)\s*["']?\s*[=:]/i;

/** Compact, high-signal computed styles included in the Grok context. */
const KEY_COMPUTED_STYLE_PROPS = [
  "display",
  "position",
  "width",
  "height",
  "margin",
  "padding",
  "color",
  "backgroundColor",
  "fontSize",
  "fontWeight",
  "lineHeight",
  "border",
  "borderRadius",
  "flex",
  "gap",
  "justifyContent",
  "alignItems",
  "gridTemplateColumns",
];

function stripTerminalControls(value) {
  return String(value ?? "").replace(
    /[\u0000-\u0008\u000b\u000c\u000e-\u001f\u007f-\u009f]/g,
    "",
  );
}

/**
 * Neutralize ``` fence-breakers without collapsing newlines (for multi-line
 * intent / freeform blocks).
 * @param {unknown} value
 * @param {number} [maxLength]
 */
function neutralizeFenceBreakers(value, maxLength = 1000) {
  return stripTerminalControls(value)
    .replace(/`+/g, (run) =>
      run.length >= 3 ? run.replace(/`/g, "`\u200b") : run,
    )
    .slice(0, maxLength);
}

function compactScalar(value, maxLength = 240) {
  return neutralizeFenceBreakers(value, maxLength)
    .replace(/[\r\n\t]+/g, " ")
    .trim()
    .slice(0, maxLength);
}

function isSensitiveAttribute(name, value) {
  return (
    SENSITIVE_ATTRIBUTE_NAME.test(String(name)) ||
    SENSITIVE_ATTRIBUTE_VALUE.test(String(value ?? ""))
  );
}

/**
 * Redact secrets while keeping attribute names useful for source matching.
 * @param {object | null | undefined} attributes
 * @param {number} [limit]
 * @returns {{ name: string, value: string, redacted: boolean }[]}
 */
function sanitizeAttributes(attributes, limit = 16) {
  if (!attributes || typeof attributes !== "object") return [];
  const rows = [];
  for (const [rawName, rawValue] of Object.entries(attributes)) {
    if (rows.length >= limit) break;
    const name = compactScalar(rawName, 80);
    if (!name || name.startsWith("__vefg")) continue;
    const redacted = isSensitiveAttribute(name, rawValue);
    rows.push({
      name,
      value: redacted ? REDACTED_VALUE : compactScalar(rawValue, 200),
      redacted,
    });
  }
  return rows;
}

/**
 * Select only the computed styles that materially help locate visual changes.
 * @param {object | null | undefined} computedStyle
 * @returns {{ property: string, value: string }[]}
 */
function compactComputedStyles(computedStyle) {
  if (!computedStyle || typeof computedStyle !== "object") return [];
  const rows = [];
  for (const property of KEY_COMPUTED_STYLE_PROPS) {
    const rawValue = computedStyle[property];
    if (rawValue == null || rawValue === "") continue;
    const value = compactScalar(rawValue, 160);
    if (value) rows.push({ property, value });
  }
  return rows;
}

function finiteNumber(value) {
  if (value === undefined || value === null || value === "") return null;
  const parsed = Number(value);
  return Number.isFinite(parsed) ? parsed : null;
}

function sanitizePageUrl(value) {
  if (typeof value !== "string" || !value.trim()) return "";
  try {
    const url = new URL(value);
    if (url.username) url.username = REDACTED_VALUE;
    if (url.password) url.password = REDACTED_VALUE;
    for (const [name, paramValue] of url.searchParams) {
      if (isSensitiveAttribute(name, `${name}=${paramValue}`)) {
        url.searchParams.set(name, REDACTED_VALUE);
      }
    }
    if (SENSITIVE_ATTRIBUTE_VALUE.test(url.hash)) {
      url.hash = "#redacted";
    }
    return compactScalar(url.href, 500);
  } catch {
    return SENSITIVE_ATTRIBUTE_VALUE.test(value)
      ? REDACTED_VALUE
      : compactScalar(value, 500);
  }
}

function selectionViewport(selection) {
  const context = selection?.captureContext || selection?.context || {};
  const viewport = context.viewport || selection?.viewport || {};
  const scroll =
    context.scroll || viewport.scroll || selection?.scroll || {};
  const width = finiteNumber(
    viewport.width ?? viewport.innerWidth ?? selection?.viewportWidth,
  );
  const height = finiteNumber(
    viewport.height ?? viewport.innerHeight ?? selection?.viewportHeight,
  );
  const scrollX = finiteNumber(
    viewport.scrollX ??
      viewport.pageXOffset ??
      scroll.x ??
      scroll.scrollX ??
      selection?.scrollX,
  );
  const scrollY = finiteNumber(
    viewport.scrollY ??
      viewport.pageYOffset ??
      scroll.y ??
      scroll.scrollY ??
      selection?.scrollY,
  );
  const devicePixelRatio = finiteNumber(
    viewport.devicePixelRatio ??
      viewport.deviceScaleFactor ??
      viewport.dpr ??
      selection?.devicePixelRatio,
  );
  return { width, height, scrollX, scrollY, devicePixelRatio };
}

/**
 * Canonical representation of every page-controlled, non-geometric field
 * emitted in browser_element. Navigation, viewport and bounds are checked by
 * runtime-policy separately with numeric tolerances.
 *
 * @param {object | null | undefined} selection
 * @returns {string}
 */
function selectionContentFingerprint(selection) {
  if (!selection || typeof selection !== "object") return "";
  const className =
    selection.className ||
    (Array.isArray(selection.classes) ? selection.classes.join(" ") : "");
  return JSON.stringify({
    tag: compactScalar(selection.tag || "unknown", 80),
    domPath: compactScalar(
      selection.domPath || selection.selector || selection.tag || "(unknown)",
      800,
    ),
    id: compactScalar(selection.id || "", 200),
    className: compactScalar(className, 500),
    text: compactScalar(selection.text ?? "", 500),
    attributes: sanitizeAttributes(selection.attributes),
    pageTitle: compactScalar(selection.pageTitle || "", 300),
    selector: compactScalar(selection.selector || "", 800),
    computedStyles: compactComputedStyles(selection.computedStyle),
  });
}

/**
 * Pure paste payload builder for native Grok Build TUI.
 * Shape aligned with Cursor's browser_element + additive intent / style diffs.
 *
 * @param {{
 *   selection?: object | null,
 *   screenshotPath?: string | null,
 *   intent?: string | null,
 *   styleDiffs?: StyleDiffMap | null,
 * }} opts
 * @returns {string}
 */
function buildClipboardPayload(opts = {}) {
  const {
    selection,
    screenshotPath,
    intent,
    styleDiffs,
    pageFaults,
  } = opts;
  const lines = [];

  if (selection) {
    lines.push("@");
    lines.push("```browser_element");
    lines.push(
      "The user selected this node in the browser preview. A screenshot was captured at pick time (see browser_screenshot below / clipboard image).",
    );
    lines.push("");
    lines.push(`tag: ${compactScalar(selection.tag || "unknown", 80)}`);

    const path =
      selection.domPath || selection.selector || selection.tag || "(unknown)";
    lines.push(`dom_path: ${compactScalar(path, 800)}`);

    if (selection.id) {
      lines.push(`id: ${compactScalar(selection.id, 200)}`);
    }

    const className =
      selection.className ||
      (Array.isArray(selection.classes) ? selection.classes.join(" ") : "");
    if (className) {
      lines.push(`class: ${compactScalar(className, 500)}`);
    }

    if (selection.text != null && selection.text !== "") {
      lines.push(`visible_text: ${compactScalar(selection.text, 500)}`);
    }

    const box = selection.boundingBox || {};
    const top = box.top ?? box.y ?? 0;
    const left = box.left ?? box.x ?? 0;
    const width = box.width ?? 0;
    const height = box.height ?? 0;
    lines.push(
      `bounds_css_px: top=${top} left=${left} width=${width} height=${height}`,
    );

    const attributes = sanitizeAttributes(selection.attributes);
    if (attributes.length) {
      lines.push("attributes:");
      for (const attribute of attributes) {
        lines.push(`  ${attribute.name}=${attribute.value}`);
      }
    } else if (selection.id || className) {
      lines.push("attributes:");
      if (className) lines.push(`  class=${compactScalar(className, 500)}`);
      if (selection.id) lines.push(`  id=${compactScalar(selection.id, 200)}`);
    }

    const pageUrl =
      selection.captureContext?.pageUrl ||
      selection.context?.pageUrl ||
      selection.pageUrl;
    if (pageUrl) {
      lines.push(`page_url: ${sanitizePageUrl(pageUrl)}`);
    }
    if (selection.pageTitle) {
      lines.push(`page_title: ${compactScalar(selection.pageTitle, 300)}`);
    }
    if (selection.selector && selection.selector !== path) {
      lines.push(`css_selector: ${compactScalar(selection.selector, 800)}`);
    }

    const viewport = selectionViewport(selection);
    if (viewport.width != null && viewport.height != null) {
      lines.push(
        `viewport_css_px: width=${viewport.width} height=${viewport.height}`,
      );
    }
    if (viewport.scrollX != null && viewport.scrollY != null) {
      lines.push(`scroll_css_px: x=${viewport.scrollX} y=${viewport.scrollY}`);
    }
    if (viewport.devicePixelRatio != null) {
      lines.push(`device_pixel_ratio: ${viewport.devicePixelRatio}`);
    }

    const computedStyles = compactComputedStyles(selection.computedStyle);
    if (computedStyles.length) {
      lines.push("computed_styles:");
      for (const style of computedStyles) {
        lines.push(`  ${style.property}: ${style.value}`);
      }
    }

    lines.push("```");
    lines.push("");

    // Lazy require avoids circular load with agent-snapshot.cjs
    try {
      const { buildAgentSnapshot } = require("./agent-snapshot.cjs");
      const agentSnap = buildAgentSnapshot(selection);
      if (agentSnap) {
        lines.push("```agent_snapshot");
        lines.push(agentSnap);
        lines.push("```");
        lines.push("");
      }
    } catch {
      /* snapshot helper optional */
    }

    // browser-use PageInfo spirit: viewport/scroll/pixels above-below
    try {
      const {
        pageInfoFromSelection,
        formatPageInfoBlock,
      } = require("./page-context.cjs");
      const info = pageInfoFromSelection(selection);
      const pageUrl =
        selection.captureContext?.pageUrl ||
        selection.context?.pageUrl ||
        selection.pageUrl;
      const block = formatPageInfoBlock(info, {
        pageUrl,
        pageTitle: selection.pageTitle,
      });
      if (block) {
        lines.push("```page_info");
        lines.push(block);
        lines.push("```");
        lines.push("");
      }
    } catch {
      /* page-context optional */
    }
  } else {
    lines.push("@");
    lines.push("```browser_element");
    lines.push("No DOM node selected (screenshot-only or empty capture).");
    lines.push("```");
    lines.push("");
  }

  // browser-use browser_errors spirit: recent scrubbed preview faults
  try {
    const { formatPageFaultsBlock } = require("./page-context.cjs");
    const faultBody = formatPageFaultsBlock(pageFaults || []);
    if (faultBody) {
      lines.push("```page_faults");
      lines.push(faultBody);
      lines.push("```");
      lines.push("");
    }
  } catch {
    /* optional */
  }

  // playwright-mcp browser_network_requests spirit: compact method/status/url list
  try {
    const { formatNetworkRequestsBlock } = require("./page-context.cjs");
    const netBody = formatNetworkRequestsBlock(
      opts.networkRequests || [],
    );
    if (netBody) {
      lines.push("```network_requests");
      lines.push(netBody);
      lines.push("```");
      lines.push("");
    }
  } catch {
    /* optional */
  }

  const normalizedDiffs = normalizeStyleDiffs(styleDiffs);
  if (normalizedDiffs.length) {
    lines.push("```style_diff");
    lines.push(
      "Requested CSS changes (before → after). Apply these precisely in source.",
    );
    lines.push("");
    for (const row of normalizedDiffs) {
      lines.push(
        `${compactScalar(row.property, 80)}: ${compactScalar(row.before, 200)} → ${compactScalar(row.after, 200)}`,
      );
    }
    lines.push("```");
    lines.push("");
  }

  // Multi-line intent: break fences but keep newlines (do not use compactScalar).
  const intentText =
    typeof intent === "string"
      ? neutralizeFenceBreakers(intent.trim(), 1000)
      : "";
  if (intentText) {
    lines.push("```user_intent");
    lines.push(intentText);
    lines.push("```");
    lines.push("");
  }

  if (screenshotPath) {
    lines.push("```browser_screenshot");
    lines.push(`path: ${compactScalar(screenshotPath, 1000)}`);
    lines.push(
      "An image paste was attempted for this screenshot; attachment is not confirmed. If an image chip is visible, use its pixels. Otherwise use the local path or paste the clipboard image manually.",
    );
    lines.push("```");
    lines.push("");
  }

  // Final defense in depth: strip terminal control bytes from the complete
  // bracketed paste. ESC must never terminate bracketed-paste mode.
  return stripTerminalControls(lines.join("\n"));
}

/**
 * Normalize styleDiffs into ordered { property, before, after } rows.
 * Accepts:
 *   { fontSize: { before: "14px", after: "18px" } }
 *   { "font-size": { before: "14px", after: "18px" } }
 *   { color: "red" }  // after-only; before becomes "(current)"
 *
 * Skips rows where after is empty or after equals before.
 *
 * @param {StyleDiffMap | null | undefined} styleDiffs
 * @returns {{ property: string, before: string, after: string }[]}
 */
function normalizeStyleDiffs(styleDiffs) {
  if (!styleDiffs || typeof styleDiffs !== "object") return [];
  const rows = [];
  for (const [rawKey, rawVal] of Object.entries(styleDiffs)) {
    if (!rawKey) continue;
    const property = String(rawKey).trim();
    if (!property) continue;

    let before = "(current)";
    let after = "";

    if (rawVal == null) continue;
    if (typeof rawVal === "string") {
      after = rawVal.trim();
    } else if (typeof rawVal === "object") {
      if (rawVal.before != null && String(rawVal.before).trim() !== "") {
        before = String(rawVal.before).trim();
      }
      if (rawVal.after != null) {
        after = String(rawVal.after).trim();
      }
    } else {
      after = String(rawVal).trim();
    }

    if (!after) continue;
    if (before === after) continue;

    rows.push({ property, before, after });
  }
  return rows;
}

/** CSS props shown in the enrichment UI (camelCase matches getComputedStyle keys). */
const EDITABLE_STYLE_PROPS = [
  "color",
  "backgroundColor",
  "fontSize",
  "fontWeight",
  "padding",
  "margin",
  "width",
  "height",
  "borderRadius",
  "border",
  "opacity",
  "lineHeight",
];

/**
 * Prefill before values from selection.computedStyle for known props.
 * @param {object | null | undefined} selection
 * @returns {Record<string, { before: string, after: string }>}
 */
function prefillStyleDiffsFromSelection(selection) {
  const cs = selection?.computedStyle || {};
  /** @type {Record<string, { before: string, after: string }>} */
  const out = {};
  for (const prop of EDITABLE_STYLE_PROPS) {
    const before = cs[prop] != null ? String(cs[prop]) : "";
    out[prop] = { before, after: "" };
  }
  return out;
}

module.exports = {
  buildClipboardPayload,
  sanitizeAttributes,
  sanitizePageUrl,
  compactScalar,
  selectionContentFingerprint,
  compactComputedStyles,
  selectionViewport,
  stripTerminalControls,
  normalizeStyleDiffs,
  prefillStyleDiffsFromSelection,
  EDITABLE_STYLE_PROPS,
  KEY_COMPUTED_STYLE_PROPS,
  REDACTED_VALUE,
};
