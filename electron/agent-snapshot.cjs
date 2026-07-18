/**
 * Compact agent-readable element snapshot (agent-browser inspired).
 *
 * Ideas only — not a port of agent-browser Rust/CDP code.
 * Format: @eN [role] "name" + optional id/selector/path for the Aim target
 * and a small interactive neighborhood. Token-thrifty vs full DOM/outerHTML.
 */

const {
  compactScalar,
  sanitizeAttributes,
  sanitizePageUrl,
  stripTerminalControls,
} = require("./clipboard-payload.cjs");

/** Soft cap for the whole agent_snapshot body (characters). */
const MAX_SNAPSHOT_CHARS = 1800;
/** Max nearby interactive rows (excluding target). */
const MAX_NEIGHBORS = 6;
/** Max name/label length. */
const MAX_NAME = 80;

/**
 * Infer ARIA-like role from tag + attributes (best-effort, no AXTree).
 * @param {object | null | undefined} el
 * @returns {string}
 */
function inferRole(el) {
  if (!el || typeof el !== "object") return "generic";
  const attrs = el.attributes && typeof el.attributes === "object" ? el.attributes : {};
  const explicit =
    el.role ||
    attrs.role ||
    (typeof attrs["aria-role"] === "string" ? attrs["aria-role"] : "");
  if (explicit && String(explicit).trim()) {
    return compactScalar(String(explicit), 40).toLowerCase() || "generic";
  }
  const tag = String(el.tag || el.tagName || "generic").toLowerCase();
  if (tag === "a") return "link";
  if (tag === "button") return "button";
  if (tag === "input") {
    const type = String(attrs.type || el.type || "text").toLowerCase();
    if (type === "submit" || type === "button" || type === "reset") return "button";
    if (type === "checkbox") return "checkbox";
    if (type === "radio") return "radio";
    if (type === "password") return "textbox";
    return "textbox";
  }
  if (tag === "textarea") return "textbox";
  if (tag === "select") return "combobox";
  if (tag === "img") return "image";
  if (tag === "h1" || tag === "h2" || tag === "h3" || tag === "h4" || tag === "h5" || tag === "h6") {
    return "heading";
  }
  if (tag === "nav") return "navigation";
  if (tag === "main") return "main";
  if (tag === "header") return "banner";
  if (tag === "footer") return "contentinfo";
  if (tag === "form") return "form";
  if (tag === "label") return "label";
  if (tag === "summary") return "button";
  return tag || "generic";
}

/**
 * Visible / accessible name for the element.
 * @param {object | null | undefined} el
 * @returns {string}
 */
function accessibleName(el) {
  if (!el || typeof el !== "object") return "";
  const attrs = el.attributes && typeof el.attributes === "object" ? el.attributes : {};
  const candidates = [
    el.name,
    el.accessibleName,
    attrs["aria-label"],
    attrs["aria-labelledby"],
    attrs.title,
    attrs.placeholder,
    attrs.alt,
    el.text,
    el.innerText,
  ];
  for (const c of candidates) {
    if (c == null || c === "") continue;
    const s = compactScalar(c, MAX_NAME);
    if (s) return s;
  }
  return "";
}

/**
 * One line: @eN [role] "name" id=… type=…
 * @param {number} refNum 1-based
 * @param {object} el
 * @returns {string}
 */
function formatRefLine(refNum, el) {
  const role = inferRole(el);
  const name = accessibleName(el);
  const id = el.id ? compactScalar(el.id, 80) : "";
  const attrs = el.attributes && typeof el.attributes === "object" ? el.attributes : {};
  const type = attrs.type ? compactScalar(attrs.type, 40) : "";
  let line = `@e${refNum} [${role}]`;
  if (name) line += ` "${name}"`;
  if (id) line += ` id=${id}`;
  if (type && role === "textbox") line += ` type=${type}`;
  return line;
}

/**
 * Build compact agent snapshot text (no fence).
 *
 * @param {object | null | undefined} selection Aim selection or null
 * @param {{ maxChars?: number, maxNeighbors?: number }} [opts]
 * @returns {string} empty if nothing useful
 */
