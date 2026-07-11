/**
 * Pure policy for the post-edit Verify workflow.
 * It compares the original Aim selection with a freshly resolved selection
 * without weakening the navigation-scoped capture rules used by Aim/Frame.
 */

const { compactComputedStyles, sanitizeAttributes, stripTerminalControls } = require("./clipboard-payload.cjs");
const { sanitizeHistoryUrl } = require("./privacy-policy.cjs");

function comparablePage(value) {
  return sanitizeHistoryUrl(value);
}

function canVerifyCapture(capture, currentContext) {
  const selection = capture?.selection || capture?.lastSelection || null;
  const beforePath = capture?.screenshotPath || capture?.lastScreenshotPath || null;
  const captureMeta = capture?.captureMeta || capture?.lastCaptureMeta || null;
  const context =
    typeof currentContext === "string"
      ? { url: currentContext }
      : currentContext && typeof currentContext === "object"
        ? currentContext
        : {};
  const pageUrl =
    selection?.captureContext?.pageUrl || selection?.pageUrl || capture?.pageUrl;
  if (!selection?.selector) return { ok: false, reason: "missing-selector" };
  if (!beforePath) return { ok: false, reason: "missing-before-image" };
  if (!comparablePage(pageUrl) || comparablePage(pageUrl) !== comparablePage(context.url)) {
    return { ok: false, reason: "page-changed" };
  }
  if (
    captureMeta?.viewportPreset &&
    context.viewportPreset &&
    captureMeta.viewportPreset !== context.viewportPreset
  ) {
    return { ok: false, reason: "viewport-changed" };
  }
  if (
    captureMeta?.viewportOrientation &&
    context.viewportOrientation &&
    captureMeta.viewportOrientation !== context.viewportOrientation
  ) {
    return { ok: false, reason: "viewport-changed" };
  }
  const beforeViewport = selection?.captureContext?.viewport;
  const currentViewport = context.viewport;
  if (beforeViewport && currentViewport) {
    const changed = ["width", "height"].some(
      (key) =>
        Number.isFinite(Number(beforeViewport[key])) &&
        Number.isFinite(Number(currentViewport[key])) &&
        Math.abs(Number(beforeViewport[key]) - Number(currentViewport[key])) > 1,
    );
    if (changed) return { ok: false, reason: "viewport-changed" };
  }
  return { ok: true, reason: null };
}

function finite(value) {
  const number = Number(value);
  return Number.isFinite(number) ? number : 0;
}

function normalizedBounds(selection) {
  const box = selection?.boundingBox || {};
  return {
    left: finite(box.left ?? box.x),
    top: finite(box.top ?? box.y),
    width: finite(box.width),
    height: finite(box.height),
  };
}

function rowsToObject(rows, keyName) {
  const result = {};
  for (const row of rows || []) result[row[keyName]] = row.value;
  return result;
}

function changedKeys(before, after) {
  const keys = new Set([...Object.keys(before || {}), ...Object.keys(after || {})]);
  return Array.from(keys).filter((key) => before?.[key] !== after?.[key]);
}

function compareSelections(before, after, tolerance = 1) {
  if (!after) {
    return {
      targetFound: false,
      changed: true,
      geometryChanged: false,
      textChanged: false,
      attributeChanges: [],
      styleChanges: [],
      summary: ["Target is no longer present."],
    };
  }

  const a = normalizedBounds(before);
  const b = normalizedBounds(after);
  const delta = {
    left: b.left - a.left,
    top: b.top - a.top,
    width: b.width - a.width,
    height: b.height - a.height,
  };
  const geometryChanged = Object.values(delta).some(
    (value) => Math.abs(value) > Math.max(0, tolerance),
  );
  const beforeText = String(before?.text || "").trim();
  const afterText = String(after?.text || "").trim();
  const textChanged = beforeText !== afterText;
  const beforeAttributes = rowsToObject(sanitizeAttributes(before?.attributes), "name");
  const afterAttributes = rowsToObject(sanitizeAttributes(after?.attributes), "name");
  const attributeChanges = changedKeys(beforeAttributes, afterAttributes);
  const beforeStyles = rowsToObject(compactComputedStyles(before?.computedStyle), "property");
  const afterStyles = rowsToObject(compactComputedStyles(after?.computedStyle), "property");
  const styleChanges = changedKeys(beforeStyles, afterStyles).map((property) => ({
    property,
    before: beforeStyles[property] ?? "(unset)",
    after: afterStyles[property] ?? "(unset)",
  }));
  const identityChanged =
    String(before?.tag || "") !== String(after?.tag || "") ||
    String(before?.id || "") !== String(after?.id || "") ||
    String(before?.className || "") !== String(after?.className || "");

  const summary = [];
  if (geometryChanged) {
    summary.push(
      `Geometry changed: x ${delta.left >= 0 ? "+" : ""}${delta.left}px, y ${delta.top >= 0 ? "+" : ""}${delta.top}px, width ${delta.width >= 0 ? "+" : ""}${delta.width}px, height ${delta.height >= 0 ? "+" : ""}${delta.height}px.`,
    );
  }
  if (textChanged) summary.push("Visible text changed.");
  if (identityChanged) summary.push("Element identity changed.");
  if (attributeChanges.length) summary.push(`Attributes changed: ${attributeChanges.join(", ")}.`);
  if (styleChanges.length) summary.push(`Computed styles changed: ${styleChanges.map((row) => row.property).join(", ")}.`);
  if (!summary.length) summary.push("No tracked DOM, geometry, or style changes detected.");

  return {
    targetFound: true,
    changed:
      geometryChanged ||
      textChanged ||
      identityChanged ||
      attributeChanges.length > 0 ||
      styleChanges.length > 0,
    geometryChanged,
    geometryDelta: delta,
    textChanged,
    identityChanged,
    attributeChanges,
    styleChanges,
    summary,
  };
}

function buildVerificationPayload(verification = {}) {
  const lines = [
    "@",
    "```browser_verification",
    "Post-edit verification for the earlier visual capture.",
    `result: ${verification.targetFound === false ? "target-missing" : verification.changed ? "changed" : "no-tracked-change"}`,
  ];
  if (verification.beforePath) lines.push(`before: ${verification.beforePath}`);
  if (verification.afterPath) lines.push(`after: ${verification.afterPath}`);
  if (verification.pageUrl) lines.push(`page_url: ${verification.pageUrl}`);
  for (const item of verification.summary || []) lines.push(`- ${item}`);
  lines.push("Review the before/after images and the changes above. Fix any remaining mismatch.");
  lines.push("```");
  return stripTerminalControls(lines.join("\n"));
}

module.exports = {
  comparablePage,
  canVerifyCapture,
  normalizedBounds,
  compareSelections,
  buildVerificationPayload,
};
