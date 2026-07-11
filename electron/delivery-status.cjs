/**
 * Pure status messages for capture → Grok delivery outcomes.
 * Used by main process and unit tests.
 *
 * @param {{
 *   terminalAlive: boolean,
 *   textPasted: boolean,
 *   imagePrepared: boolean,
 *   imageChipAttempted: boolean,
 * }} input
 * @returns {{
 *   pasted: boolean,
 *   imageChip: boolean,
 *   imagePrepared: boolean,
 *   fallback: string | null,
 *   statusMessage: string,
 * }}
 */
function buildPasteStatus(input) {
  const terminalAlive = Boolean(input.terminalAlive);
  const textPasted = Boolean(input.textPasted);
  const imagePrepared = Boolean(input.imagePrepared);
  const imageChipAttempted = Boolean(input.imageChipAttempted);

  if (!terminalAlive) {
    return {
      pasted: false,
      imageChip: false,
      imagePrepared,
      fallback: "clipboard-only",
      statusMessage:
        "Terminal not running — copied text+image. Start Grok, then click Re-send (or paste with ⌘V).",
    };
  }

  const pasted = textPasted || imageChipAttempted;
  let statusMessage = "";
  let fallback = null;

  if (pasted && imageChipAttempted) {
    statusMessage =
      "Sent to Grok (image chip attempted + DOM text). Type your change, then Enter.";
  } else if (pasted && !imageChipAttempted && imagePrepared) {
    statusMessage =
      "Text sent; image is on clipboard — press ⌘V in Grok if no image chip appeared.";
    fallback = "manual-image-paste";
  } else if (pasted) {
    statusMessage = "Text context sent to Grok. Type your change, then Enter.";
  } else {
    statusMessage =
      "Could not paste into terminal — text+image copied. Focus Grok and press ⌘V.";
    fallback = "clipboard-only";
  }

  return {
    pasted,
    imageChip: imageChipAttempted,
    imagePrepared,
    fallback,
    statusMessage,
  };
}

module.exports = { buildPasteStatus };
