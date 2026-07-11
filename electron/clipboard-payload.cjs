/**
 * Pure paste payload builder for native Grok Build TUI.
 * Shape aligned with Cursor's browser_element + additive intent / style diffs.
 *
 * @typedef {{ before?: string, after?: string }} StyleChange
 * @typedef {Record<string, StyleChange | string>} StyleDiffMap
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
  const { selection, screenshotPath, intent, styleDiffs } = opts;
  const lines = [];

  if (selection) {
    lines.push("@");
    lines.push("```browser_element");
    lines.push(
      "The user selected this node in the browser preview. A screenshot was captured at pick time (see browser_screenshot below / clipboard image).",
    );
    lines.push("");
    lines.push(`tag: ${selection.tag || "unknown"}`);

    const path =
      selection.domPath || selection.selector || selection.tag || "(unknown)";
    lines.push(`dom_path: ${path}`);

    if (selection.id) {
      lines.push(`id: ${selection.id}`);
    }

    const className =
      selection.className ||
      (Array.isArray(selection.classes) ? selection.classes.join(" ") : "");
    if (className) {
      lines.push(`class: ${className}`);
    }

    if (selection.text != null && selection.text !== "") {
      lines.push(`visible_text: ${selection.text}`);
    }

    const box = selection.boundingBox || {};
    const top = box.top ?? box.y ?? 0;
    const left = box.left ?? box.x ?? 0;
    const width = box.width ?? 0;
    const height = box.height ?? 0;
    lines.push(
      `bounds_css_px: top=${top} left=${left} width=${width} height=${height}`,
    );

    const attrs = selection.attributes || {};
    const attrKeys = Object.keys(attrs);
    if (attrKeys.length) {
      lines.push("attributes:");
      for (const k of attrKeys.slice(0, 16)) {
        lines.push(`  ${k}=${attrs[k]}`);
      }
    } else if (selection.id || className) {
      lines.push("attributes:");
      if (className) lines.push(`  class=${className}`);
      if (selection.id) lines.push(`  id=${selection.id}`);
    }

    if (selection.pageUrl) {
      lines.push(`page_url: ${selection.pageUrl}`);
    }
    if (selection.pageTitle) {
      lines.push(`page_title: ${selection.pageTitle}`);
    }
    if (selection.selector && selection.selector !== path) {
      lines.push(`css_selector: ${selection.selector}`);
    }

    lines.push("```");
    lines.push("");
  } else {
    lines.push("@");
    lines.push("```browser_element");
    lines.push("No DOM node selected (screenshot-only or empty capture).");
    lines.push("```");
    lines.push("");
  }

  const normalizedDiffs = normalizeStyleDiffs(styleDiffs);
  if (normalizedDiffs.length) {
    lines.push("```style_diff");
    lines.push(
      "Requested CSS changes (before → after). Apply these precisely in source.",
    );
    lines.push("");
    for (const row of normalizedDiffs) {
      lines.push(`${row.property}: ${row.before} → ${row.after}`);
    }
    lines.push("```");
    lines.push("");
  }

  const intentText = typeof intent === "string" ? intent.trim() : "";
  if (intentText) {
    lines.push("```user_intent");
    lines.push(intentText);
    lines.push("```");
    lines.push("");
  }

  if (screenshotPath) {
    lines.push("```browser_screenshot");
    lines.push(`path: ${screenshotPath}`);
    lines.push(
      "A screenshot was attached as a multimodal image chip (pasted into this prompt). Use the image pixels, not only this path.",
    );
    lines.push("```");
    lines.push("");
  }

  return lines.join("\n");
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
  normalizeStyleDiffs,
  prefillStyleDiffsFromSelection,
  EDITABLE_STYLE_PROPS,
};
