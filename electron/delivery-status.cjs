/**
 * Pure status messages for capture → Grok delivery outcomes.
 * Used by main process and unit tests.
 */
const { t, normalizeLocale } = require("../i18n/index.cjs");

/**
 * @param {{
 *   terminalAlive?: boolean,
 *   shellAlive?: boolean,
 *   grokRunning?: boolean,
 *   grokLaunchRequested?: boolean,
 *   textPasteAttempted?: boolean,
 *   textPasted: boolean,
 *   imagePrepared: boolean,
 *   imageChipAttempted: boolean,
 *   locale?: string,
 * }} input
 * @returns {{
 *   pasted: boolean,
 *   imageChip: boolean,
 *   imageChipAttempted: boolean,
 *   imageChipConfirmed: false,
 *   imagePrepared: boolean,
 *   shellAlive: boolean,
 *   grokLaunchRequested: boolean,
 *   grokRunning: boolean,
 *   grokReadiness: "unknown" | "not-running" | "unavailable",
 *   grokReady: null | false,
 *   deliveryAttempted: boolean,
 *   deliveryConfirmed: false,
 *   fallback: string | null,
 *   statusMessage: string,
 * }}
 */
function buildPasteStatus(input = {}) {
  const locale = normalizeLocale(input.locale || "en");
  // Backward compatibility: before shell/Grok state was split, terminalAlive
  // meant the currently running PTY could receive Grok input.
  const legacyTerminalAlive = Boolean(input.terminalAlive);
  const grokRunning =
    input.grokRunning == null
      ? legacyTerminalAlive
      : Boolean(input.grokRunning);
  const shellAlive =
    (input.shellAlive == null
      ? legacyTerminalAlive
      : Boolean(input.shellAlive)) || grokRunning;
  const grokLaunchRequested = Boolean(input.grokLaunchRequested);
  const textPasted = Boolean(input.textPasted);
  const textPasteAttempted =
    input.textPasteAttempted == null
      ? textPasted
      : Boolean(input.textPasteAttempted);
  const imagePrepared = Boolean(input.imagePrepared);
  const imageChipAttempted = Boolean(input.imageChipAttempted);
  const deliveryAttempted = textPasteAttempted || imageChipAttempted;

  const common = {
    imagePrepared,
    imageChipAttempted,
    // There is no Grok CLI acknowledgement today. Do not turn a Ctrl+V write
    // into a claim that a chip appeared or that Grok received the payload.
    imageChipConfirmed: false,
    imageChip: false,
    shellAlive,
    grokRunning,
    grokLaunchRequested,
    grokReadiness: grokRunning
      ? "unknown"
      : shellAlive
        ? "not-running"
        : "unavailable",
    grokReady: grokRunning ? null : false,
    deliveryAttempted,
    deliveryConfirmed: false,
  };

  if (!grokRunning) {
    return {
      ...common,
      pasted: false,
      fallback: "clipboard-only",
      statusMessage: shellAlive
        ? t(locale, "main.shellNoGrok")
        : t(locale, "main.termOff"),
    };
  }

  // Legacy field: `pasted` means bytes were accepted by the shell write path,
  // not that Grok acknowledged receipt. New consumers should use the explicit
  // attempted/confirmed fields above.
  const pasted = textPasted || imageChipAttempted;
  let statusMessage = "";
  let fallback = null;

  if (pasted && imageChipAttempted) {
    statusMessage = t(locale, "main.imageAttempted");
    fallback = "verify-image-paste";
  } else if (pasted && !imageChipAttempted && imagePrepared) {
    statusMessage = t(locale, "main.textImageClip");
    fallback = "manual-image-paste";
  } else if (pasted) {
    statusMessage = t(locale, "main.textOnly");
  } else {
    statusMessage = t(locale, "main.pasteFailed");
    fallback = "clipboard-only";
  }

  return {
    ...common,
    pasted,
    fallback,
    statusMessage,
  };
}

const buildDeliveryStatus = buildPasteStatus;

module.exports = { buildPasteStatus, buildDeliveryStatus };
