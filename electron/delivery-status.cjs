/**
 * Pure status messages + delivery outcome classification for capture → Grok.
 * Used by main process and unit tests. Never claims a Grok image chip was confirmed.
 */
const { t, normalizeLocale } = require("../i18n/index.cjs");

/** @typedef {"image-attempted"|"text-attempted"|"clipboard-only"|"local-only"|"failed"|"unknown"} DeliveryOutcomeKind */

/**
 * Stable outcome kinds for receipt/UI (short labels). Does not claim chip confirmation.
 *
 * @param {{
 *   kind?: string,
 *   message?: string,
 *   error?: boolean,
 *   terminalAlive?: boolean,
 *   shellAlive?: boolean,
 *   grokRunning?: boolean,
 *   textPasteAttempted?: boolean,
 *   textPasted?: boolean,
 *   pastedToTerminal?: boolean,
 *   imagePrepared?: boolean,
 *   imageChipAttempted?: boolean,
 *   imageChip?: boolean,
 *   imageChipConfirmed?: boolean,
 *   deliveryAttempted?: boolean,
 *   deliveryConfirmed?: boolean,
 *   copied?: boolean,
 *   fallback?: string | null,
 *   hasImage?: boolean,
 * }} input
 * @returns {{
 *   kind: DeliveryOutcomeKind,
 *   confirmedChip: false,
 *   labelKey: string,
 * }}
 */
function classifyDeliveryOutcome(input = {}) {
  // Explicit honesty: never surface confirmedChip as true from this classifier.
  const confirmedChip = false;

  if (input.kind === "error" || input.error === true) {
    return {
      kind: "failed",
      confirmedChip,
      labelKey: "delivery.kind.failed",
    };
  }

  const imageChipAttempted = Boolean(
    input.imageChipAttempted ||
      // Legacy: some paths set imageChip when a paste write was attempted
      (input.imageChip &&
        (input.pastedToTerminal ||
          input.deliveryAttempted ||
          input.textPasted)),
  );

  if (imageChipAttempted) {
    return {
      kind: "image-attempted",
      confirmedChip,
      labelKey: "delivery.kind.imageAttempted",
    };
  }

  const textAttempted = Boolean(
    input.deliveryAttempted ||
      input.pastedToTerminal ||
      input.textPasted ||
      input.textPasteAttempted,
  );

  if (textAttempted) {
    return {
      kind: "text-attempted",
      confirmedChip,
      labelKey: "delivery.kind.textAttempted",
    };
  }

  if (
    input.fallback === "clipboard-only" ||
    input.fallback === "manual-image-paste" ||
    input.copied === true
  ) {
    return {
      kind: "clipboard-only",
      confirmedChip,
      labelKey: "delivery.kind.clipboardOnly",
    };
  }

  // Screenshot on disk (or prepared) without paste/clipboard sink
  if (input.hasImage || input.imagePrepared || input.screenshotPath) {
    return {
      kind: "local-only",
      confirmedChip,
      labelKey: "delivery.kind.localOnly",
    };
  }

  return {
    kind: "unknown",
    confirmedChip,
    labelKey: "delivery.kind.unknown",
  };
}

/**
 * Short localized label for a classified outcome (never “chip confirmed”).
 * @param {DeliveryOutcomeKind | string} kind
 * @param {string} [locale]
 */
