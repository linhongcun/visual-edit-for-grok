/**
 * Pure Grok Build host adaptation policy (identity + multimodal paste + OSC 52).
 * No Electron / node-pty — unit-tested.
 *
 * Contracts from open-source Grok Build (ideas only, no source copy):
 * https://github.com/xai-org/grok-build
 * - TERM_PROGRAM brand detection (ghostty enables native Cmd chords)
 * - is_paste_key: Ctrl+V and Super+V
 * - Image-then-text clipboard ordering for reliable image chips
 */

/** Default spoof so Grok enables macOS Cmd+A / Super chords (Ghostty-class). */
const DEFAULT_TERM_PROGRAM = "ghostty";
const DEFAULT_TERM_PROGRAM_VERSION = "1.1.0";

/** Kitty progressive: Super alone = 1+8 = 9; code point for 'v' = 118. */
const KITTY_MOD_SUPER = 9;
const KITTY_KEY_V = 118;
/** Classic Ctrl+V control character (Grok paste key). */
const SEQ_CTRL_V = "\x16";
/** Kitty CSI-u Super+V (macOS Cmd+V paste for image chips). */
const SEQ_SUPER_V = `\x1b[${KITTY_KEY_V};${KITTY_MOD_SUPER}u`;

/** Default multimodal paste delays (ms) — pure plan source of truth. */
const DEFAULT_PASTE_DELAYS_MS = Object.freeze({
  focusSettleMs: 90,
  clipboardSettleMs: 60,
  afterCtrlVMs: 120,
  afterSuperVMs: 200,
  beforeTextMs: 80,
  afterTextMs: 40,
});
const PASTE_DELAY_MIN_MS = 0;
const PASTE_DELAY_MAX_MS = 5_000;

/** OSC 52 stream: max carry buffer across PTY chunks (bytes). */
const OSC52_MAX_BUFFER = 256_000;

const PARENT_BRANDS_TO_SPOOF = new Set([
  "",
  "apple_terminal",
  "appleterminal",
  "iterm.app",
  "iterm",
  "iterm2",
  "vscode",
  "electron",
  "unknown",
]);

const ALLOWED_PREFERRED = new Set([
  "ghostty",
  "grokdesktop",
  "kitty",
  "wezterm",
]);

/**
 * @param {unknown} value
 * @returns {string}
 */
function normalizeTermProgram(value) {
  return String(value || "")
    .trim()
    .toLowerCase()
    .replace(/[\s_\-.]/g, "");
}

/**
 * Resolve TERM_PROGRAM / VERSION for the embedded Grok PTY.
 *
 * @param {{
 *   parentTermProgram?: string | null,
 *   parentTermProgramVersion?: string | null,
 *   preferredBrand?: string | null,
 *   forceSpoof?: boolean,
 *   version?: string | null,
 * }} [input]
 * @returns {{
 *   termProgram: string,
 *   termProgramVersion: string,
 *   reason: string,
 *   spoofed: boolean,
 * }}
 */
function resolveGrokTermProgramIdentity(input = {}) {
  const preferredRaw = String(
    input.preferredBrand || process.env.VEFG_TERM_PROGRAM || "",
  ).trim();
  const preferredNorm = normalizeTermProgram(preferredRaw);
  if (preferredNorm && ALLOWED_PREFERRED.has(preferredNorm)) {
    const brand =
      preferredNorm === "grokdesktop"
        ? "grokdesktop"
        : preferredNorm === "kitty"
          ? "kitty"
          : preferredNorm === "wezterm"
            ? "WezTerm"
            : DEFAULT_TERM_PROGRAM;
    return {
      termProgram: brand === "WezTerm" ? "WezTerm" : brand,
      termProgramVersion: String(
        input.version || DEFAULT_TERM_PROGRAM_VERSION,
      ).slice(0, 32),
      reason: "preferred-override",
      spoofed: brand === DEFAULT_TERM_PROGRAM || brand === "grokdesktop",
    };
  }

  const parent = String(input.parentTermProgram || "").trim();
  const parentNorm = normalizeTermProgram(parent);
  const force = Boolean(input.forceSpoof);

  if (
    force ||
    !parent ||
    PARENT_BRANDS_TO_SPOOF.has(parentNorm) ||
    parentNorm === "electron"
  ) {
    return {
      termProgram: DEFAULT_TERM_PROGRAM,
      termProgramVersion: String(
        input.version || DEFAULT_TERM_PROGRAM_VERSION,
      ).slice(0, 32),
      reason: !parent
        ? "empty-parent"
        : force
          ? "force-spoof"
          : "spoof-weak-parent",
      spoofed: true,
    };
  }

  // Keep strong brands (ghostty/kitty/wezterm already set by parent/debug)
  if (
    parentNorm === "ghostty" ||
    parentNorm === "kitty" ||
    parentNorm === "wezterm" ||
    parentNorm === "grokdesktop"
  ) {
    return {
      termProgram: parent,
      termProgramVersion: String(
        input.parentTermProgramVersion ||
          input.version ||
          DEFAULT_TERM_PROGRAM_VERSION,
      ).slice(0, 32),
      reason: "keep-parent",
      spoofed: false,
    };
  }

  // Unknown parent: still spoof Ghostty for reliable Grok Cmd bindings in Electron
  return {
    termProgram: DEFAULT_TERM_PROGRAM,
    termProgramVersion: String(
      input.version || DEFAULT_TERM_PROGRAM_VERSION,
    ).slice(0, 32),
    reason: "spoof-unknown-parent",
    spoofed: true,
  };
}