function buildAgentSnapshot(selection, opts = {}) {
  if (!selection || typeof selection !== "object") return "";
  // Need at least a tag, path, text, or role — empty {} is not a selection
  if (
    !selection.tag &&
    !selection.tagName &&
    !selection.domPath &&
    !selection.selector &&
    !selection.text &&
    !selection.role &&
    !selection.id
  ) {
    return "";
  }

  const maxChars = Math.max(400, Number(opts.maxChars) || MAX_SNAPSHOT_CHARS);
  const maxNeighbors = Math.min(
    MAX_NEIGHBORS,
    Math.max(0, Number(opts.maxNeighbors) || MAX_NEIGHBORS),
  );

  const lines = [];
  const pageTitle = compactScalar(selection.pageTitle || "", 120);
  const pageUrl = sanitizePageUrl(
    selection.captureContext?.pageUrl ||
      selection.context?.pageUrl ||
      selection.pageUrl ||
      "",
  );
  if (pageTitle) lines.push(`Page: ${pageTitle}`);
  if (pageUrl) lines.push(`URL: ${pageUrl}`);
  if (pageTitle || pageUrl) lines.push("");

  lines.push("Target:");
  lines.push(formatRefLine(1, selection));

  const path =
    selection.domPath || selection.selector || selection.tag || "";
  if (path) {
    lines.push(`  path: ${compactScalar(path, 200)}`);
  }
  if (selection.selector && selection.selector !== path) {
    lines.push(`  selector: ${compactScalar(selection.selector, 200)}`);
  }

  // Safe attribute peek (already redacted)
  const attrs = sanitizeAttributes(selection.attributes, 8);
  const interesting = attrs.filter(
    (a) =>
      !["class", "id", "style"].includes(a.name) || a.redacted,
  );
  if (interesting.length) {
    const parts = interesting
      .slice(0, 5)
      .map((a) => `${a.name}=${a.value}`)
      .join(" ");
    if (parts) lines.push(`  attrs: ${compactScalar(parts, 240)}`);
  }

  const neighbors = Array.isArray(selection.neighbors)
    ? selection.neighbors
    : Array.isArray(selection.nearby)
      ? selection.nearby
      : [];
  const near = neighbors
    .filter((n) => n && typeof n === "object")
    .slice(0, maxNeighbors);

  if (near.length) {
    lines.push("Nearby:");
    let ref = 2;
    for (const n of near) {
      lines.push(formatRefLine(ref, n));
      if (n.selector) {
        lines.push(`  selector: ${compactScalar(n.selector, 160)}`);
      }
      ref += 1;
    }
  }

  lines.push("");
  lines.push(
    "Refs (@eN) are host-local labels for this capture only — not live CDP handles.",
  );

  let body = stripTerminalControls(lines.join("\n")).trim();
  if (body.length > maxChars) {
    body = `${body.slice(0, maxChars - 1)}…`;
  }
  // Hard guard: never include raw markup. The previous /<\/?[a-zA-Z][^>]*>/g
  // regex stopped at the first ">" inside an attribute value (e.g.
  // `<a title="a>b">link</a>` → stripped `<a title="a>` and left `b">link</a>`),
  // leaking broken tags. Since this is defense-in-depth on already-sanitized
  // fields and the snapshot is plain text for an LLM (not rendered), when any
  // tag-like sequence is detected we strip the tag spans and then drop any
  // surviving angle brackets so no partial markup can leak through.
  if (body.includes("<") && /<\/?[a-zA-Z]/.test(body)) {
    body = body.replace(/<\/?[a-zA-Z][\s\S]*?>/g, "");
    // Second pass: a stray ">" from an attribute that contained ">" can remain;
    // remove any leftover angle brackets that survived tag stripping.
    body = body.replace(/[<>]/g, "");
  }
  return body;
}

/**
 * CSS injected around capturePage to hide native scrollbars (agent-browser default).
 * Exported for structural tests — must match main process usage.
 */
const HIDE_SCROLLBAR_CSS = [
  "html,body,*{scrollbar-width:none!important;}",
  "*::-webkit-scrollbar{display:none!important;width:0!important;height:0!important;background:transparent!important;}",
].join("");

/**
 * @param {{ hideScrollbars?: boolean } | null | undefined} opts
 * @returns {boolean}
 */
function shouldHideScrollbarsForCapture(opts) {
  if (!opts || typeof opts !== "object") return true;
  if (opts.hideScrollbars === false) return false;
  return true;
}

module.exports = {
  buildAgentSnapshot,
  inferRole,
  accessibleName,
  formatRefLine,
  shouldHideScrollbarsForCapture,
  HIDE_SCROLLBAR_CSS,
  MAX_SNAPSHOT_CHARS,
  MAX_NEIGHBORS,
};