function deliveryOutcomeLabel(kind, locale = "en") {
  const loc = normalizeLocale(locale);
  const keyMap = {
    "image-attempted": "delivery.kind.imageAttempted",
    "text-attempted": "delivery.kind.textAttempted",
    "clipboard-only": "delivery.kind.clipboardOnly",
    "local-only": "delivery.kind.localOnly",
    failed: "delivery.kind.failed",
    unknown: "delivery.kind.unknown",
  };
  const key = keyMap[kind] || "delivery.kind.unknown";
  const label = t(loc, key);
  // Safety net: never allow marketing language about confirmed chips
  if (/\bconfirmed\b/i.test(label) && /chip/i.test(label)) {
    return t(loc, "delivery.kind.imageAttempted");
  }
  return label;
}

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
 *   imagesWanted?: number,
 *   imagePrepOkCount?: number,
 *   locale?: string,
 *   copied?: boolean,
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
 *   deliveryOutcome: DeliveryOutcomeKind,
 *   deliveryOutcomeLabel: string,
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
  const imagesWanted = Math.max(
    0,
    Math.floor(Number(input.imagesWanted) || 0),
  );
  const imagePrepOkCount = Math.max(
    0,
    Math.floor(
      Number(input.imagePrepOkCount) || (imagePrepared ? 1 : 0),
    ),
  );
  const deliveryAttempted = textPasteAttempted || imageChipAttempted;

  const common = {
    imagePrepared,
    imageChipAttempted,
    imagesWanted,
    imagePrepOkCount,
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
    const outcome = classifyDeliveryOutcome({
      ...common,
      copied: true,
      fallback: "clipboard-only",
      textPasteAttempted: false,
      textPasted: false,
      pastedToTerminal: false,
      imageChipAttempted: false,
    });
    return {
      ...common,
      pasted: false,
      fallback: "clipboard-only",
      statusMessage: shellAlive
        ? t(locale, "main.shellNoGrok")
        : t(locale, "main.termOff"),
      deliveryOutcome: outcome.kind,
      deliveryOutcomeLabel: deliveryOutcomeLabel(outcome.kind, locale),
    };
  }

  // Legacy field: `pasted` means bytes were accepted by the shell write path,
  // not that Grok acknowledged receipt. New consumers should use the explicit
  // attempted/confirmed fields above.
  const pasted = textPasted || imageChipAttempted;
  let statusMessage = "";
  let fallback = null;

  // Wanted images but prep failed for all → never imply an image paste ran
  const allImagePrepFailed =
    imagesWanted > 0 && imagePrepOkCount === 0 && !imageChipAttempted;

  if (allImagePrepFailed) {
    if (textPasted || textPasteAttempted) {
      statusMessage = t(locale, "main.imagePrepFailedTextOk");
      fallback = "manual-image-paste";
    } else {
      statusMessage = t(locale, "main.imagePrepFailedManual");
      fallback = "clipboard-only";
    }
  } else if (pasted && imageChipAttempted) {
    statusMessage = t(locale, "main.imageAttempted");
    fallback = "verify-image-paste";
  } else if (pasted && !imageChipAttempted && imagePrepared) {
    // Prep ok but no paste key inject (unexpected) — still honest
    statusMessage = t(locale, "main.textImageClip");
    fallback = "manual-image-paste";
  } else if (!pasted && imagePrepared && !imageChipAttempted && imagesWanted > 0) {
    statusMessage = t(locale, "main.imageWantedNoInject");
    fallback = "manual-image-paste";
  } else if (pasted) {
    statusMessage = t(locale, "main.textOnly");
  } else {
    statusMessage = t(locale, "main.pasteFailed");
    fallback = "clipboard-only";
  }

  const outcome = classifyDeliveryOutcome({
    ...common,
    pastedToTerminal: pasted,
    textPasted,
    textPasteAttempted,
    // Do not classify as image-attempted when we never injected paste keys
    imageChipAttempted: allImagePrepFailed ? false : imageChipAttempted,
    imagePrepared: allImagePrepFailed ? false : imagePrepared,
    fallback,
    copied: Boolean(fallback) || pasted,
    hasImage: imagesWanted > 0 || imagePrepared,
  });

  return {
    ...common,
    pasted,
    fallback,
    statusMessage,
    deliveryOutcome: outcome.kind,
    deliveryOutcomeLabel: deliveryOutcomeLabel(outcome.kind, locale),
  };
}

const buildDeliveryStatus = buildPasteStatus;

module.exports = {
  buildPasteStatus,
  buildDeliveryStatus,
  classifyDeliveryOutcome,
  deliveryOutcomeLabel,
};