/**
 * Sequences Grok accepts as paste keys (mirror is_paste_key CONTROL|SUPER + v).
 * @param {{ platform?: string }} [input]
 * @returns {{ ctrlV: string, superV: string | null, useSuperV: boolean }}
 */
function resolveGrokPasteKeySequences(input = {}) {
  const platform = String(input.platform || process.platform || "darwin");
  const useSuperV = platform === "darwin";
  return {
    ctrlV: SEQ_CTRL_V,
    superV: useSuperV ? SEQ_SUPER_V : null,
    useSuperV,
  };
}

/**
 * Plan multimodal delivery into Grok TUI (image chip then DOM text).
 *
 * @param {{
 *   platform?: string,
 *   imageCount?: number,
 *   hasText?: boolean,
 *   focusSettleMs?: number,
 *   clipboardSettleMs?: number,
 *   afterCtrlVMs?: number,
 *   afterSuperVMs?: number,
 *   beforeTextMs?: number,
 *   afterTextMs?: number,
 * }} [input]
 * @returns {{
 *   steps: Array<{
 *     kind: string,
 *     ms?: number,
 *     sequence?: string,
 *     imageIndex?: number,
 *     reason: string,
 *   }>,
 *   pasteKeys: { ctrlV: string, superV: string | null, useSuperV: boolean },
 *   terminalSetupHint: string,
 * }}
 */
function planGrokMultimodalPaste(input = {}) {
  const imageCount = Math.max(
    0,
    Math.min(8, Math.floor(Number(input.imageCount) || 0)),
  );
  const hasText = input.hasText !== false;
  const delays = resolvePasteDelayMs(input);
  const focusSettleMs = delays.focusSettleMs;
  const clipboardSettleMs = delays.clipboardSettleMs;
  const afterCtrlVMs = delays.afterCtrlVMs;
  const afterSuperVMs = delays.afterSuperVMs;
  const beforeTextMs = delays.beforeTextMs;
  const afterTextMs = delays.afterTextMs;
  const pasteKeys = resolveGrokPasteKeySequences({
    platform: input.platform,
  });

  /** @type {Array<{ kind: string, ms?: number, sequence?: string, imageIndex?: number, reason: string }>} */
  const steps = [];
  steps.push({
    kind: "delay",
    ms: focusSettleMs,
    reason: "focus-settle",
  });

  for (let i = 0; i < imageCount; i += 1) {
    steps.push({
      kind: "clipboard-image-only",
      imageIndex: i,
      reason: "image-only-no-text",
    });
    // Paste keys + image-scoped delays carry imageIndex so the host can skip
    // them when clipboard prep for that index failed (avoid stale paste).
    steps.push({
      kind: "delay",
      ms: clipboardSettleMs,
      imageIndex: i,
      reason: "clipboard-settle",
    });
    steps.push({
      kind: "write",
      sequence: pasteKeys.ctrlV,
      imageIndex: i,
      reason: "ctrl-v-paste",
    });
    steps.push({
      kind: "delay",
      ms: afterCtrlVMs,
      imageIndex: i,
      reason: "after-ctrl-v",
    });
    if (pasteKeys.useSuperV && pasteKeys.superV) {
      steps.push({
        kind: "write",
        sequence: pasteKeys.superV,
        imageIndex: i,
        reason: "super-v-paste",
      });
      steps.push({
        kind: "delay",
        ms: afterSuperVMs,
        imageIndex: i,
        reason: "after-super-v",
      });
    }
  }

  if (hasText) {
    steps.push({
      kind: "delay",
      ms: beforeTextMs,
      reason: "before-text",
    });
    steps.push({
      kind: "bracketed-paste-text",
      reason: "dom-context-text",
    });
    steps.push({
      kind: "delay",
      ms: afterTextMs,
      reason: "after-text",
    });
  }

  if (imageCount > 0) {
    steps.push({
      kind: "clipboard-image-restore",
      imageIndex: imageCount - 1,
      reason: "manual-cmdv-fallback",
    });
  }

  return {
    steps,
    pasteKeys,
    terminalSetupHint: TERMINAL_SETUP_HINT,
  };
}

