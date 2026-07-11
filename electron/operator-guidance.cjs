/**
 * Pure operator guidance: actionable error codes + quit-confirm policy.
 * No Electron I/O — unit-tested with fixtures.
 */

const { t, normalizeLocale } = require("../i18n/index.cjs");

/**
 * @typedef {"preview-not-ready"|"preview-load-fail"|"grok-missing"|"grok-launch-fail"|"terminal-start-fail"|"nothing-to-resend"|"busy"|"invalid-url"|"capture-failed"|"unknown"} OperatorErrorCode
 */

/**
 * @type {Record<OperatorErrorCode, { messageKey: string, nextStepKey: string }>}
 */
const ERROR_GUIDANCE = {
  "preview-not-ready": {
    messageKey: "error.previewNotReady",
    nextStepKey: "error.next.preview",
  },
  "preview-load-fail": {
    messageKey: "error.previewLoadFail",
    nextStepKey: "error.next.preview",
  },
  "grok-missing": {
    messageKey: "error.grokMissing",
    nextStepKey: "error.next.grokInstall",
  },
  "grok-launch-fail": {
    messageKey: "error.grokLaunchFail",
    nextStepKey: "error.next.grokLaunch",
  },
  "terminal-start-fail": {
    messageKey: "error.terminalStartFail",
    nextStepKey: "error.next.terminal",
  },
  "nothing-to-resend": {
    messageKey: "error.nothingToResend",
    nextStepKey: "error.next.captureFirst",
  },
  busy: {
    messageKey: "error.busy",
    nextStepKey: "error.next.wait",
  },
  "invalid-url": {
    messageKey: "error.invalidUrl",
    nextStepKey: "error.next.url",
  },
  "capture-failed": {
    messageKey: "error.captureFailed",
    nextStepKey: "error.next.capture",
  },
  unknown: {
    messageKey: "error.unknown",
    nextStepKey: "error.next.generic",
  },
};

/**
 * Infer a stable error code from free-form messages / flags.
 * @param {{
 *   code?: string,
 *   message?: string,
 *   kind?: string,
 * }} input
 * @returns {OperatorErrorCode}
 */
function inferOperatorErrorCode(input = {}) {
  if (input.code && ERROR_GUIDANCE[input.code]) {
    return /** @type {OperatorErrorCode} */ (input.code);
  }
  const msg = String(input.message || "").toLowerCase();
  if (input.kind === "error" && !msg) return "unknown";

  if (
    /busy|in progress|capture in progress/.test(msg) ||
    input.code === "busy"
  ) {
    return "busy";
  }
  if (
    /nothing to re-send|nothing to resend|no capture|aim or frame first/.test(
      msg,
    )
  ) {
    return "nothing-to-resend";
  }
  if (
    /preview is not ready|preview not ready|open a loaded|wait for loading|screenshot is empty|preview changed/.test(
      msg,
    )
  ) {
    return "preview-not-ready";
  }
  if (/only http|invalid url|unsupported/.test(msg) && /url|http/.test(msg)) {
    return "invalid-url";
  }
  if (
    /node-pty|terminal failed|pty|failed to load|npm run rebuild|terminal not running/.test(
      msg,
    )
  ) {
    return "terminal-start-fail";
  }
  if (
    /grok.*(not found|missing|ENOENT|no such file)|cannot find.*grok|spawn.*grok/.test(
      msg,
    )
  ) {
    return "grok-missing";
  }
  if (/grok|launch/.test(msg) && /fail|error|exit/.test(msg)) {
    return "grok-launch-fail";
  }
  if (/couldn't capture|capture failed|could not capture/.test(msg)) {
    return "capture-failed";
  }
  if (/preview failed|failed to load|did-fail-load|err_/.test(msg)) {
    return "preview-load-fail";
  }
  return "unknown";
}

/**
 * Classify operator-facing failure into message + next-step keys.
 * Never claims a Grok image chip was confirmed.
 *
 * @param {{
 *   code?: string,
 *   message?: string,
 *   kind?: string,
 *   locale?: string,
 *   detail?: string,
 * }} input
 * @returns {{
 *   code: OperatorErrorCode,
 *   messageKey: string,
 *   nextStepKey: string,
 *   message: string,
 *   nextStep: string,
 *   text: string,
 *   confirmedChip: false,
 * }}
 */
function buildActionableError(input = {}) {
  const locale = normalizeLocale(input.locale || "en");
  const code = inferOperatorErrorCode(input);
  const keys = ERROR_GUIDANCE[code] || ERROR_GUIDANCE.unknown;
  const message = t(locale, keys.messageKey);
  const nextStep = t(locale, keys.nextStepKey);
  const detail =
    typeof input.detail === "string" && input.detail.trim()
      ? input.detail.trim()
      : "";
  const text = detail
    ? `${message} ${nextStep} (${detail})`
    : `${message} ${nextStep}`;

  // Honesty guard: guidance must not market a confirmed multimodal chip.
  if (/confirmed chip|chip confirmed/i.test(text)) {
    return {
      code: "unknown",
      messageKey: ERROR_GUIDANCE.unknown.messageKey,
      nextStepKey: ERROR_GUIDANCE.unknown.nextStepKey,
      message: t(locale, ERROR_GUIDANCE.unknown.messageKey),
      nextStep: t(locale, ERROR_GUIDANCE.unknown.nextStepKey),
      text: `${t(locale, ERROR_GUIDANCE.unknown.messageKey)} ${t(locale, ERROR_GUIDANCE.unknown.nextStepKey)}`,
      confirmedChip: false,
    };
  }

  return {
    code,
    messageKey: keys.messageKey,
    nextStepKey: keys.nextStepKey,
    message,
    nextStep,
    text,
    confirmedChip: false,
  };
}

/**
 * Whether closing the app should ask the user first.
 * Only when embedded **Grok** is running — a bare shell/PTY is not worth a dialog.
 *
 * @param {{
 *   sessionAlive?: boolean,
 *   shellAlive?: boolean,
 *   terminalAlive?: boolean,
 *   grokRunning?: boolean,
 *   anyGrokRunning?: boolean,
 * }} state
 * @returns {boolean}
 */
function shouldConfirmQuit(state = {}) {
  // Prefer explicit Grok liveness. Legacy shell-only flags must not block quit.
  return Boolean(state.grokRunning || state.anyGrokRunning);
}

/**
 * Short status labels for shell vs Grok (i18n keys only — UI still localizes).
 * Ready only when explicit ready is true.
 *
 * @param {{
 *   shellAlive?: boolean,
 *   grokState?: string,
 * }} input
 * @returns {{ shellLabelKey: string, grokLabelKey: string }}
 */
function statusLabelKeys(input = {}) {
  const shellLabelKey = input.shellAlive
    ? "status.shellOn"
    : "status.shellOff";
  const raw = String(input.grokState || "idle").toLowerCase();
  let grokLabelKey = "status.grokIdle";
  if (raw === "ready") grokLabelKey = "status.grokReady";
  else if (raw === "launching") grokLabelKey = "status.grokLaunching";
  else if (
    raw === "launch-requested" ||
    raw === "requested" ||
    raw === "running"
  ) {
    grokLabelKey = "status.grokRequested";
  } else if (raw === "exited" || raw === "stopped") {
    grokLabelKey = "status.grokExited";
  } else if (raw === "unknown") {
    grokLabelKey = "status.grokUnknown";
  }
  return { shellLabelKey, grokLabelKey };
}

module.exports = {
  ERROR_GUIDANCE,
  inferOperatorErrorCode,
  buildActionableError,
  shouldConfirmQuit,
  statusLabelKeys,
};