const TERMINAL_SETUP_HINT =
  "Inside Grok TUI run /terminal-setup (aliases /terminal-check, /terminal-info) to verify truecolor, clipboard routes, and newline chords.";

/**
 * Whether a multimodal paste plan step may run given per-image prep results.
 * When clipboard-image-only fails for an index, skip Ctrl+V / Super+V (and
 * image-scoped delays / restore) so Grok does not receive a stale clipboard.
 *
 * @param {{
 *   kind?: string,
 *   reason?: string,
 *   imageIndex?: number,
 * }} step
 * @param {Record<number, boolean> | Map<number, boolean> | null | undefined} prepOkByIndex
 * @returns {{ ok: boolean, reason: string }}
 */
function mayExecuteGrokPasteStep(step, prepOkByIndex) {
  if (!step || typeof step !== "object") {
    return { ok: false, reason: "invalid-step" };
  }
  const kind = String(step.kind || "");
  const reason = String(step.reason || "");

  // Always allow focus settle and text path (independent of image prep)
  if (kind === "delay" && reason === "focus-settle") {
    return { ok: true, reason: "focus-settle" };
  }
  if (
    kind === "bracketed-paste-text" ||
    (kind === "delay" &&
      (reason === "before-text" || reason === "after-text"))
  ) {
    return { ok: true, reason: "text-path" };
  }

  // Prep step itself always runs (records success/failure into prep map)
  if (kind === "clipboard-image-only") {
    return { ok: true, reason: "prep" };
  }

  // Image-scoped steps require prepOk for that index
  if (
    typeof step.imageIndex === "number" &&
    Number.isFinite(step.imageIndex)
  ) {
    const idx = Math.floor(step.imageIndex);
    const ok =
      prepOkByIndex instanceof Map
        ? prepOkByIndex.get(idx) === true
        : Boolean(prepOkByIndex && prepOkByIndex[idx]);
    if (!ok) {
      return { ok: false, reason: "prep-failed" };
    }
  }

  return { ok: true, reason: "ok" };
}

/**
 * @param {unknown} value
 * @param {number} fallback
 * @returns {number}
 */
function clampDelay(value, fallback) {
  const n = Number(value);
  if (!Number.isFinite(n)) return fallback;
  return Math.min(
    PASTE_DELAY_MAX_MS,
    Math.max(PASTE_DELAY_MIN_MS, Math.round(n)),
  );
}

/**
 * Clamp all multimodal paste delays (pure source of truth for timing).
 * @param {{
 *   focusSettleMs?: number,
 *   clipboardSettleMs?: number,
 *   afterCtrlVMs?: number,
 *   afterSuperVMs?: number,
 *   beforeTextMs?: number,
 *   afterTextMs?: number,
 * }} [input]
 */
function resolvePasteDelayMs(input = {}) {
  const d = DEFAULT_PASTE_DELAYS_MS;
  return {
    focusSettleMs: clampDelay(input.focusSettleMs, d.focusSettleMs),
    clipboardSettleMs: clampDelay(input.clipboardSettleMs, d.clipboardSettleMs),
    afterCtrlVMs: clampDelay(input.afterCtrlVMs, d.afterCtrlVMs),
    afterSuperVMs: clampDelay(input.afterSuperVMs, d.afterSuperVMs),
    beforeTextMs: clampDelay(input.beforeTextMs, d.beforeTextMs),
    afterTextMs: clampDelay(input.afterTextMs, d.afterTextMs),
  };
}

/**
 * Extract complete OSC 52 clipboard payloads from a string (may be buffered).
 * Sequence: ESC ] 52 ; <pc> ; <base64> BEL  or  ESC ] 52 ; <pc> ; <base64> ESC \
 *
 * @param {string} chunk
 * @returns {Array<{ target: string, text: string }>}
 */
function extractOsc52ClipboardPayloads(chunk) {
  const s = String(chunk || "");
  if (!s.includes("\x1b]52;")) return [];
  const out = [];
  const re = /\x1b\]52;([^;]*);([^\x07\x1b]*)(?:\x07|\x1b\\)/g;
  let m;
  while ((m = re.exec(s)) !== null) {
    const target = String(m[1] || "c").slice(0, 8) || "c";
    const b64 = String(m[2] || "").replace(/\s+/g, "");
    if (!b64 || b64 === "?") continue; // query, not a set
    try {
      const text = Buffer.from(b64, "base64").toString("utf8");
      if (text) {
        out.push({ target, text: text.slice(0, 2_000_000) });
      }
    } catch {
      /* ignore bad base64 */
    }
  }
  return out;
}

/** OSC 52 introducer — frames may split mid-marker across PTY chunks. */
const OSC52_MARKER = "\x1b]52;";

/**
 * Strip complete OSC 52 frames; keep incomplete trailing start for next chunk.
 * @param {string} s
 * @returns {string}
 */
function stripCompleteOsc52Frames(s) {
  return String(s || "").replace(
    /\x1b\]52;[^;]*;[^\x07\x1b]*(?:\x07|\x1b\\)/g,
    "",
  );
}

/**
 * Retain only the carry needed for a future OSC 52 frame:
 * - full incomplete frame starting at last ESC]52;
 * - or longest suffix that is a proper prefix of ESC]52; (mid-header split)
 *
 * @param {string} buffer
 * @returns {string}
 */
function retainOsc52Carry(buffer) {
  const s = String(buffer || "");
  const start = s.lastIndexOf(OSC52_MARKER);
  if (start >= 0) {
    return s.slice(start);
  }
  // Mid-header: e.g. "\x1b]5" must survive until "2;c;…\x07" arrives
  const maxPrefix = OSC52_MARKER.length - 1;
  for (let len = Math.min(s.length, maxPrefix); len >= 1; len -= 1) {
    const suffix = s.slice(-len);
    if (OSC52_MARKER.startsWith(suffix)) {
      return suffix;
    }
  }
  return "";
}

/**
 * Push a PTY chunk into a carry buffer and extract complete OSC 52 payloads.
 * Handles frames split across chunks (including mid ESC]52; header).
 * Incomplete prefix is retained (bounded).
 *
 * @param {{ buffer?: string, maxBuffer?: number } | null | undefined} state
 * @param {string} chunk
 * @returns {{
 *   payloads: Array<{ target: string, text: string }>,
 *   buffer: string,
 * }}
 */
function pushOsc52Stream(state, chunk) {
  const maxBuffer = Math.max(
    1024,
    Math.min(2_000_000, Number(state?.maxBuffer) || OSC52_MAX_BUFFER),
  );
  let buffer = String(state?.buffer || "") + String(chunk || "");
  if (buffer.length > maxBuffer) {
    buffer = buffer.slice(-maxBuffer);
  }
  const payloads = extractOsc52ClipboardPayloads(buffer);
  if (payloads.length > 0) {
    buffer = stripCompleteOsc52Frames(buffer);
  }
  buffer = retainOsc52Carry(buffer);
  return { payloads, buffer };
}

/**
 * Snapshot for diagnostics / health.
 * @param {{
 *   identity?: ReturnType<typeof resolveGrokTermProgramIdentity>,
 *   platform?: string,
 * }} [input]
 */
function buildGrokHostDiagnosticBlock(input = {}) {
  const identity =
    input.identity ||
    resolveGrokTermProgramIdentity({
      parentTermProgram: process.env.TERM_PROGRAM,
      parentTermProgramVersion: process.env.TERM_PROGRAM_VERSION,
    });
  const pasteKeys = resolveGrokPasteKeySequences({
    platform: input.platform || process.platform,
  });
  const delays = resolvePasteDelayMs();
  return {
    termProgram: identity.termProgram,
    termProgramVersion: identity.termProgramVersion,
    identityReason: identity.reason,
    spoofed: identity.spoofed,
    pasteCtrlV: true,
    pasteSuperV: pasteKeys.useSuperV,
    pastePrepGate: true,
    pasteDelaysMs: delays,
    osc52Stream: true,
    terminalSetupHint: TERMINAL_SETUP_HINT,
  };
}

module.exports = {
  DEFAULT_TERM_PROGRAM,
  DEFAULT_TERM_PROGRAM_VERSION,
  DEFAULT_PASTE_DELAYS_MS,
  PASTE_DELAY_MIN_MS,
  PASTE_DELAY_MAX_MS,
  OSC52_MAX_BUFFER,
  SEQ_CTRL_V,
  SEQ_SUPER_V,
  TERMINAL_SETUP_HINT,
  normalizeTermProgram,
  resolveGrokTermProgramIdentity,
  resolveGrokPasteKeySequences,
  resolvePasteDelayMs,
  planGrokMultimodalPaste,
  mayExecuteGrokPasteStep,
  extractOsc52ClipboardPayloads,
  pushOsc52Stream,
  stripCompleteOsc52Frames,
  retainOsc52Carry,
  OSC52_MARKER,
  buildGrokHostDiagnosticBlock,
};
