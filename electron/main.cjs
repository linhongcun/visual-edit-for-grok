const {
  app,
  BrowserWindow,
  WebContentsView,
  ipcMain,
  clipboard,
  nativeImage,
  shell,
  dialog,
  Menu,
} = require("electron");
const path = require("path");
const fs = require("fs");
const os = require("os");
const crypto = require("crypto");
const { pathToFileURL } = require("url");
const { execFile } = require("child_process");
const { buildClipboardPayload } = require("./clipboard-payload.cjs");
const { TerminalSession } = require("./terminal.cjs");
const {
  MAX_TERMINAL_SESSIONS,
  labelFromCwd,
  createSessionMeta,
  canCreateSession,
  nextActiveAfterClose,
  normalizeSessionList,
  sessionsSnapshot,
  shouldConfirmCloseTab,
} = require("./terminal-hub.cjs");
const {
  loadSettings,
  saveSettings,
  defaultSettingsPath,
} = require("./settings-store.cjs");
const { cleanupCaptureDir } = require("./capture-cleanup.cjs");
const {
  copyFileToMacClipboard,
  ensurePrivateDirectory,
  writePrivatePng,
} = require("./capture-io.cjs");
const {
  createCoordinatorState,
  getSessionState,
  freezeCaptureTarget,
  resolveCaptureRoute,
  commitCapture,
  commitVerifyPair,
  clearSessionCapture,
  updateSessionWorkspace,
} = require("./capture-coordinator.cjs");
const {
  VIEWPORT_PRESETS,
  normalizeViewportPreset,
  viewportPresetSnapshot,
  deviceEmulationPlan,
} = require("./viewport-presets.cjs");
const {
  canVerifyCapture,
  compareSelections,
  buildVerificationPayload,
} = require("./verify-policy.cjs");
const {
  sanitizeHistoryUrl,
  sanitizeHistoryUrls,
  evaluateDownloadPolicy,
  buildPreviewSessionPolicy,
  buildPreviewDataClearPlan,
} = require("./privacy-policy.cjs");
const { formatDiagnosticSummary } = require("./diagnostics.cjs");
const {
  buildPasteStatus,
  classifyDeliveryOutcome,
  deliveryOutcomeLabel,
} = require("./delivery-status.cjs");
const { t, normalizeLocale, detectLocale } = require("../i18n/index.cjs");
const {
  buildActionableError,
  shouldConfirmQuit,
} = require("./operator-guidance.cjs");
const {
  canStartCapture,
  shouldRunCleanup,
  shouldFlushSettings,
  focusHandoffDelays,
  planAimPickEvent,
  validateAimEvent,
  stampSelectionContext,
  samePreviewIdentity,
  planFrameCapture,
  evaluateSelectionStability,
  resolvePickCommit,
  computeWorkspaceLayout,
  DEFAULT_CLEANUP_MIN_INTERVAL_MS,
  DEFAULT_SETTINGS_DEBOUNCE_MS,
} = require("./runtime-policy.cjs");
const { resolveGrokBinary } = require("./terminal.cjs");

function delay(ms) {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

function settingsFile() {
  try {
    return defaultSettingsPath(app.getPath("userData"));
  } catch {
    return path.join(os.homedir(), ".grok", "visual-capture-settings.json");
  }
}

/** Immediate settings write (URL, cwd, final split flush). */
function persist(partial) {
  try {
    const next = saveSettings(settingsFile(), partial);
    lastSettingsFlushAt = Date.now();
    settingsDirty = false;
    return next;
  } catch (err) {
    console.warn("persist settings failed:", err);
    return null;
  }
}

/**
 * Debounced persist for high-frequency updates (splitter drag).
 * Layout always applies immediately; disk flush is throttled unless force.
 */
function persistDebounced(partial, { force = false } = {}) {
  if (partial && typeof partial === "object") {
    Object.assign(pendingSettingsPartial, partial);
    settingsDirty = true;
  }
  const decision = shouldFlushSettings({
    lastFlushAt: lastSettingsFlushAt,
    now: Date.now(),
    minIntervalMs: DEFAULT_SETTINGS_DEBOUNCE_MS,
    force,
    dirty: settingsDirty,
  });
  if (!decision.flush) {
    if (settingsFlushTimer) clearTimeout(settingsFlushTimer);
    settingsFlushTimer = setTimeout(() => {
      settingsFlushTimer = null;
      persistDebounced({}, { force: true });
    }, DEFAULT_SETTINGS_DEBOUNCE_MS);
    return null;
  }
  if (settingsFlushTimer) {
    clearTimeout(settingsFlushTimer);
    settingsFlushTimer = null;
  }
  const batch = { ...pendingSettingsPartial };
  pendingSettingsPartial = {};
  return persist(batch);
}

function applyLoadedSettings() {
  const s = loadSettings(settingsFile());
  if (s.previewUrl) previewUrl = s.previewUrl;
  if (s.projectCwd && fs.existsSync(s.projectCwd)) {
    projectCwd = s.projectCwd;
  }
  if (typeof s.splitRatio === "number") splitRatio = s.splitRatio;
  if (typeof s.previewCollapsed === "boolean") {
    previewCollapsed = s.previewCollapsed;
  }
  viewportPresetId = normalizeViewportPreset(s.viewportPreset);
  viewportOrientation = s.viewportOrientation === "landscape" ? "landscape" : "portrait";
  privateMode = Boolean(s.privateMode);
  // Empty locale = first run → detect system language and persist
  if (s.locale === "en" || s.locale === "zh") {
    uiLocale = s.locale;
  } else {
    try {
      uiLocale = detectLocale(app.getLocale?.() || "");
    } catch {
      uiLocale = detectLocale("");
    }
    persist({ locale: uiLocale });
  }
  recentPreviewUrls = sanitizeHistoryUrls(s.recentPreviewUrls, 8);
  recentProjectCwds = Array.isArray(s.recentProjectCwds)
    ? s.recentProjectCwds.filter((cwd) => isDirectory(cwd))
    : [];
  seedTerminalsFromSettings(s);
  return s;
}

/** @param {string} key @param {Record<string, string | number>} [vars] */
function tr(key, vars) {
  return t(uiLocale, key, vars);
}

/** @param {string | { code?: string, message?: string, detail?: string }} err */
function actionableError(err) {
  if (typeof err === "string") {
    return buildActionableError({ message: err, locale: uiLocale });
  }
  return buildActionableError({
    code: err?.code,
    message: err?.message,
    detail: err?.detail,
    locale: uiLocale,
  });
}

async function grokBinaryExists() {
  const bin = resolveGrokBinary();
  if (bin !== "grok" && fs.existsSync(bin)) return { ok: true, path: bin };
  return new Promise((resolve) => {
    execFile(
      process.platform === "win32" ? "where" : "which",
      ["grok"],
      { encoding: "utf8", timeout: 2000 },
      (error, stdout) => {
        if (!error) {
          const located = String(stdout || "")
            .split(/\r?\n/)
            .map((value) => value.trim())
            .filter(Boolean)[0];
          if (located && fs.existsSync(located)) {
            resolve({ ok: true, path: located });
            return;
          }
        }
        resolve({ ok: false, path: bin });
      },
    );
  });
}

/** Prevent double-dispose / re-entrant quit dialogs */
let isQuitting = false;
let quitDialogOpen = false;

/**
 * @param {import('electron').Event} event
 * @param {"close"|"quit"} reason
 */
function requestQuitConfirmation(event, reason = "close") {
  if (isQuitting) return false;
  const runtime = listTerminalRuntime();
  const grokRunning = runtime.some((s) => s.grokRunning);
  // Shell-only tabs: quit immediately. Confirm only when Grok is actually up.
  if (!shouldConfirmQuit({ grokRunning, anyGrokRunning: grokRunning })) {
    return false;
  }
  event.preventDefault();
  if (quitDialogOpen) return true;
  quitDialogOpen = true;
  const win =
    mainWindow && !mainWindow.isDestroyed() ? mainWindow : undefined;
  void dialog
    .showMessageBox(win, {
      type: "question",
      buttons: [tr("quit.leave"), tr("quit.stay")],
      defaultId: 1,
      cancelId: 1,
      message: tr("quit.message"),
      detail: tr("quit.detail"),
      noLink: true,
    })
    .then(({ response }) => {
      quitDialogOpen = false;
      if (response === 0) {
        isQuitting = true;
        disposeAllTerminals();
        app.quit();
      }
    })
    .catch(() => {
      quitDialogOpen = false;
    });
  return true;
}

function setUiLocale(next) {
  uiLocale = normalizeLocale(next);
  persist({ locale: uiLocale });
  sendToRenderer("app:locale", { locale: uiLocale });
  // Refresh welcome page copy if currently on the guide
  try {
    const url = previewView?.webContents?.getURL?.() || "";
    if (url.includes("welcome.html")) {
      loadWelcomePreview();
    }
  } catch {
    /* ignore */
  }
  return uiLocale;
}

const isDev = process.env.VEFG_DEV === "1";
// Keep in sync with src/styles.css --toolbar-height / --preview-chrome-height
const TOOLBAR_HEIGHT = 96;
/** URL + capture actions live in the preview pane chrome (collapse with page) */
const PREVIEW_CHROME_HEIGHT = 44;
const SPLITTER_WIDTH = 5;
// Wider floor so Grok TUI tables keep more columns when the split is tight
const MIN_TERMINAL_WIDTH = 400;
// A narrower pane cannot keep URL navigation and capture controls usable.
const MIN_PREVIEW_WIDTH = 600;

/** Packaged .app vs `electron .` / vite dev */
function isPackagedApp() {
  try {
    return Boolean(app.isPackaged);
  } catch {
    return false;
  }
}

/** Finder-launched apps often have cwd=/ — use home as a safe default. */
function defaultProjectCwd() {
  if (isPackagedApp()) return os.homedir();
  const cwd = process.cwd();
  if (cwd && cwd !== "/" && fs.existsSync(cwd)) return cwd;
  return os.homedir();
}

/** @type {BrowserWindow | null} */
let mainWindow = null;
/** @type {WebContentsView | null} */
let previewView = null;
/**
 * Multi-terminal slots: metadata + TerminalSession (PTY wrapper).
 * @type {Map<string, { meta: { id: string, cwd: string, label: string, createdAt: number }, pty: TerminalSession }>}
 */
const terminalSlots = new Map();
/** @type {string | null} */
let activeTerminalId = null;

let pickMode = false;
let previewUrl = "";
/** @type {object | null} */
let lastSelection = null;
/** @type {string | null} */
let lastScreenshotPath = null;
/** @type {object | null} */
let lastCaptureMeta = null;
/** @type {object | null} */
let lastVerifyPair = null;
/** Left pane ratio 0–1 */
let splitRatio = 0.52;
/** Hide preview WebContentsView + URL chrome; terminal uses full width */
let previewCollapsed = false;
/** @type {"en" | "zh"} */
let uiLocale = "en";
/** Mirrors the active terminal's project folder */
let projectCwd = defaultProjectCwd();
/** Auto-paste capture into terminal */
let autoPasteTerminal = true;
let preferredFrameMode = "viewport";
let viewportPresetId = "fit";
let viewportOrientation = "portrait";
let privateMode = false;
const privatePreviewUrls = new Map();
let recentPreviewUrls = [];
let recentProjectCwds = [];
/** Navigation-scoped capability for the isolated preview picker preload. */
let previewNavigationId = 0;
let previewPickerToken = crypto.randomUUID();
let previewLoading = false;
let previewError = null;
/** @type {Map<string, { resolve: (value: object | null) => void, timer: ReturnType<typeof setTimeout> }>} */
const pendingPreviewResolutions = new Map();

/** Single-flight: one capture/deliver at a time */
let captureInFlight = false;
let captureTargetSessionId = null;
/** Throttle capture-dir cleanup off the critical path */
let lastCleanupAt = 0;
/** @type {ReturnType<typeof setTimeout> | null} */
let cleanupTimer = null;
/** Debounced settings disk writes */
let lastSettingsFlushAt = 0;
let settingsDirty = false;
/** @type {Record<string, unknown>} */
let pendingSettingsPartial = {};
/** @type {ReturnType<typeof setTimeout> | null} */
let settingsFlushTimer = null;
/** Coordinated focus handoff timers (single owner) */
/** @type {ReturnType<typeof setTimeout>[]} */
let focusHandoffTimers = [];

const CAPTURE_DIR = path.join(os.homedir(), ".grok", "visual-edit-captures");
const configuredPreviewSessions = new WeakSet();

function ensureCaptureDir() {
  fs.mkdirSync(CAPTURE_DIR, { recursive: true, mode: 0o700 });
  try {
    fs.chmodSync(CAPTURE_DIR, 0o700);
  } catch {
    // Best effort for platforms that do not expose POSIX permissions.
  }
}

function setCaptureBusy(busy) {
  captureInFlight = Boolean(busy);
  if (!captureInFlight) captureTargetSessionId = null;
  sendToRenderer("capture:busy", { busy: captureInFlight });
}

/**
 * Run exclusive capture/deliver work. Rejects concurrent callers with busy status.
 * @template T
 * @param {() => Promise<T>} fn
 * @returns {Promise<T | { busy: true, statusMessage: string }>}
 */
async function withCaptureLock(fn) {
  const gate = canStartCapture({ inFlight: captureInFlight });
  if (!gate.ok) {
    // Always use actionable busy text (message + next step), not bare main.busy
    const busyText = actionableError({ code: "busy" }).text;
    return {
      busy: true,
      statusMessage: busyText,
    };
  }
  setCaptureBusy(true);
  try {
    return await fn();
  } finally {
    setCaptureBusy(false);
  }
}

/** Busy / single-flight user message with next-step guidance. */
function busyActionableText() {
  return actionableError({ code: "busy" }).text;
}

function assertSessionMutationAllowed(sessionId) {
  if (
    captureInFlight &&
    captureTargetSessionId &&
    sessionId === captureTargetSessionId
  ) {
    throw new Error(busyActionableText());
  }
}

/** Deferred, throttled capture-dir maintenance (not on pick critical path). */
function scheduleCaptureCleanup({ force = false } = {}) {
  const decision = shouldRunCleanup({
    lastCleanupAt,
    now: Date.now(),
    minIntervalMs: DEFAULT_CLEANUP_MIN_INTERVAL_MS,
    force,
  });
  if (!decision.run) return;

  if (cleanupTimer) return; // already queued
  cleanupTimer = setTimeout(() => {
    cleanupTimer = null;
    try {
      cleanupCaptureDir(CAPTURE_DIR, {
        maxFiles: 80,
        maxAgeMs: 7 * 24 * 60 * 60 * 1000,
      });
      lastCleanupAt = Date.now();
    } catch (err) {
      console.warn("capture cleanup:", err);
    }
  }, 0);
}

/**
 * One owner for post-deliver focus: clear prior schedule, then apply policy delays.
 * @param {{ reason?: string }} [opts]
 */
function scheduleTerminalFocus(opts = {}) {
  for (const t of focusHandoffTimers) clearTimeout(t);
  focusHandoffTimers = [];
  const delays = focusHandoffDelays();
  for (const ms of delays) {
    if (ms <= 0) {
      focusMainTerminal(opts.reason);
    } else {
      focusHandoffTimers.push(
        setTimeout(() => focusMainTerminal(opts.reason), ms),
      );
    }
  }
}

function resolveAppIcon() {
  // Dev: build/icon.png; packaged: macOS uses bundle .icns automatically
  const candidates = [
    path.join(__dirname, "..", "build", "icon.png"),
    path.join(process.resourcesPath || "", "icon.png"),
  ];
  for (const p of candidates) {
    if (p && fs.existsSync(p)) return p;
  }
  return undefined;
}

function createWindow() {
  const icon = resolveAppIcon();
  mainWindow = new BrowserWindow({
    width: 1600,
    height: 960,
    minWidth: 1100,
    minHeight: 640,
    title: "Visual Capture for Grok",
    backgroundColor: "#0c0d10",
    titleBarStyle: process.platform === "darwin" ? "hiddenInset" : "default",
    trafficLightPosition: { x: 16, y: 16 },
    ...(icon ? { icon } : {}),
    webPreferences: {
      preload: path.join(__dirname, "preload.cjs"),
      contextIsolation: true,
      nodeIntegration: false,
      sandbox: true,
    },
  });

  // The shell renderer is local application UI, not a general browser. Links
  // from xterm are opened through one narrow, protocol-checked IPC below.
  mainWindow.webContents.setWindowOpenHandler(() => ({ action: "deny" }));
  mainWindow.webContents.on("will-navigate", (event, url) => {
    const shellEntry = isDev
      ? "http://127.0.0.1:5179/"
      : pathToFileURL(path.join(__dirname, "..", "dist", "index.html")).href;
    try {
      if (new URL(url).href !== new URL(shellEntry).href) event.preventDefault();
    } catch {
      event.preventDefault();
    }
  });

  if (isDev) {
    mainWindow.loadURL("http://127.0.0.1:5179");
  } else {
    mainWindow.loadFile(path.join(__dirname, "..", "dist", "index.html"));
  }

  createPreviewView();
  layoutViews();
  installAppMenu();
  bindAppShortcuts(mainWindow.webContents);

  mainWindow.on("resize", layoutViews);
  mainWindow.on("close", (event) => {
    requestQuitConfirmation(event, "close");
  });
  mainWindow.on("closed", () => {
    const closingPreviewSession = previewView?.webContents.session || null;
    if (previewView && !previewView.webContents.isDestroyed()) {
      previewView.webContents.close({ waitForBeforeUnload: false });
    }
    if (privateMode && closingPreviewSession) {
      void clearPreviewData("all", closingPreviewSession).catch(() => {
        // The in-memory partition is discarded with the process regardless.
      });
    }
    mainWindow = null;
    previewView = null;
    disposeAllTerminals();
  });

  mainWindow.webContents.on("did-finish-load", () => {
    // Renderer ready — layout + notify
    layoutViews();
    sendToRenderer("layout:bounds", getLayoutBounds());
  });
}

/**
 * Cmd/Ctrl+R must refresh the *website preview*, not reload the Electron shell
 * (shell reload remounts xterm → looks like "terminal restart").
 */
function reloadPreviewPage() {
  if (previewView && !previewView.webContents.isDestroyed()) {
    previewLoading = true;
    previewError = null;
    previewView.webContents.reload();
    sendToRenderer("preview:status", previewStatusSnapshot());
    return true;
  }
  return false;
}

function isReloadChord(input) {
  if (!input || input.type !== "keyDown") return false;
  const key = (input.key || "").toLowerCase();
  if (key !== "r") return false;
  // macOS: meta=Cmd; Windows/Linux: control
  const mod = process.platform === "darwin" ? input.meta : input.control;
  return Boolean(mod) && !input.alt;
}

function bindAppShortcuts(webContents) {
  if (!webContents || webContents.isDestroyed()) return;
  webContents.on("before-input-event", (event, input) => {
    if (input.type !== "keyDown") return;

    // Esc cancels Aim from the shell (and preview when this is bound there)
    if (input.key === "Escape" && pickMode) {
      event.preventDefault();
      void setPickMode(false);
      return;
    }

    if (isReloadChord(input)) {
      event.preventDefault();
      if (input.shift && previewView && !previewView.webContents.isDestroyed()) {
        previewLoading = true;
        previewError = null;
        previewView.webContents.reloadIgnoringCache();
        sendToRenderer("preview:status", previewStatusSnapshot());
      } else {
        reloadPreviewPage();
      }
      return;
    }

    // Capture shortcuts must also work while the native preview owns focus.
    // The shell renderer handles its own keydown events, so scope these to the
    // WebContentsView to avoid a duplicate action.
    if (
      webContents === previewView?.webContents &&
      (process.platform === "darwin" ? input.meta : input.control) &&
      input.shift &&
      !input.alt
    ) {
      const key = String(input.key || "").toLowerCase();
      if (["a", "f", "v"].includes(key)) {
        event.preventDefault();
        if (key === "a") {
          if (!captureInFlight && (!pickMode ? isPreviewCapturable() : true)) {
            void setPickMode(!pickMode);
          }
        } else if (key === "f") {
          void runScreenshotAndNotify({ mode: preferredFrameMode }).catch(() => {});
        } else {
          void resendLastCaptureAndNotify().catch(() => {});
        }
      }
    }
  });
}

function installAppMenu() {
  const isMac = process.platform === "darwin";
  const template = [
    ...(isMac
      ? [
          {
            label: app.name,
            submenu: [
              { role: "about" },
              { type: "separator" },
              { role: "services" },
              { type: "separator" },
              { role: "hide" },
              { role: "hideOthers" },
              { role: "unhide" },
              { type: "separator" },
              { role: "quit" },
            ],
          },
        ]
      : []),
    {
      label: "Edit",
      submenu: [
        { role: "undo" },
        { role: "redo" },
        { type: "separator" },
        { role: "cut" },
        { role: "copy" },
        { role: "paste" },
        { role: "selectAll" },
      ],
    },
    {
      label: "View",
      submenu: [
        {
          label: "Reload Preview",
          accelerator: "CommandOrControl+R",
          click: () => reloadPreviewPage(),
        },
        {
          label: "Hard Reload Preview",
          accelerator: "CommandOrControl+Shift+R",
          click: () => {
            if (previewView && !previewView.webContents.isDestroyed()) {
              previewLoading = true;
              previewError = null;
              previewView.webContents.reloadIgnoringCache();
              sendToRenderer("preview:status", previewStatusSnapshot());
            }
          },
        },
        { type: "separator" },
        { role: "togglefullscreen" },
        // DevTools only when useful — not bound to Cmd+R
        ...(isDev || process.env.VEFG_DEVTOOLS === "1"
          ? [
              { type: "separator" },
              {
                label: "Toggle Developer Tools",
                accelerator: isMac ? "Alt+Command+I" : "Ctrl+Shift+I",
                click: () => {
                  if (mainWindow && !mainWindow.isDestroyed()) {
                    mainWindow.webContents.toggleDevTools();
                  }
                },
              },
            ]
          : []),
      ],
    },
    {
      label: "Window",
      submenu: [{ role: "minimize" }, { role: "zoom" }, { role: "close" }],
    },
  ];
  Menu.setApplicationMenu(Menu.buildFromTemplate(template));
}

function isWelcomePreviewUrl(value) {
  try {
    const url = new URL(value);
    return url.protocol === "file:" && url.pathname.endsWith("/welcome.html");
  } catch {
    return false;
  }
}

function previewStatusSnapshot(overrides = {}) {
  const contents = previewView?.webContents;
  const rawUrl = contents && !contents.isDestroyed() ? contents.getURL() : "";
  const isWelcome = isWelcomePreviewUrl(rawUrl);
  return {
    url: isWelcome ? "" : rawUrl || previewUrl,
    title:
      contents && !contents.isDestroyed() ? contents.getTitle() || "" : "",
    canGoBack: Boolean(
      contents &&
        !contents.isDestroyed() &&
        contents.navigationHistory.canGoBack(),
    ),
    canGoForward: Boolean(
      contents &&
        !contents.isDestroyed() &&
        contents.navigationHistory.canGoForward(),
    ),
    navigationId: previewNavigationId,
    isWelcome,
    selectionStale: Boolean(
      lastSelection && !isSelectionFromCurrentNavigation(lastSelection),
    ),
    hasCurrentTarget: Boolean(
      lastSelection && isSelectionFromCurrentNavigation(lastSelection),
    ),
    viewportPreset: viewportPresetId,
    viewportOrientation,
    privateMode,
    emulatedViewport: viewportPresetSnapshot(
      viewportPresetId,
      viewportOrientation,
    ),
    loading: previewLoading,
    error: previewError,
    ...overrides,
  };
}

function rejectPendingPreviewResolutions() {
  for (const pending of pendingPreviewResolutions.values()) {
    clearTimeout(pending.timer);
    pending.resolve(null);
  }
  pendingPreviewResolutions.clear();
}

function rotatePreviewContext() {
  previewNavigationId += 1;
  previewPickerToken = crypto.randomUUID();
  rejectPendingPreviewResolutions();
  if (pickMode) {
    pickMode = false;
    sendToRenderer("preview:pick-mode", { enabled: false });
  }
}

function configurePreviewPicker() {
  if (!previewView || previewView.webContents.isDestroyed()) return;
  previewView.webContents.send("preview-picker:configure", {
    token: previewPickerToken,
    navigationId: previewNavigationId,
  });
}

function isTrustedPickerEnvelope(event, envelope, { requirePick = false } = {}) {
  return Boolean(
    previewView &&
      event.sender === previewView.webContents &&
      (!event.senderFrame || event.senderFrame === previewView.webContents.mainFrame) &&
      envelope &&
      envelope.token === previewPickerToken &&
      envelope.navigationId === previewNavigationId &&
      (!requirePick || pickMode),
  );
}

function attachSelectionContext(selection, sourceId = previewView?.webContents.id) {
  if (!selection || typeof selection !== "object") return null;
  const prior = selection.captureContext || {};
  const priorViewport = prior.viewport || {};
  const priorScroll = prior.scroll || {};
  return stampSelectionContext(selection, {
    navigationId: previewNavigationId,
    navigationToken: previewPickerToken,
    sourceId,
    pageUrl: selection.pageUrl || previewView?.webContents.getURL() || "",
    viewport: {
      ...priorViewport,
      scrollX: priorViewport.scrollX ?? priorScroll.x ?? 0,
      scrollY: priorViewport.scrollY ?? priorScroll.y ?? 0,
    },
  });
}

async function handleTrustedAimSelection(rawSelection) {
  const plan = planAimPickEvent({
    inFlight: captureInFlight,
    pickMode,
    trusted: true,
  });
  if (!plan.proceed) {
    await setPickMode(false);
    await clearPickerOverlay();
    sendToRenderer("capture:result", {
      kind: "error",
      message: plan.reason === "busy"
        ? busyActionableText()
        : plan.statusMessage || busyActionableText(),
    });
    return;
  }

  const captureTarget = freezeActiveCaptureTarget();
  const priorWorkspace = getSessionState(
    coordinatorStateFromSlots(),
    captureTarget.targetSessionId,
  );
  const prevSelection = priorWorkspace?.lastSelection || null;
  const prevScreenshotPath = priorWorkspace?.lastScreenshotPath || null;
  let uncommittedShotPath = null;
  setCaptureBusy(true);
  try {
    const selection = attachSelectionContext(rawSelection);
    if (!selection?.boundingBox) throw new Error("Invalid preview selection");
    if (!isPreviewCapturable()) {
      throw new Error("Preview changed during Aim — wait for it to finish loading and Aim again.");
    }
    const captureIdentity = snapshotPreviewIdentity();
    await setPickMode(false);
    if (!previewIdentityMatches(captureIdentity)) {
      throw new Error("Preview changed during Aim — wait for it to finish loading and Aim again.");
    }
    const shot = await takeScreenshotFile({
      bounds: selection.boundingBox,
      reason: "pick",
      padding: 72,
    });
    uncommittedShotPath = shot.path;
    if (!shot.cropped) {
      throw new Error("Could not capture the selected target — Aim again after the page settles.");
    }
    if (!previewIdentityMatches(captureIdentity)) {
      throw new Error("Preview changed during Aim — capture discarded. Aim again after loading finishes.");
    }
    const resolvedAfterCapture = await resolveSelectionInPreview(selection);
    const stableTarget = resolvedAfterCapture
      ? attachSelectionContext(resolvedAfterCapture)
      : null;
    const stability = evaluateSelectionStability({
      before: selection,
      after: stableTarget,
    });
    if (!previewIdentityMatches(captureIdentity) || !stability.stable) {
      throw new Error("Target changed during Aim — capture discarded. Aim again when the page is stable.");
    }
    const result = await deliverCapture(
      selection,
      shot.path,
      "selection",
      {
        pasteToTerminal: true,
        writeClipboard: true,
        captureTarget,
      },
    );
    const commit = resolvePickCommit({
      ok: true,
      selection,
      screenshotPath: shot.path,
      prevSelection,
      prevScreenshotPath,
    });
    uncommittedShotPath = null;
    const captureMeta = buildCaptureMeta({
      kind: "selection",
      selection: commit.lastSelection,
      screenshotPath: commit.lastScreenshotPath,
      shot,
      result,
      captureMode: "target-context",
      captureTarget,
    });
    commitCaptureForTarget(captureTarget, {
      selection: commit.lastSelection,
      screenshotPath: commit.lastScreenshotPath,
      captureMeta,
      previewUrl: selection.pageUrl || captureTarget.previewUrl,
      viewportPreset: captureTarget.viewportPreset,
      viewportOrientation: captureTarget.viewportOrientation,
    });
    await clearPickerOverlay();
    sendToRenderer("capture:result", {
      kind: "selection",
      selection: commit.lastSelection,
      ...result,
      screenshotPath: commit.lastScreenshotPath,
      captureMeta,
      targetSessionId: captureTarget.targetSessionId,
    });
    sendToRenderer("preview:status", previewStatusSnapshot());
    if (
      result.pastedToTerminal &&
      captureTarget.targetSessionId === activeTerminalId
    ) {
      scheduleTerminalFocus({ reason: "pick" });
    }
  } catch (err) {
    if (uncommittedShotPath) {
      try {
        fs.unlinkSync(uncommittedShotPath);
      } catch {
        // Capture cleanup will remove any file another process still holds.
      }
    }
    await setPickMode(false);
    await clearPickerOverlay();
    sendToRenderer("capture:result", {
      kind: "error",
      message: err instanceof Error ? err.message : String(err),
    });
  } finally {
    setCaptureBusy(false);
  }
}

function createPreviewView() {
  if (!mainWindow) return;

  const sessionPolicy = buildPreviewSessionPolicy({ privateMode });

  previewView = new WebContentsView({
    webPreferences: {
      preload: path.join(__dirname, "preview-preload.cjs"),
      contextIsolation: true,
      nodeIntegration: false,
      sandbox: true,
      webSecurity: true,
      partition: sessionPolicy.partition,
    },
  });

  mainWindow.contentView.addChildView(previewView);
  bindAppShortcuts(previewView.webContents);

  // Aim and Frame require no website permissions. Keep embedded content from
  // requesting clipboard, media, notifications, fullscreen, or other grants.
  const previewSession = previewView.webContents.session;
  previewSession.setPermissionRequestHandler(
    (_contents, _permission, callback) => callback(false),
  );
  previewSession.setPermissionCheckHandler(() => false);
  if (!configuredPreviewSessions.has(previewSession)) {
    configuredPreviewSessions.add(previewSession);
    previewSession.on("will-download", (event, item) => {
      const decision = evaluateDownloadPolicy({
        url: item.getURL(),
        downloadsEnabled: false,
        userConfirmed: false,
      });
      if (decision.allow) return;
      event.preventDefault();
      const win = mainWindow && !mainWindow.isDestroyed() ? mainWindow : undefined;
      void dialog.showMessageBox(win, {
        type: "info",
        title: tr("privacy.downloadBlockedTitle"),
        message: tr("privacy.downloadBlockedMessage"),
        detail: tr("privacy.downloadBlockedDetail"),
        buttons: ["OK"],
      });
    });
  }

  previewView.webContents.setWindowOpenHandler(() => ({ action: "deny" }));

  previewView.webContents.on("will-navigate", (event, url) => {
    try {
      const parsed = new URL(url);
      const welcomeUrl = pathToFileURL(path.join(__dirname, "welcome.html")).href;
      if (
        !["http:", "https:"].includes(parsed.protocol) &&
        parsed.href !== welcomeUrl
      ) {
        event.preventDefault();
      }
    } catch {
      event.preventDefault();
    }
  });

  previewView.webContents.on(
    "did-start-navigation",
    (_event, _url, _isInPlace, isMainFrame) => {
      if (!isMainFrame) return;
      previewLoading = true;
      previewError = null;
      rotatePreviewContext();
      sendToRenderer("preview:status", previewStatusSnapshot({ loading: true, error: null }));
    },
  );

  previewView.webContents.on("did-navigate-in-page", (_event, url, isMainFrame) => {
    if (!isMainFrame) return;
    rotatePreviewContext();
    previewLoading = false;
    previewError = null;
    configurePreviewPicker();
    if (/^https?:/i.test(url)) {
      previewUrl = url;
      persist({
        previewUrl: privateMode ? "" : sanitizeHistoryUrl(url) || "",
      });
      persistCurrentWorkspaceToSlot();
      persistTerminalSessions(true);
    }
    sendToRenderer("preview:status", previewStatusSnapshot());
  });

  previewView.webContents.on("did-navigate", (_event, url) => {
    if (/^https?:/i.test(url)) {
      previewUrl = url;
      persist({
        previewUrl: privateMode ? "" : sanitizeHistoryUrl(url) || "",
      });
      persistCurrentWorkspaceToSlot();
      persistTerminalSessions(true);
    } else if (isWelcomePreviewUrl(url)) {
      previewUrl = "";
      persist({ previewUrl: "" });
      persistCurrentWorkspaceToSlot();
      persistTerminalSessions(true);
    }
    sendToRenderer("preview:status", previewStatusSnapshot());
  });

  previewView.webContents.on("did-finish-load", () => {
    previewLoading = false;
    previewError = null;
    applyCurrentPreviewDeviceEmulation();
    configurePreviewPicker();
    sendToRenderer("preview:status", previewStatusSnapshot());
  });

  previewView.webContents.on("dom-ready", () => {
    applyCurrentPreviewDeviceEmulation();
  });

  previewView.webContents.on("did-start-loading", () => {
    previewLoading = true;
    sendToRenderer("preview:status", previewStatusSnapshot());
  });

  previewView.webContents.on(
    "did-fail-load",
    (_event, code, desc, url, isMainFrame) => {
      if (!isMainFrame || code === -3) return;
      previewLoading = false;
      previewError = `${desc} (${code})`;
      sendToRenderer(
        "preview:status",
        previewStatusSnapshot({
          url,
        }),
      );
    },
  );

  previewView.webContents.on("page-title-updated", () => {
    sendToRenderer("preview:status", previewStatusSnapshot());
  });

  if (previewUrl) loadPreview(previewUrl);
  else loadWelcomePreview();
}

async function clearPreviewData(scope = "all", targetSession = null) {
  const previewSession = targetSession || previewView?.webContents.session;
  if (!previewSession) throw new Error("Preview session is not ready");
  const plan = buildPreviewDataClearPlan({
    scope,
    currentUrl: previewView?.webContents.getURL() || previewUrl,
  });
  if (!plan.ok || !plan.clearStorageData) {
    throw new Error("Open an http(s) preview before clearing this site.");
  }
  await previewSession.clearStorageData(plan.clearStorageData);
  if (plan.clearCache) await previewSession.clearCache();
  if (plan.clearAuthCache) await previewSession.clearAuthCache();
  return { ok: true, scope };
}

async function setPrivatePreviewMode(enabled) {
  const next = Boolean(enabled);
  if (next === privateMode) {
    return { ...previewStatusSnapshot(), privateMode };
  }
  await setPickMode(false);
  const priorView = previewView;
  const priorSession = priorView?.webContents.session || null;
  const priorWasPrivate = privateMode;
  if (next) {
    persistCurrentWorkspaceToSlot();
    persistTerminalSessions(true);
    if (activeTerminalId) privatePreviewUrls.set(activeTerminalId, previewUrl);
  } else if (priorWasPrivate) {
    persistCurrentWorkspaceToSlot();
  }
  if (priorView && mainWindow) {
    try {
      mainWindow.contentView.removeChildView(priorView);
    } catch {
      // It may already be detached during shutdown.
    }
    if (!priorView.webContents.isDestroyed()) {
      priorView.webContents.close({ waitForBeforeUnload: false });
    }
  }
  previewView = null;
  privateMode = next;
  if (!privateMode) {
    restoreActiveWorkspaceGlobals();
    privatePreviewUrls.clear();
  }
  persist({
    privateMode,
    previewUrl: privateMode ? "" : sanitizeHistoryUrl(previewUrl) || "",
    recentPreviewUrls,
  });
  if (priorWasPrivate && priorSession) {
    await clearPreviewData("all", priorSession);
  }
  createPreviewView();
  layoutViews();
  return { ...previewStatusSnapshot(), privateMode };
}

function getLayoutBounds() {
  if (!mainWindow) {
    const layout = computeWorkspaceLayout({
      contentWidth: 1200,
      contentHeight: 800,
      toolbarHeight: TOOLBAR_HEIGHT,
      previewChromeHeight: PREVIEW_CHROME_HEIGHT,
      splitRatio,
      previewCollapsed,
      minTerminalWidth: MIN_TERMINAL_WIDTH,
      minPreviewWidth: MIN_PREVIEW_WIDTH,
      splitterWidth: SPLITTER_WIDTH,
    });
    return {
      toolbarHeight: TOOLBAR_HEIGHT,
      previewChromeHeight: PREVIEW_CHROME_HEIGHT,
      terminalWidth: layout.terminalWidth,
      previewWidth: layout.previewWidth,
      contentWidth: 1200,
      contentHeight: 800,
      splitRatio: layout.splitRatio,
      previewCollapsed: layout.previewCollapsed,
      splitterVisible: layout.splitterVisible,
    };
  }
  const [width, height] = mainWindow.getContentSize();
  const layout = computeWorkspaceLayout({
    contentWidth: width,
    contentHeight: height,
    toolbarHeight: TOOLBAR_HEIGHT,
    previewChromeHeight: PREVIEW_CHROME_HEIGHT,
    splitRatio,
    previewCollapsed,
    minTerminalWidth: MIN_TERMINAL_WIDTH,
    minPreviewWidth: MIN_PREVIEW_WIDTH,
    splitterWidth: SPLITTER_WIDTH,
  });
  return {
    toolbarHeight: TOOLBAR_HEIGHT,
    previewChromeHeight: PREVIEW_CHROME_HEIGHT,
    terminalWidth: layout.terminalWidth,
    previewWidth: layout.previewWidth,
    contentWidth: width,
    contentHeight: height,
    splitRatio: layout.splitRatio,
    previewCollapsed: layout.previewCollapsed,
    splitterVisible: layout.splitterVisible,
  };
}

function applyPreviewDeviceEmulation(availableWidth, availableHeight) {
  if (!previewView || previewView.webContents.isDestroyed()) return;
  const plan = deviceEmulationPlan({
    presetId: viewportPresetId,
    orientation: viewportOrientation,
    availableWidth,
    availableHeight,
  });
  try {
    if (plan.enabled) previewView.webContents.enableDeviceEmulation(plan.parameters);
    else previewView.webContents.disableDeviceEmulation();
  } catch (err) {
    console.warn("preview device emulation:", err);
  }
}

function applyCurrentPreviewDeviceEmulation() {
  if (!previewView || previewView.webContents.isDestroyed()) return;
  const bounds = previewView.getBounds();
  applyPreviewDeviceEmulation(
    Math.max(1, bounds.width),
    Math.max(1, bounds.height),
  );
}

function layoutViews() {
  if (!mainWindow || !previewView) return;
  const [width, height] = mainWindow.getContentSize();
  const layout = computeWorkspaceLayout({
    contentWidth: width,
    contentHeight: height,
    toolbarHeight: TOOLBAR_HEIGHT,
    previewChromeHeight: PREVIEW_CHROME_HEIGHT,
    splitRatio,
    previewCollapsed,
    minTerminalWidth: MIN_TERMINAL_WIDTH,
    minPreviewWidth: MIN_PREVIEW_WIDTH,
    splitterWidth: SPLITTER_WIDTH,
  });

  // Preview sits under its own URL chrome on the right; collapsed → hide view
  if (layout.previewCollapsed || layout.previewWidth <= 0) {
    previewView.setVisible(false);
    previewView.setBounds({ x: 0, y: 0, width: 0, height: 0 });
  } else {
    previewView.setVisible(true);
    previewView.setBounds({
      x: layout.previewX,
      y: layout.previewY,
      width: layout.previewWidth,
      height: Math.max(120, layout.previewBrowserHeight),
    });
    applyPreviewDeviceEmulation(
      layout.previewWidth,
      Math.max(120, layout.previewBrowserHeight),
    );
  }

  sendToRenderer("layout:bounds", {
    toolbarHeight: TOOLBAR_HEIGHT,
    previewChromeHeight: PREVIEW_CHROME_HEIGHT,
    terminalWidth: layout.terminalWidth,
    previewWidth: layout.previewWidth,
    contentWidth: width,
    contentHeight: height,
    splitRatio: layout.splitRatio,
    previewCollapsed: layout.previewCollapsed,
    splitterVisible: layout.splitterVisible,
  });
}

function setPreviewCollapsed(next, { forcePersist = true } = {}) {
  previewCollapsed = Boolean(next);
  persistDebounced({ previewCollapsed }, { force: forcePersist });
  layoutViews();
  return getLayoutBounds();
}

async function setPickMode(enabled) {
  const requested = Boolean(enabled);
  if (requested && !isPreviewCapturable()) {
    pickMode = false;
    sendToRenderer("preview:pick-mode", { enabled: false });
    return false;
  }
  pickMode = requested;
  sendToRenderer("preview:pick-mode", { enabled: pickMode });
  if (!previewView || previewView.webContents.isDestroyed()) return;
  previewView.webContents.send("preview-picker:set-mode", {
    enabled: pickMode,
    token: previewPickerToken,
    navigationId: previewNavigationId,
  });
}

function isPreviewCapturable() {
  if (
    !previewView ||
    previewView.webContents.isDestroyed() ||
    previewLoading ||
    previewError
  ) {
    return false;
  }
  try {
    return ["http:", "https:"].includes(
      new URL(previewView.webContents.getURL()).protocol,
    );
  } catch {
    return false;
  }
}

function snapshotPreviewIdentity() {
  if (!previewView || previewView.webContents.isDestroyed()) return null;
  return {
    webContentsId: previewView.webContents.id,
    navigationId: previewNavigationId,
    navigationToken: previewPickerToken,
    url: previewView.webContents.getURL(),
  };
}

function previewIdentityMatches(snapshot) {
  if (!snapshot || !previewView || previewView.webContents.isDestroyed()) {
    return false;
  }
  return samePreviewIdentity(snapshot, {
    webContentsId: previewView.webContents.id,
    navigationId: previewNavigationId,
    navigationToken: previewPickerToken,
    url: previewView.webContents.getURL(),
    loading: previewLoading,
  });
}

function loadPreview(url) {
  if (!previewView) return;
  try {
    const parsed = new URL(url);
    if (!["http:", "https:"].includes(parsed.protocol)) {
      throw new Error(actionableError({ code: "invalid-url" }).text);
    }
    previewUrl = parsed.href;
    const historyUrl = sanitizeHistoryUrl(previewUrl);
    if (!privateMode && historyUrl) {
      recentPreviewUrls = sanitizeHistoryUrls(
        [historyUrl, ...recentPreviewUrls],
        8,
      );
    }
    persist({
      previewUrl: privateMode ? "" : historyUrl || "",
      recentPreviewUrls,
    });
    persistCurrentWorkspaceToSlot();
    persistTerminalSessions(true);
    previewLoading = true;
    previewError = null;
    const requestedUrl = previewUrl;
    void previewView.webContents.loadURL(requestedUrl).catch((err) => {
      // loadURL rejects as well as emitting did-fail-load. Handle the promise
      // so stopped localhost servers cannot become unhandled rejections.
      if (
        !previewView ||
        previewView.webContents.isDestroyed() ||
        previewUrl !== requestedUrl
      ) {
        return;
      }
      previewLoading = false;
      previewError = previewError || (err instanceof Error ? err.message : String(err));
      sendToRenderer(
        "preview:status",
        previewStatusSnapshot({ url: requestedUrl, loading: false }),
      );
    });
    sendToRenderer(
      "preview:status",
      previewStatusSnapshot({ url: previewUrl, loading: true, error: null }),
    );
  } catch (err) {
    sendToRenderer("preview:status", {
      url,
      loading: false,
      error: err instanceof Error ? err.message : String(err),
    });
  }
}

function loadWelcomePreview() {
  if (!previewView || previewView.webContents.isDestroyed()) return;
  const welcomeUrl = `${pathToFileURL(path.join(__dirname, "welcome.html")).href}?lang=${uiLocale}`;
  previewLoading = true;
  previewError = null;
  void previewView.webContents.loadURL(welcomeUrl).catch((err) => {
    if (
      !previewView ||
      previewView.webContents.isDestroyed() ||
      previewUrl
    ) {
      return;
    }
    previewLoading = false;
    previewError = err instanceof Error ? err.message : String(err);
    sendToRenderer(
      "preview:status",
      previewStatusSnapshot({ url: "", loading: false, error: previewError }),
    );
  });
  sendToRenderer(
    "preview:status",
    previewStatusSnapshot({
      url: "",
      title: "Welcome",
      isWelcome: true,
      loading: true,
      error: null,
    }),
  );
}

async function clearPickerOverlay() {
  if (!previewView || previewView.webContents.isDestroyed()) return;
  previewView.webContents.send("preview-picker:clear");
}

function isSelectionFromCurrentNavigation(selection) {
  const context = selection?.captureContext;
  return Boolean(
    context &&
      context.navigationId === previewNavigationId &&
      context.navigationToken === previewPickerToken,
  );
}

async function resolveSelectionInPreview(selection) {
  if (
    !previewView ||
    previewView.webContents.isDestroyed() ||
    !selection?.selector ||
    !isSelectionFromCurrentNavigation(selection)
  ) {
    return null;
  }
  return resolveSelectorInCurrentPreview(selection.selector);
}

/** Resolve a selector against the current page for post-edit verification. */
async function resolveSelectorInCurrentPreview(selector) {
  if (
    !previewView ||
    previewView.webContents.isDestroyed() ||
    typeof selector !== "string" ||
    !selector
  ) {
    return null;
  }
  const requestId = crypto.randomUUID();
  return new Promise((resolve) => {
    const timer = setTimeout(() => {
      pendingPreviewResolutions.delete(requestId);
      resolve(null);
    }, 900);
    pendingPreviewResolutions.set(requestId, { resolve, timer });
    previewView.webContents.send("preview-picker:resolve", {
      requestId,
      token: previewPickerToken,
      navigationId: previewNavigationId,
      selector,
    });
  });
}

/**
 * Put screenshot on the OS clipboard in the form Grok TUI expects for
 * multimodal image chips (file paste preferred; native image fallback).
 * @param {string} filePath
 * @returns {Promise<boolean>}
 */
async function putScreenshotOnClipboardForGrok(filePath) {
  if (!filePath || !fs.existsSync(filePath)) return false;

  // macOS: file-on-clipboard → Grok "copy file then paste" creates a real image chip
  if (process.platform === "darwin") {
    const result = await copyFileToMacClipboard(filePath);
    if (result.ok) return true;
    if (result.error) {
      console.warn("osascript file clipboard failed, trying writeImage:", result.error);
    }
  }

  // Cross-platform: raw image on clipboard (Grok Cmd/Ctrl+V image paste)
  try {
    const image = nativeImage.createFromPath(filePath);
    if (!image.isEmpty()) {
      clipboard.writeImage(image);
      return true;
    }
  } catch (err) {
    console.warn("writeImage failed:", err);
  }
  return false;
}

/**
 * Paste into Grok TUI as multimodal when possible:
 * 1) image/file on OS clipboard → Ctrl+V so Grok attaches an image chip
 * 2) then bracketed-paste text context (DOM path, etc.)
 *
 * Grok docs: paste screenshots via Ctrl/Cmd+V creates image chips (not plain path text).
 *
 * @param {string} text
 * @param {string | null} screenshotPath
 * @returns {Promise<{ pasted: boolean, imageChip: boolean }>}
 */
/**
 * @returns {Promise<{
 *   pasted: boolean,
 *   textPasted: boolean,
 *   imagePrepared: boolean,
 *   imageChip: boolean,
 *   terminalAlive: boolean,
 *   fallback: string | null,
 *   statusMessage: string,
 * }>}
 */
async function pasteToGrokMultimodal(
  text,
  screenshotPath,
  captureTarget,
  imagePaths = null,
) {
  const targetSessionId = captureTarget?.targetSessionId || "";
  const targetSlot = targetSessionId
    ? terminalSlots.get(targetSessionId) || null
    : null;
  const termSession = targetSlot?.pty || null;
  const terminalAlive = Boolean(termSession?.isAlive());
  const grokRunning = Boolean(termSession?.isGrokAlive());
  const screenshots = (Array.isArray(imagePaths) ? imagePaths : [screenshotPath])
    .filter((item, index, rows) =>
      typeof item === "string" &&
      fs.existsSync(item) &&
      rows.indexOf(item) === index,
    );
  const hasShot = screenshots.length > 0;

  // Always refresh clipboard for manual fallback
  const writeClipboardBundle = () => {
    try {
      const image = hasShot
        ? nativeImage.createFromPath(screenshotPath)
        : null;
      if (image && !image.isEmpty()) {
        clipboard.write({ text, image });
      } else {
        clipboard.writeText(text);
      }
    } catch {
      clipboard.writeText(text);
    }
  };

  if (!grokRunning) {
    writeClipboardBundle();
    const status = buildPasteStatus({
      locale: uiLocale,
      terminalAlive,
      shellAlive: terminalAlive,
      grokRunning: false,
      grokLaunchRequested: false,
      textPasteAttempted: false,
      textPasted: false,
      imagePrepared: hasShot,
      imageChipAttempted: false,
    });
    return {
      ...status,
      textPasted: false,
      terminalAlive,
      terminalState: terminalAlive ? "shell" : "off",
      grokRunning: false,
    };
  }

  if (targetSessionId === activeTerminalId) focusMainTerminal();
  await delay(90);

  let imagePrepared = false;
  let imageChipAttempted = false;
  let imageAttachmentsAttempted = 0;
  if (hasShot) {
    for (const imagePath of screenshots) {
      const prepared = await putScreenshotOnClipboardForGrok(imagePath);
      imagePrepared = imagePrepared || prepared;
      if (!prepared) continue;
      await delay(60);
      try {
        const attempted = Boolean(termSession?.write("\x16"));
        imageChipAttempted = imageChipAttempted || attempted;
        if (attempted) imageAttachmentsAttempted += 1;
        await delay(280);
      } catch (err) {
        console.warn("Ctrl+V inject failed:", err);
      }
    }
  }

  let textPasted = false;
  try {
    textPasted = Boolean(termSession?.paste(text));
    await delay(40);
  } catch (err) {
    console.warn("text paste failed:", err);
    textPasted = false;
  }

  // Keep a real file/image on the clipboard after the automatic attempt so
  // the operator-facing “press ⌘V if needed” fallback remains truthful.
  if (hasShot) {
    await putScreenshotOnClipboardForGrok(screenshots[screenshots.length - 1]);
  }
  else writeClipboardBundle();

  const status = buildPasteStatus({
    locale: uiLocale,
    terminalAlive: true,
    shellAlive: true,
    grokRunning: true,
    grokLaunchRequested: true,
    textPasteAttempted: true,
    textPasted,
    imagePrepared,
    imageChipAttempted,
  });
  return {
    ...status,
    textPasted,
    terminalAlive: true,
    terminalState: "grok",
    grokRunning: true,
    imageAttachmentsAttempted,
  };
}

/**
 * Clipboard + optional terminal paste (multimodal when screenshot present).
 * @param {object | null} selection
 * @param {string | null} screenshotPath
 * @param {string} [kind]
 * @param {{
 *   intent?: string | null,
 *   styleDiffs?: object | null,
 *   pasteToTerminal?: boolean,
 *   writeClipboard?: boolean,
 *   captureTarget?: object,
 *   payloadText?: string,
 *   imagePaths?: string[],
 * }} [options]
 */
async function deliverCapture(
  selection,
  screenshotPath,
  kind = "capture",
  options = {},
) {
  if (options.captureTarget) {
    const route = resolveCaptureRoute(
      coordinatorStateFromSlots(),
      options.captureTarget,
    );
    if (!route.ok || route.contextChanged) {
      throw new Error(
        "The target terminal workspace changed during capture. Run Aim or Frame again.",
      );
    }
  }
  const intent = options.intent ?? null;
  const styleDiffs = options.styleDiffs ?? null;
  const writeClipboard = options.writeClipboard !== false;
  const wantPaste =
    options.pasteToTerminal === false
      ? false
      : options.pasteToTerminal === true
        ? true
        : autoPasteTerminal;

  const text =
    typeof options.payloadText === "string"
      ? options.payloadText
      : buildClipboardPayload({
          selection,
          screenshotPath,
          intent,
          styleDiffs,
        });
  const image =
    screenshotPath && fs.existsSync(screenshotPath)
      ? nativeImage.createFromPath(screenshotPath)
      : null;
  const hasImage = Boolean(image && !image.isEmpty());

  let pastedToTerminal = false;
  let imageChip = false;
  let imagePrepared = false;
  let fallback = null;
  let statusMessage = "";
  const targetSlot = options.captureTarget?.targetSessionId
    ? terminalSlots.get(options.captureTarget.targetSessionId) || null
    : null;
  let terminalAlive = Boolean(targetSlot?.pty?.isAlive());
  let deliveryDetails = {};

  if (wantPaste) {
    const result = await pasteToGrokMultimodal(
      text,
      screenshotPath,
      options.captureTarget,
      options.imagePaths,
    );
    deliveryDetails = result;
    pastedToTerminal = result.pasted;
    imageChip = result.imageChip;
    imagePrepared = result.imagePrepared;
    fallback = result.fallback;
    statusMessage = result.statusMessage;
    terminalAlive = result.terminalAlive;
  } else if (writeClipboard) {
    if (hasImage && screenshotPath) {
      imagePrepared = await putScreenshotOnClipboardForGrok(screenshotPath);
      try {
        clipboard.write({ text, image });
      } catch {
        clipboard.writeText(text);
      }
    } else {
      clipboard.writeText(text);
    }
    statusMessage = tr("main.copied");
  }

  // Housekeeping off critical path (throttled)
  scheduleCaptureCleanup();

  const copied = writeClipboard || pastedToTerminal || Boolean(fallback);
  const outcome = classifyDeliveryOutcome({
    kind,
    ...deliveryDetails,
    copied,
    pastedToTerminal,
    hasImage,
    imagePrepared,
    imageChip,
    imageChipAttempted:
      deliveryDetails.imageChipAttempted ?? Boolean(imageChip),
    deliveryAttempted:
      deliveryDetails.deliveryAttempted ?? Boolean(pastedToTerminal),
    fallback,
    screenshotPath: screenshotPath || null,
  });

  return {
    ...deliveryDetails,
    copied,
    pastedToTerminal,
    hasImage,
    imagePrepared,
    imageChip,
    // No private Grok acknowledgement is available; “attempted” is exposed
    // separately by deliveryDetails and must not be promoted to confirmed.
    multimodal: false,
    fallback,
    statusMessage,
    terminalAlive,
    textPreview: text.slice(0, 280),
    text,
    screenshotPath: screenshotPath || null,
    kind,
    deliveryOutcome: outcome.kind,
    deliveryOutcomeLabel: deliveryOutcomeLabel(outcome.kind, uiLocale),
    targetSessionId: options.captureTarget?.targetSessionId || null,
    targetSessionLabel: options.captureTarget?.label || null,
    targetCwd: options.captureTarget?.cwd || null,
  };
}

/**
 * Capture preview to disk. Optionally crop around selected element (with padding)
 * while keeping a full-page shot as fallback if crop fails.
 *
 * @param {{
 *   bounds?: { x?: number, y?: number, top?: number, left?: number, width?: number, height?: number } | null,
 *   reason?: string,
 *   padding?: number,
 * }} [opts]
 * @returns {Promise<{ path: string, fullPath: string, cropped: boolean }>}
 */
async function takeScreenshotFile(opts = {}) {
  if (!previewView) throw new Error("Preview not ready");
  await ensurePrivateDirectory(CAPTURE_DIR);

  const full = await previewView.webContents.capturePage();
  if (full.isEmpty()) throw new Error("Screenshot is empty");

  const stamp = new Date().toISOString().replace(/[:.]/g, "-");

  // Crop in memory; write only the file used for multimodal delivery
  // (no dual full+crop PNG on every pick).
  let outImage = full;
  let cropped = false;
  const bounds = opts.bounds;

  if (bounds && Number(bounds.width) > 0 && Number(bounds.height) > 0) {
    try {
      const size = full.getSize();
      const pad = Math.max(0, Math.min(240, Number(opts.padding) || 96));
      const left = Math.round(bounds.left ?? bounds.x ?? 0);
      const top = Math.round(bounds.top ?? bounds.y ?? 0);
      const bw = Math.round(bounds.width);
      const bh = Math.round(bounds.height);

      // capturePage returns device pixels; bounds from DOM are CSS px
      const viewBounds = previewView.getBounds();
      const dprX = size.width / Math.max(1, viewBounds.width);
      const dprY = size.height / Math.max(1, viewBounds.height);
      const dpr = (dprX + dprY) / 2;

      const x = Math.max(0, Math.floor((left - pad) * dpr));
      const y = Math.max(0, Math.floor((top - pad) * dpr));
      const w = Math.min(size.width - x, Math.ceil((bw + pad * 2) * dpr));
      const h = Math.min(size.height - y, Math.ceil((bh + pad * 2) * dpr));

      if (w > 8 && h > 8) {
        outImage = full.crop({ x, y, width: w, height: h });
        cropped = true;
      }
    } catch (err) {
      console.warn("Element crop failed, using full page:", err);
      outImage = full;
      cropped = false;
    }
  }

  const prefix = opts.reason === "pick" ? "pick" : "capture";
  const filePath = path.join(
    CAPTURE_DIR,
    `${prefix}${cropped ? "-el" : "-full"}-${stamp}-${crypto.randomBytes(3).toString("hex")}.png`,
  );
  await writePrivatePng(filePath, outImage.toPNG());
  // Do not mutate lastScreenshotPath here — callers commit only on full success
  // via resolvePickCommit / explicit assign after deliver (avoids half-paired state).

  scheduleCaptureCleanup();

  return { path: filePath, fullPath: filePath, cropped };
}

function buildCaptureMeta({
  kind,
  selection,
  screenshotPath,
  shot,
  result,
  captureMode,
  fallbackReason = null,
  captureTarget = null,
}) {
  return {
    kind,
    capturedAt: Date.now(),
    pageUrl:
      selection?.pageUrl ||
      previewStatusSnapshot().url ||
      null,
    pageTitle:
      selection?.pageTitle ||
      previewStatusSnapshot().title ||
      null,
    target: selection
      ? `<${selection.tag || "unknown"}>${selection.id ? `#${selection.id}` : ""}${selection.classes?.[0] ? `.${selection.classes[0]}` : ""}`
      : null,
    targetDetails: selection
      ? {
          tag: selection.tag || "unknown",
          id: selection.id || null,
          className: selection.className || "",
          domPath: selection.domPath || selection.selector || null,
        }
      : null,
    screenshotPath: screenshotPath || null,
    captureMode,
    targetSessionId: captureTarget?.targetSessionId || null,
    targetSessionLabel: captureTarget?.label || null,
    targetCwd: captureTarget?.cwd || null,
    viewportPreset: captureTarget?.viewportPreset || viewportPresetId,
    viewportOrientation:
      captureTarget?.viewportOrientation || viewportOrientation,
    emulatedViewport: viewportPresetSnapshot(
      captureTarget?.viewportPreset || viewportPresetId,
      captureTarget?.viewportOrientation || viewportOrientation,
    ),
    cropped: Boolean(shot?.cropped),
    fallbackReason,
    delivery: {
      terminalState: result?.terminalState || null,
      textPasted: Boolean(result?.textPasted),
      deliveryAttempted: Boolean(result?.deliveryAttempted),
      deliveryConfirmed: Boolean(result?.deliveryConfirmed),
      imageAttachment: result?.imageAttachment ||
        (result?.imageChip ? "attempted" : result?.imagePrepared ? "prepared" : "none"),
      imageChipAttempted: Boolean(result?.imageChipAttempted),
      imageChipConfirmed: Boolean(result?.imageChipConfirmed),
      fallback: result?.fallback || null,
      statusMessage: result?.statusMessage || "",
    },
  };
}

async function captureScreenshot(options = {}) {
  if (!isPreviewCapturable()) {
    throw new Error(actionableError({ code: "preview-not-ready" }).text);
  }
  const captureTarget = freezeActiveCaptureTarget();
  const sourceWorkspace = getSessionState(
    coordinatorStateFromSlots(),
    captureTarget.targetSessionId,
  );
  const requestedMode = ["viewport", "target-context"].includes(options?.mode)
    ? options.mode
    : preferredFrameMode;
  preferredFrameMode = requestedMode;
  const locked = await withCaptureLock(async () => {
    if (!isPreviewCapturable()) {
      throw new Error(
        actionableError({
          code: "preview-not-ready",
          detail: "loading",
        }).text,
      );
    }
    const captureIdentity = snapshotPreviewIdentity();
    let selectionForFrame = null;
    let fallbackReason = null;
    if (requestedMode === "target-context" && sourceWorkspace?.lastSelection) {
      if (isSelectionFromCurrentNavigation(sourceWorkspace.lastSelection)) {
        const refreshed = await resolveSelectionInPreview(
          sourceWorkspace.lastSelection,
        );
        if (refreshed) {
          const stamped = attachSelectionContext(refreshed);
          const current = stamped?.captureContext || {};
          const framePlan = planFrameCapture({
            selection: stamped,
            currentUrl: current.pageUrl,
            currentNavigationToken: previewPickerToken,
            currentNavigationId: previewNavigationId,
            currentSourceId: previewView?.webContents.id,
            currentViewport: current.viewport,
          });
          selectionForFrame = framePlan.selectionForPayload;
          fallbackReason = framePlan.reason;
        } else fallbackReason = "target-not-found";
      } else {
        fallbackReason = "target-from-prior-navigation";
      }
    }
    if (!previewIdentityMatches(captureIdentity)) {
      throw new Error("Preview changed during Frame — wait for it to finish loading and try again.");
    }
    const shot = await takeScreenshotFile({
      bounds: selectionForFrame?.boundingBox || null,
      reason: "manual",
      padding: 112,
    });
    const discardUnstableShot = (message) => {
      try {
        fs.unlinkSync(shot.path);
      } catch {
        // Capture cleanup will remove any file another process still holds.
      }
      throw new Error(message);
    };
    if (!previewIdentityMatches(captureIdentity)) {
      discardUnstableShot(
        "Preview changed during Frame — capture discarded. Wait for loading to finish and try again.",
      );
    }
    if (selectionForFrame && !shot.cropped) {
      selectionForFrame = null;
      fallbackReason = "target-crop-failed";
    }
    if (selectionForFrame) {
      const resolvedAfterCapture = await resolveSelectionInPreview(selectionForFrame);
      const stableTarget = resolvedAfterCapture
        ? attachSelectionContext(resolvedAfterCapture)
        : null;
      const stability = evaluateSelectionStability({
        before: selectionForFrame,
        after: stableTarget,
      });
      if (!previewIdentityMatches(captureIdentity) || !stability.stable) {
        discardUnstableShot(
          "Target changed during Frame — capture discarded. Try again when the page is stable.",
        );
      }
    }
    const result = await deliverCapture(
      selectionForFrame,
      shot.path,
      "screenshot",
      {
        pasteToTerminal: true,
        writeClipboard: true,
        captureTarget,
      },
    );
    // A new Frame is a new coherent pair. If a target cannot be refreshed in
    // the current navigation, commit a screenshot-only capture instead of
    // pairing current pixels with stale DOM.
    const captureMeta = buildCaptureMeta({
      kind: "screenshot",
      selection: selectionForFrame,
      screenshotPath: shot.path,
      shot,
      result,
      captureMode:
        selectionForFrame && shot.cropped ? "target-context" : "viewport",
      fallbackReason,
      captureTarget,
    });
    commitCaptureForTarget(captureTarget, {
      selection: selectionForFrame,
      screenshotPath: shot.path,
      captureMeta,
      previewUrl:
        selectionForFrame?.pageUrl ||
        previewView?.webContents.getURL() ||
        captureTarget.previewUrl,
      viewportPreset: captureTarget.viewportPreset,
      viewportOrientation: captureTarget.viewportOrientation,
    });
    return {
      path: shot.path,
      fullPath: shot.fullPath,
      cropped: shot.cropped,
      screenshotPath: shot.path,
      selection: selectionForFrame,
      captureMode: captureMeta.captureMode,
      fallbackReason,
      captureMeta,
      targetSessionId: captureTarget.targetSessionId,
      ...result,
    };
  });
  if (locked && locked.busy) {
    throw new Error(locked.statusMessage || busyActionableText());
  }
  // On throw inside lock, prev pair is untouched (takeScreenshotFile no longer mutates)
  if (
    locked?.pastedToTerminal &&
    locked?.targetSessionId === activeTerminalId
  ) {
    scheduleTerminalFocus({ reason: "frame" });
  }
  return locked;
}

async function runScreenshotAndNotify(options = {}) {
  try {
    const result = await captureScreenshot(options);
    sendToRenderer("preview:status", previewStatusSnapshot());
    sendToRenderer("capture:result", {
      kind: "screenshot",
      ...result,
    });
    return result;
  } catch (err) {
    const message = err instanceof Error ? err.message : String(err);
    sendToRenderer("capture:result", { kind: "error", message });
    throw err;
  }
}

async function currentPreviewViewportSnapshot() {
  if (!previewView || previewView.webContents.isDestroyed()) return null;
  try {
    return await previewView.webContents.executeJavaScript(
      `({
        width: window.innerWidth,
        height: window.innerHeight,
        devicePixelRatio: window.devicePixelRatio || 1
      })`,
      true,
    );
  } catch {
    return null;
  }
}

async function runVerificationAndNotify() {
  const captureTarget = freezeActiveCaptureTarget();
  const workspace = getSessionState(
    coordinatorStateFromSlots(),
    captureTarget.targetSessionId,
  );
  const currentUrl = previewView?.webContents.getURL() || "";
  const currentViewport = await currentPreviewViewportSnapshot();
  const gate = canVerifyCapture(
    {
      selection: workspace?.lastSelection,
      screenshotPath: workspace?.lastScreenshotPath,
      captureMeta: workspace?.lastCaptureMeta,
    },
    {
      url: currentUrl,
      viewport: currentViewport,
      viewportPreset: viewportPresetId,
      viewportOrientation,
    },
  );
  if (!gate.ok) {
    const reasons = {
      "missing-selector": "Verify needs an earlier Aim capture with a DOM target.",
      "missing-before-image": "Verify needs the original capture image.",
      "page-changed": "Return to the same page before running Verify.",
      "viewport-changed": "Restore the capture viewport before running Verify.",
    };
    throw new Error(reasons[gate.reason] || "This capture cannot be verified.");
  }

  const locked = await withCaptureLock(async () => {
    const captureIdentity = snapshotPreviewIdentity();
    const beforeSelection = workspace.lastSelection;
    const resolvedBefore = await resolveSelectorInCurrentPreview(
      beforeSelection.selector,
    );
    if (!previewIdentityMatches(captureIdentity)) {
      throw new Error("Preview changed during Verify. Wait for it to settle and try again.");
    }
    const currentBefore = resolvedBefore
      ? attachSelectionContext(resolvedBefore)
      : null;
    const shot = await takeScreenshotFile({
      bounds: currentBefore?.boundingBox || null,
      reason: "verify",
      padding: 72,
    });
    const discard = (message) => {
      try {
        fs.unlinkSync(shot.path);
      } catch {
        // Scheduled cleanup can retry.
      }
      throw new Error(message);
    };
    if (
      (currentBefore && !shot.cropped) ||
      !previewIdentityMatches(captureIdentity)
    ) {
      discard("Preview changed during Verify. Wait for it to settle and try again.");
    }
    const resolvedAfter = await resolveSelectorInCurrentPreview(
      beforeSelection.selector,
    );
    const afterSelection = resolvedAfter
      ? attachSelectionContext(resolvedAfter)
      : null;
    const stability = currentBefore
      ? evaluateSelectionStability({
          before: currentBefore,
          after: afterSelection,
        })
      : { stable: true };
    if (!previewIdentityMatches(captureIdentity) || !stability.stable) {
      discard("Target moved during Verify. Wait for it to settle and try again.");
    }

    const comparison = compareSelections(beforeSelection, afterSelection);
    const afterMeta = buildCaptureMeta({
      kind: "verify",
      selection: afterSelection,
      screenshotPath: shot.path,
      shot,
      result: null,
      captureMode:
        currentBefore && shot.cropped ? "target-context" : "viewport",
      fallbackReason: currentBefore ? null : "target-not-found",
      captureTarget,
    });
    const pair = {
      before: {
        selection: beforeSelection,
        screenshotPath: workspace.lastScreenshotPath,
        captureMeta: workspace.lastCaptureMeta,
      },
      after: {
        selection: afterSelection,
        screenshotPath: shot.path,
        captureMeta: afterMeta,
      },
      comparison,
      verifiedAt: Date.now(),
    };
    const committed = commitVerifyForTarget(captureTarget, pair);
    return {
      verifyPair: committed?.verifyPair || pair,
      targetSessionId: captureTarget.targetSessionId,
    };
  });
  if (locked?.busy) {
    throw new Error(locked.statusMessage || busyActionableText());
  }
  sendToRenderer("capture:result", { kind: "verify", ...locked });
  return locked;
}

async function deliverVerificationAndNotify() {
  const captureTarget = freezeActiveCaptureTarget();
  const workspace = getSessionState(
    coordinatorStateFromSlots(),
    captureTarget.targetSessionId,
  );
  const pair = workspace?.verifyPair;
  if (!pair?.after?.screenshotPath) {
    throw new Error("Run Verify before sending a before/after result to Grok.");
  }
  const comparison = pair.comparison || {};
  const text = buildVerificationPayload({
    ...comparison,
    beforePath: pair.before?.screenshotPath,
    afterPath: pair.after?.screenshotPath,
    pageUrl:
      pair.after?.selection?.pageUrl ||
      pair.before?.selection?.pageUrl ||
      workspace.previewUrl,
  });
  const locked = await withCaptureLock(async () =>
    deliverCapture(
      pair.after?.selection || null,
      pair.after.screenshotPath,
      "verify",
      {
        pasteToTerminal: true,
        writeClipboard: true,
        captureTarget,
        payloadText: text,
        imagePaths: [
          pair.before?.screenshotPath,
          pair.after.screenshotPath,
        ].filter(Boolean),
      },
    ),
  );
  if (locked?.busy) {
    throw new Error(locked.statusMessage || busyActionableText());
  }
  sendToRenderer("capture:result", {
    verifyPair: pair,
    ...locked,
    kind: "verify-deliver",
  });
  if (
    locked?.pastedToTerminal &&
    captureTarget.targetSessionId === activeTerminalId
  ) {
    scheduleTerminalFocus({ reason: "verify" });
  }
  return locked;
}

async function resendLastCaptureAndNotify() {
  const captureTarget = freezeActiveCaptureTarget();
  const workspace = getSessionState(
    coordinatorStateFromSlots(),
    captureTarget.targetSessionId,
  );
  const selection = workspace?.lastSelection || null;
  const screenshotPath = workspace?.lastScreenshotPath || null;
  if (!selection && !screenshotPath) {
    const message = actionableError({ code: "nothing-to-resend" }).text;
    sendToRenderer("capture:result", { kind: "error", message });
    return { ok: false, message };
  }
  const locked = await withCaptureLock(async () =>
    deliverCapture(selection, screenshotPath, "deliver", {
      pasteToTerminal: true,
      writeClipboard: true,
      captureTarget,
    }),
  );
  if (locked?.busy) {
    const message = locked.statusMessage || busyActionableText();
    sendToRenderer("capture:result", { kind: "error", message });
    return { ok: false, message };
  }
  const captureMeta = {
    ...(workspace?.lastCaptureMeta || {}),
    resentAt: Date.now(),
    delivery: {
      terminalState: locked?.terminalState || null,
      textPasted: Boolean(locked?.textPasted),
      deliveryAttempted: Boolean(locked?.deliveryAttempted),
      deliveryConfirmed: Boolean(locked?.deliveryConfirmed),
      imageAttachment: locked?.imageAttachment || "none",
      imageChipAttempted: Boolean(locked?.imageChipAttempted),
      imageChipConfirmed: Boolean(locked?.imageChipConfirmed),
      fallback: locked?.fallback || null,
      statusMessage: locked?.statusMessage || "",
    },
  };
  commitCaptureForTarget(captureTarget, {
    selection,
    screenshotPath,
    captureMeta,
    preserveVerifyPair: true,
  });
  sendToRenderer("capture:result", {
    kind: "deliver",
    selection,
    ...locked,
    screenshotPath,
    captureMeta,
    targetSessionId: captureTarget.targetSessionId,
  });
  if (
    locked?.pastedToTerminal &&
    captureTarget.targetSessionId === activeTerminalId
  ) {
    scheduleTerminalFocus({ reason: "deliver" });
  }
  return locked;
}

function coordinatorStateFromSlots() {
  return createCoordinatorState({
    activeSessionId: activeTerminalId || "",
    sessions: Array.from(terminalSlots.values()).map((slot) => slot.meta),
  });
}

function applyCoordinatorState(state) {
  for (const session of state.sessions || []) {
    const slot = terminalSlots.get(session.id);
    if (!slot) continue;
    slot.meta = { ...slot.meta, ...session };
  }
}

function persistCurrentWorkspaceToSlot() {
  if (!activeTerminalId) return;
  const slot = terminalSlots.get(activeTerminalId);
  if (!slot) return;
  if (privateMode) privatePreviewUrls.set(activeTerminalId, previewUrl);
  slot.meta = {
    ...slot.meta,
    previewUrl: privateMode
      ? slot.meta.previewUrl || ""
      : sanitizeHistoryUrl(previewUrl) || "",
    viewportPreset: viewportPresetId,
    viewportOrientation,
    lastSelection,
    lastScreenshotPath,
    lastCaptureMeta,
    verifyPair: lastVerifyPair,
  };
}

function restoreActiveWorkspaceGlobals() {
  const active = activeTerminalId
    ? getSessionState(coordinatorStateFromSlots(), activeTerminalId)
    : null;
  previewUrl = privateMode
    ? privatePreviewUrls.get(activeTerminalId) || active?.previewUrl || ""
    : active?.previewUrl || "";
  viewportPresetId = normalizeViewportPreset(active?.viewportPreset);
  viewportOrientation =
    active?.viewportOrientation === "landscape" ? "landscape" : "portrait";
  lastSelection = active?.lastSelection || null;
  lastScreenshotPath = active?.lastScreenshotPath || null;
  lastCaptureMeta = active?.lastCaptureMeta || null;
  lastVerifyPair = active?.verifyPair || null;
}

function showActiveWorkspace() {
  restoreActiveWorkspaceGlobals();
  syncProjectCwdFromActive();
  if (previewView && !previewView.webContents.isDestroyed()) {
    layoutViews();
    if (previewUrl) loadPreview(previewUrl);
    else loadWelcomePreview();
  }
  sendToRenderer("capture:result", {
    kind: "workspace",
    previewUrl,
    viewportPreset: viewportPresetId,
    viewportOrientation,
    selection: lastSelection,
    screenshotPath: lastScreenshotPath,
    captureMeta: lastCaptureMeta,
    verifyPair: lastVerifyPair,
    targetSessionId: activeTerminalId,
  });
}

function freezeActiveCaptureTarget() {
  persistCurrentWorkspaceToSlot();
  const target = freezeCaptureTarget(coordinatorStateFromSlots(), {
    sessionId: activeTerminalId || undefined,
    captureId: crypto.randomUUID(),
    startedAt: Date.now(),
  });
  if (!captureInFlight) captureTargetSessionId = target.targetSessionId;
  return target;
}

function commitCaptureForTarget(target, capture) {
  const next = commitCapture(coordinatorStateFromSlots(), target, capture);
  applyCoordinatorState(next);
  if (target.targetSessionId === activeTerminalId) {
    restoreActiveWorkspaceGlobals();
  }
  persistTerminalSessions(true);
  return getSessionState(next, target.targetSessionId);
}

function commitVerifyForTarget(target, pair) {
  const next = commitVerifyPair(coordinatorStateFromSlots(), target, pair);
  applyCoordinatorState(next);
  if (target.targetSessionId === activeTerminalId) {
    restoreActiveWorkspaceGlobals();
  }
  persistTerminalSessions(true);
  return getSessionState(next, target.targetSessionId);
}

function listTerminalRuntime() {
  return Array.from(terminalSlots.values()).map((slot) => ({
    id: slot.meta.id,
    cwd: slot.meta.cwd,
    label: slot.meta.label,
    createdAt: slot.meta.createdAt,
    shellAlive: slot.pty.isAlive(),
    grokRunning: slot.pty.isGrokAlive(),
    mode: slot.pty.getMode(),
    alive: slot.pty.isAlive(),
    previewUrl: slot.meta.previewUrl || "",
    viewportPreset: slot.meta.viewportPreset || "fit",
    viewportOrientation: slot.meta.viewportOrientation || "portrait",
    lastSelection: slot.meta.lastSelection || null,
    lastScreenshotPath: slot.meta.lastScreenshotPath || null,
    lastCaptureMeta: slot.meta.lastCaptureMeta || null,
    verifyPair: slot.meta.verifyPair || null,
  }));
}

function getActiveSlot() {
  if (activeTerminalId && terminalSlots.has(activeTerminalId)) {
    return terminalSlots.get(activeTerminalId) || null;
  }
  const first = terminalSlots.values().next().value;
  if (first) {
    activeTerminalId = first.meta.id;
    return first;
  }
  return null;
}

function getSlot(sessionId) {
  if (sessionId && terminalSlots.has(sessionId)) {
    return terminalSlots.get(sessionId) || null;
  }
  return getActiveSlot();
}

function syncProjectCwdFromActive() {
  const active = getActiveSlot();
  if (active?.meta?.cwd) projectCwd = active.meta.cwd;
}

function persistTerminalSessions(force = true) {
  persistCurrentWorkspaceToSlot();
  syncProjectCwdFromActive();
  const list = Array.from(terminalSlots.values()).map((slot) => ({
    id: slot.meta.id,
    cwd: slot.meta.cwd,
    label: slot.meta.label,
    createdAt: slot.meta.createdAt,
    previewUrl: slot.meta.previewUrl || "",
    viewportPreset: slot.meta.viewportPreset || "fit",
    viewportOrientation: slot.meta.viewportOrientation || "portrait",
    lastSelection: slot.meta.lastSelection || null,
    lastScreenshotPath: slot.meta.lastScreenshotPath || null,
    lastCaptureMeta: slot.meta.lastCaptureMeta || null,
    verifyPair: slot.meta.verifyPair || null,
  }));
  persistDebounced(
    {
      projectCwd,
      terminalSessions: list,
      activeTerminalId: activeTerminalId || "",
    },
    { force },
  );
}

function broadcastTerminalSessions() {
  syncProjectCwdFromActive();
  const snap = sessionsSnapshot(listTerminalRuntime(), activeTerminalId);
  sendToRenderer("terminal:sessions", snap);
  return snap;
}

function emitTerminalStatus(slot, extra = {}) {
  if (!slot) return;
  const alive = slot.pty.isAlive();
  const grok = slot.pty.isGrokAlive();
  sendToRenderer("terminal:status", {
    sessionId: slot.meta.id,
    alive,
    shellAlive: alive,
    terminalMode: slot.pty.getMode(),
    grokRunning: grok,
    grokLaunchRequested: grok,
    grokReady: grok ? null : false,
    grokReadiness: grok ? "unknown" : "not-running",
    grokState: grok ? "running" : alive ? "idle" : "exited",
    cwd: slot.meta.cwd,
    ...extra,
  });
  broadcastTerminalSessions();
}

function disposeAllTerminals() {
  for (const slot of terminalSlots.values()) {
    try {
      slot.pty.dispose();
    } catch {
      /* ignore */
    }
  }
  terminalSlots.clear();
  privatePreviewUrls.clear();
  activeTerminalId = null;
}

/**
 * @param {{ id?: string, cwd?: string, label?: string, createdAt?: number, activate?: boolean, suppressSideEffects?: boolean }} [opts]
 */
function createTerminalSlot(opts = {}) {
  const gate = canCreateSession(terminalSlots.size, MAX_TERMINAL_SESSIONS);
  if (!gate.ok) {
    throw new Error(
      tr("term.maxSessions", { max: MAX_TERMINAL_SESSIONS }) ||
        `At most ${MAX_TERMINAL_SESSIONS} terminals.`,
    );
  }
  const cwd =
    typeof opts.cwd === "string" && isDirectory(opts.cwd)
      ? opts.cwd
      : projectCwd || defaultProjectCwd();
  const meta = createSessionMeta({
    id: opts.id,
    cwd,
    label: opts.label,
    createdAt: opts.createdAt,
    previewUrl: opts.previewUrl,
    viewportPreset: opts.viewportPreset,
    viewportOrientation: opts.viewportOrientation,
    lastSelection: opts.lastSelection,
    lastScreenshotPath: opts.lastScreenshotPath,
    lastCaptureMeta: opts.lastCaptureMeta,
    verifyPair: opts.verifyPair,
  });
  if (terminalSlots.has(meta.id)) {
    return terminalSlots.get(meta.id);
  }
  const pty = new TerminalSession({
    cwd: meta.cwd,
    onData: (data) =>
      sendToRenderer("terminal:data", { sessionId: meta.id, data }),
    onExit: (code, _signal, mode) => {
      sendToRenderer("terminal:exit", {
        sessionId: meta.id,
        code,
        mode,
      });
      emitTerminalStatus(
        terminalSlots.get(meta.id),
        { alive: false, shellAlive: false, reason: "exit" },
      );
    },
  });
  const slot = { meta, pty };
  const shouldActivate =
    !opts.suppressSideEffects &&
    (opts.activate !== false || !activeTerminalId);
  if (shouldActivate && activeTerminalId) persistCurrentWorkspaceToSlot();
  terminalSlots.set(meta.id, slot);
  if (shouldActivate) {
    activeTerminalId = meta.id;
    showActiveWorkspace();
  }
  if (!opts.suppressSideEffects) {
    persistTerminalSessions(true);
    broadcastTerminalSessions();
  }
  return slot;
}

function ensureTerminal(sessionId) {
  const existing = getSlot(sessionId);
  if (existing) return existing;
  return createTerminalSlot({ cwd: projectCwd, activate: true });
}

function setActiveTerminal(sessionId) {
  if (!sessionId || !terminalSlots.has(sessionId)) {
    return broadcastTerminalSessions();
  }
  persistCurrentWorkspaceToSlot();
  activeTerminalId = sessionId;
  showActiveWorkspace();
  persistTerminalSessions(true);
  return broadcastTerminalSessions();
}

/**
 * @param {string} sessionId
 * @param {{ force?: boolean }} [opts]
 */
async function closeTerminalSlot(sessionId, opts = {}) {
  if (!sessionId || !terminalSlots.has(sessionId)) {
    return { canceled: false, ...broadcastTerminalSessions() };
  }
  if (terminalSlots.size <= 1) {
    throw new Error(
      tr("term.keepOne") || "Keep at least one terminal tab.",
    );
  }
  assertSessionMutationAllowed(sessionId);
  const slot = terminalSlots.get(sessionId);
  const grokRunning = Boolean(slot?.pty?.isGrokAlive());
  if (!opts.force && shouldConfirmCloseTab({ grokRunning })) {
    const win =
      mainWindow && !mainWindow.isDestroyed() ? mainWindow : undefined;
    const confirmation = await dialog.showMessageBox(win, {
      type: "warning",
      title: tr("term.closeGrokTitle"),
      message: tr("term.closeGrokMessage"),
      detail: tr("term.closeGrokDetail", {
        tab: slot?.meta?.label || labelFromCwd(slot?.meta?.cwd) || sessionId,
      }),
      buttons: [tr("term.closeGrokConfirm"), tr("term.closeGrokCancel")],
      defaultId: 1,
      cancelId: 1,
      noLink: true,
    });
    if (confirmation.response !== 0) {
      return { canceled: true, ...broadcastTerminalSessions() };
    }
  }
  const ordered = Array.from(terminalSlots.keys());
  assertSessionMutationAllowed(sessionId);
  const closingActive = sessionId === activeTerminalId;
  if (closingActive) persistCurrentWorkspaceToSlot();
  try {
    slot?.pty.dispose();
  } catch {
    /* ignore */
  }
  terminalSlots.delete(sessionId);
  privatePreviewUrls.delete(sessionId);
  activeTerminalId = nextActiveAfterClose(
    ordered,
    activeTerminalId,
    sessionId,
  );
  if (closingActive) showActiveWorkspace();
  else syncProjectCwdFromActive();
  persistTerminalSessions(true);
  return { canceled: false, ...broadcastTerminalSessions() };
}

function seedTerminalsFromSettings(s) {
  disposeAllTerminals();
  const legacyPreviewUrl = sanitizeHistoryUrl(s?.previewUrl) || "";
  const normalized = normalizeSessionList(
    s?.terminalSessions,
    projectCwd || defaultProjectCwd(),
  );
  for (const meta of normalized.sessions) {
    createTerminalSlot({
      id: meta.id,
      cwd: isDirectory(meta.cwd) ? meta.cwd : projectCwd,
      label: meta.label,
      createdAt: meta.createdAt,
      previewUrl: meta.previewUrl,
      viewportPreset: meta.viewportPreset,
      viewportOrientation: meta.viewportOrientation,
      lastSelection: meta.lastSelection,
      lastScreenshotPath: meta.lastScreenshotPath,
      lastCaptureMeta: meta.lastCaptureMeta,
      verifyPair: meta.verifyPair,
      activate: false,
      suppressSideEffects: true,
    });
  }
  const preferred =
    typeof s?.activeTerminalId === "string" ? s.activeTerminalId : "";
  if (preferred && terminalSlots.has(preferred)) {
    activeTerminalId = preferred;
  } else {
    activeTerminalId = normalized.activeId;
  }
  if (
    legacyPreviewUrl &&
    !normalized.sessions.some((session) => session.previewUrl)
  ) {
    const active = activeTerminalId
      ? terminalSlots.get(activeTerminalId)
      : null;
    if (active) active.meta.previewUrl = legacyPreviewUrl;
  }
  syncProjectCwdFromActive();
  restoreActiveWorkspaceGlobals();
  persistTerminalSessions(true);
}

function isDirectory(cwd) {
  try {
    return Boolean(cwd && fs.statSync(cwd).isDirectory());
  } catch {
    return false;
  }
}

async function switchProjectCwd(cwd) {
  if (typeof cwd !== "string" || !isDirectory(cwd)) {
    throw new Error("Invalid directory");
  }
  const slot = ensureTerminal();
  assertSessionMutationAllowed(slot.meta.id);
  if (cwd === slot.meta.cwd) {
    return {
      projectCwd: slot.meta.cwd,
      sessionId: slot.meta.id,
      terminalRestarted: false,
      canceled: false,
    };
  }
  if (slot.pty.isGrokAlive()) {
    const confirmation = await dialog.showMessageBox(mainWindow, {
      type: "warning",
      title: "Switch project folder?",
      message: "Switching folders will stop Grok in this terminal tab.",
      detail: `Current: ${slot.meta.cwd}\nNew: ${cwd}`,
      buttons: ["Switch & stop Grok", "Cancel"],
      defaultId: 1,
      cancelId: 1,
      noLink: true,
    });
    if (confirmation.response !== 0) {
      return {
        projectCwd: slot.meta.cwd,
        sessionId: slot.meta.id,
        terminalRestarted: false,
        canceled: true,
      };
    }
  }
  assertSessionMutationAllowed(slot.meta.id);
  slot.meta.cwd = cwd;
  slot.meta.label = labelFromCwd(cwd);
  projectCwd = cwd;
  recentProjectCwds = [
    projectCwd,
    ...recentProjectCwds.filter((item) => item !== projectCwd),
  ].slice(0, 8);
  persist({ projectCwd, recentProjectCwds });
  persistTerminalSessions(true);

  let terminalRestarted = false;
  if (slot.pty.isAlive()) {
    const { cols, rows } = slot.pty;
    slot.pty.start({ cwd, cols, rows });
    terminalRestarted = true;
    emitTerminalStatus(slot, { reason: "project-changed" });
  } else {
    slot.pty.setCwd(cwd);
    broadcastTerminalSessions();
  }
  return {
    projectCwd: cwd,
    sessionId: slot.meta.id,
    terminalRestarted,
    canceled: false,
  };
}

function sendToRenderer(channel, payload) {
  if (mainWindow && !mainWindow.isDestroyed()) {
    mainWindow.webContents.send(channel, payload);
  }
}

/**
 * Move OS/Electron focus from WebContentsView → main webContents so xterm can receive keys.
 * Prefer scheduleTerminalFocus() after deliver so retries are coordinated.
 * @param {string} [reason]
 */
function focusMainTerminal(reason = "pick-or-deliver") {
  if (!mainWindow || mainWindow.isDestroyed()) return;
  try {
    if (!mainWindow.isFocused()) mainWindow.focus();
    // WebContentsView retains focus after pick clicks; reclaim for the shell renderer
    mainWindow.webContents.focus();
    sendToRenderer("terminal:focus-request", {
      reason,
      sessionId: activeTerminalId,
    });
  } catch (err) {
    console.warn("focusMainTerminal:", err);
  }
}

function registerIpc() {
  ipcMain.on("preview-picker:select", (event, envelope) => {
    if (
      !previewView ||
      event.sender !== previewView.webContents ||
      (event.senderFrame && event.senderFrame !== previewView.webContents.mainFrame)
    ) {
      return;
    }
    const validation = validateAimEvent({
      pickMode,
      inFlight: captureInFlight,
      eventNavigationToken: envelope?.token,
      currentNavigationToken: previewPickerToken,
      eventNavigationId: envelope?.navigationId,
      currentNavigationId: previewNavigationId,
      eventSourceId: event.sender.id,
      currentSourceId: previewView.webContents.id,
    });
    if (!validation.proceed) {
      if (validation.cancelPickMode) void setPickMode(false);
      if (validation.clearOverlay) void clearPickerOverlay();
      return;
    }
    const selection = envelope?.selection;
    const box = selection?.boundingBox;
    if (
      !selection ||
      typeof selection !== "object" ||
      !box ||
      ![box.x, box.y, box.width, box.height].every((value) =>
        Number.isFinite(Number(value)),
      )
    ) {
      void setPickMode(false);
      sendToRenderer("capture:result", {
        kind: "error",
        message: "Preview returned an invalid selection.",
      });
      return;
    }
    void handleTrustedAimSelection(
      attachSelectionContext(selection, event.sender.id),
    );
  });

  ipcMain.on("preview-picker:cancel", (event, envelope) => {
    if (!isTrustedPickerEnvelope(event, envelope, { requirePick: true })) return;
    void setPickMode(false);
  });

  ipcMain.on("preview-picker:resolved", (event, envelope) => {
    if (!isTrustedPickerEnvelope(event, envelope)) return;
    const requestId = envelope?.requestId;
    if (typeof requestId !== "string") return;
    const pending = pendingPreviewResolutions.get(requestId);
    if (!pending) return;
    pendingPreviewResolutions.delete(requestId);
    clearTimeout(pending.timer);
    pending.resolve(envelope.selection || null);
  });

  ipcMain.handle("app:get-state", () => {
    const active = getActiveSlot();
    const pty = active?.pty;
    const terminals = sessionsSnapshot(
      listTerminalRuntime(),
      activeTerminalId,
    );
    return {
      previewUrl,
      previewStatus: previewStatusSnapshot(),
      pickMode,
      lastSelection,
      lastScreenshotPath,
      lastCaptureMeta,
      lastVerifyPair,
      captureDir: CAPTURE_DIR,
      projectCwd: active?.meta.cwd || projectCwd,
      recentPreviewUrls,
      recentProjectCwds,
      splitRatio,
      previewCollapsed,
      locale: uiLocale,
      autoPasteTerminal,
      frameMode: preferredFrameMode,
      viewportPresets: Object.values(VIEWPORT_PRESETS),
      viewportPreset: viewportPresetId,
      viewportOrientation,
      privateMode,
      appVersion: app.getVersion(),
      captureBusy: captureInFlight,
      terminals,
      activeTerminalId: terminals.activeId,
      terminalAlive: Boolean(pty?.isAlive()),
      shellAlive: Boolean(pty?.isAlive()),
      terminalMode: pty?.getMode() || null,
      grokRunning: Boolean(pty?.isGrokAlive()),
      grokLaunchRequested: Boolean(pty?.isGrokAlive()),
      grokReady: pty?.isGrokAlive() ? null : false,
      grokReadiness: pty?.isGrokAlive() ? "unknown" : "not-running",
      grokState: pty?.isGrokAlive() ? "running" : "idle",
      layout: getLayoutBounds(),
    };
  });

  ipcMain.handle("app:set-locale", async (_e, next) => {
    const locale = setUiLocale(next);
    return { locale };
  });

  ipcMain.handle("app:copy-diagnostics", async () => {
    const bin = await grokBinaryExists();
    const text = formatDiagnosticSummary({
      appVersion: app.getVersion(),
      grokBinaryFound: bin.ok,
      activeSessionId: activeTerminalId,
      preview: {
        ...previewStatusSnapshot(),
        privateMode,
      },
      sessions: listTerminalRuntime().map((session) => ({
        ...session,
        cwdValid: isDirectory(session.cwd),
      })),
      settingsDir: path.dirname(settingsFile()),
      captureDir: CAPTURE_DIR,
      recentErrors: previewError
        ? [{ code: "preview-load", message: previewError, at: Date.now() }]
        : [],
    });
    clipboard.writeText(text);
    return { ok: true };
  });

  ipcMain.handle("app:check-updates", async () => {
    await shell.openExternal(
      "https://github.com/linhongcun/visual-edit-for-grok/releases/latest",
    );
    return { ok: true };
  });

  ipcMain.handle("layout:set-split", async (_e, ratio, opts = {}) => {
    const r = Number(ratio);
    if (!Number.isFinite(r)) return getLayoutBounds();
    splitRatio = Math.min(0.75, Math.max(0.22, r));
    // Live layout always; disk write debounced unless final flush (mouseup)
    const force = Boolean(opts?.force ?? opts?.persist);
    persistDebounced({ splitRatio }, { force });
    layoutViews();
    return getLayoutBounds();
  });

  ipcMain.handle("layout:set-preview-collapsed", async (_e, collapsed) => {
    return setPreviewCollapsed(Boolean(collapsed), { forcePersist: true });
  });

  ipcMain.handle("project:pick-cwd", async () => {
    const result = await dialog.showOpenDialog(mainWindow, {
      properties: ["openDirectory", "createDirectory"],
      title: "Project folder (Grok terminal cwd)",
      defaultPath: projectCwd,
    });
    if (!result.canceled && result.filePaths[0]) {
      return switchProjectCwd(result.filePaths[0]);
    }
    return { projectCwd, terminalRestarted: false, canceled: true };
  });

  ipcMain.handle("project:set-cwd", async (_e, cwd) => {
    return switchProjectCwd(cwd);
  });

  ipcMain.handle("preview:navigate", async (_e, url) => {
    loadPreview(url);
    return { ok: true };
  });

  ipcMain.handle("preview:reload", async () => {
    reloadPreviewPage();
    return { ok: true };
  });

  ipcMain.handle("preview:go-back", async () => {
    if (previewView?.webContents.navigationHistory.canGoBack()) {
      previewView.webContents.navigationHistory.goBack();
    }
    return { ok: true };
  });

  ipcMain.handle("preview:go-forward", async () => {
    if (previewView?.webContents.navigationHistory.canGoForward()) {
      previewView.webContents.navigationHistory.goForward();
    }
    return { ok: true };
  });

  ipcMain.handle("preview:set-private-mode", async (_event, enabled) =>
    setPrivatePreviewMode(enabled),
  );

  ipcMain.handle("preview:clear-data", async (_event, scope = "all") => {
    const result = await clearPreviewData(scope === "origin" ? "origin" : "all");
    if (previewView && !previewView.webContents.isDestroyed()) {
      previewView.webContents.reload();
    }
    return result;
  });

  ipcMain.handle("preview:set-pick-mode", async (_e, enabled) => {
    const on = Boolean(enabled);
    let warning = null;
    if (on && !isPreviewCapturable()) {
      warning = actionableError({ code: "preview-not-ready" }).text;
    } else if (on && !getActiveSlot()?.pty?.isGrokAlive()) {
      warning = tr("main.pickWarningNoGrok");
    }
    await setPickMode(on);
    return {
      pickMode,
      warning,
      terminalAlive: Boolean(getActiveSlot()?.pty?.isAlive()),
    };
  });

  ipcMain.handle("capture:screenshot", async (_event, options = {}) =>
    runScreenshotAndNotify(options),
  );

  ipcMain.handle("capture:recopy", async (_e, enrichment = {}) => {
    const captureTarget = freezeActiveCaptureTarget();
    const workspace = getSessionState(
      coordinatorStateFromSlots(),
      captureTarget.targetSessionId,
    );
    const selection = workspace?.lastSelection || null;
    const screenshotPath = workspace?.lastScreenshotPath || null;
    if (!selection && !screenshotPath) {
      throw new Error(
        actionableError({ code: "nothing-to-resend" }).text,
      );
    }
    const locked = await withCaptureLock(async () =>
      deliverCapture(selection, screenshotPath, "recopy", {
        intent: enrichment?.intent ?? null,
        styleDiffs: enrichment?.styleDiffs ?? null,
        pasteToTerminal: enrichment?.pasteToTerminal !== false,
        writeClipboard: true,
        captureTarget,
      }),
    );
    if (locked && locked.busy) {
      const message = locked.statusMessage || busyActionableText();
      sendToRenderer("capture:result", {
        kind: "error",
        message,
      });
      throw new Error(message);
    }
    sendToRenderer("capture:result", {
      kind: "recopy",
      selection,
      screenshotPath,
      ...locked,
    });
    if (
      locked?.pastedToTerminal &&
      captureTarget.targetSessionId === activeTerminalId
    ) {
      scheduleTerminalFocus({ reason: "recopy" });
    }
    return locked;
  });

  /** Re-send last capture into Grok (multimodal image + text). */
  ipcMain.handle("capture:deliver", async () => resendLastCaptureAndNotify());
  ipcMain.handle("capture:verify", async () => runVerificationAndNotify());
  ipcMain.handle("capture:verify-deliver", async () =>
    deliverVerificationAndNotify(),
  );

  ipcMain.handle("capture:open-folder", async () => {
    ensureCaptureDir();
    const error = await shell.openPath(CAPTURE_DIR);
    if (error) throw new Error(`Could not open Frames folder: ${error}`);
    return { ok: true, path: CAPTURE_DIR };
  });

  ipcMain.handle("shell:open-external", async (event, rawUrl) => {
    if (!mainWindow || event.sender !== mainWindow.webContents) {
      throw new Error("Untrusted link source");
    }
    let parsed;
    try {
      parsed = new URL(String(rawUrl || ""));
    } catch {
      throw new Error("Invalid link");
    }
    if (!["http:", "https:"].includes(parsed.protocol)) {
      throw new Error("Only http(s) links can be opened");
    }
    await shell.openExternal(parsed.href);
    return { ok: true };
  });

  ipcMain.handle("capture:thumbnail", async (_event, requestedPath) => {
    const active = activeTerminalId
      ? getSessionState(coordinatorStateFromSlots(), activeTerminalId)
      : null;
    const allowedPaths = new Set(
      [
        active?.lastScreenshotPath,
        active?.verifyPair?.before?.screenshotPath,
        active?.verifyPair?.after?.screenshotPath,
      ].filter(Boolean),
    );
    if (
      typeof requestedPath !== "string" ||
      !allowedPaths.has(requestedPath) ||
      !requestedPath.startsWith(`${CAPTURE_DIR}${path.sep}`) ||
      !fs.existsSync(requestedPath)
    ) {
      return { dataUrl: null };
    }
    const image = nativeImage.createFromPath(requestedPath);
    if (image.isEmpty()) return { dataUrl: null };
    const size = image.getSize();
    const scale = Math.min(1, 520 / size.width, 300 / size.height);
    const thumbnail =
      scale < 1
        ? image.resize({
            width: Math.max(1, Math.round(size.width * scale)),
            height: Math.max(1, Math.round(size.height * scale)),
            quality: "good",
          })
        : image;
    return { dataUrl: thumbnail.toDataURL() };
  });

  ipcMain.handle("capture:clear", async () => {
    if (!activeTerminalId) return { ok: true };
    const next = clearSessionCapture(
      coordinatorStateFromSlots(),
      activeTerminalId,
    );
    applyCoordinatorState(next);
    restoreActiveWorkspaceGlobals();
    persistTerminalSessions(true);
    sendToRenderer("preview:status", previewStatusSnapshot());
    return { ok: true, targetSessionId: activeTerminalId };
  });

  ipcMain.handle("capture:set-auto-paste", async (_e, enabled) => {
    autoPasteTerminal = Boolean(enabled);
    return { autoPasteTerminal };
  });

  ipcMain.handle("capture:set-frame-mode", async (_event, mode) => {
    preferredFrameMode =
      mode === "target-context" ? "target-context" : "viewport";
    return { frameMode: preferredFrameMode };
  });

  ipcMain.handle("preview:set-viewport", async (_event, opts = {}) => {
    viewportPresetId = normalizeViewportPreset(opts.presetId);
    viewportOrientation =
      opts.orientation === "landscape" ? "landscape" : "portrait";
    persist({
      viewportPreset: viewportPresetId,
      viewportOrientation,
    });
    persistTerminalSessions(true);
    layoutViews();
    const status = previewStatusSnapshot();
    sendToRenderer("preview:status", status);
    return status;
  });

  // —— Terminal (multi-session) ——
  ipcMain.handle("terminal:list", async () => broadcastTerminalSessions());

  ipcMain.handle("terminal:create", async (_e, opts = {}) => {
    const cwd =
      typeof opts.cwd === "string" && isDirectory(opts.cwd)
        ? opts.cwd
        : projectCwd;
    const slot = createTerminalSlot({
      cwd,
      label: opts.label,
      activate: opts.activate !== false,
    });
    return {
      ok: true,
      sessionId: slot.meta.id,
      ...broadcastTerminalSessions(),
    };
  });

  ipcMain.handle("terminal:close", async (_e, sessionId) => {
    return closeTerminalSlot(sessionId, { force: false });
  });

  ipcMain.handle("terminal:set-active", async (_e, sessionId) => {
    return setActiveTerminal(sessionId);
  });

  ipcMain.handle("terminal:start", async (_e, opts = {}) => {
    assertSessionMutationAllowed(opts.sessionId || activeTerminalId);
    const slot = ensureTerminal(opts.sessionId);
    const cols = opts.cols || 80;
    const rows = opts.rows || 24;
    try {
      slot.pty.start({ cwd: slot.meta.cwd, cols, rows });
      emitTerminalStatus(slot);
      return {
        ok: true,
        cwd: slot.meta.cwd,
        sessionId: slot.meta.id,
      };
    } catch (err) {
      const raw = err instanceof Error ? err.message : String(err);
      const guided = actionableError({
        code: "terminal-start-fail",
        message: raw,
        detail: raw,
      });
      emitTerminalStatus(slot, { alive: false, error: guided.text });
      throw new Error(guided.text);
    }
  });

  ipcMain.handle("terminal:write", async (_e, payload) => {
    const opts =
      payload && typeof payload === "object" && !Array.isArray(payload)
        ? payload
        : { data: payload };
    const slot = getSlot(opts.sessionId);
    if (!slot?.pty?.isAlive()) return { ok: false };
    slot.pty.write(String(opts.data ?? ""));
    return { ok: true, sessionId: slot.meta.id };
  });

  ipcMain.handle("terminal:paste", async (_e, payload) => {
    const opts =
      payload && typeof payload === "object" && !Array.isArray(payload)
        ? payload
        : { text: payload };
    const slot = getSlot(opts.sessionId);
    if (!slot?.pty?.isAlive()) {
      throw new Error("Terminal not running");
    }
    slot.pty.paste(String(opts.text ?? ""));
    return { ok: true, sessionId: slot.meta.id };
  });

  ipcMain.handle("terminal:resize", async (_e, size = {}) => {
    const slot = getSlot(size.sessionId);
    if (!slot) return { ok: false };
    const cols = size?.cols || 80;
    const rows = size?.rows || 24;
    slot.pty.resize(cols, rows);
    return { ok: true, sessionId: slot.meta.id };
  });

  ipcMain.handle("terminal:launch-grok", async (_e, opts = {}) => {
    const slot = ensureTerminal(opts.sessionId);
    if (opts.sessionId && slot.meta.id !== activeTerminalId) {
      setActiveTerminal(slot.meta.id);
    }
    if (slot.pty.isGrokAlive()) {
      return {
        ok: true,
        alreadyRunning: true,
        cwd: slot.meta.cwd,
        sessionId: slot.meta.id,
        terminalMode: "grok",
        grokRunning: true,
        grokReady: null,
        grokReadiness: "unknown",
        grokState: "running",
      };
    }
    const bin = await grokBinaryExists();
    if (!bin.ok) {
      const guided = actionableError({ code: "grok-missing" });
      throw new Error(guided.text);
    }
    try {
      sendToRenderer("terminal:data", {
        sessionId: slot.meta.id,
        data: `\r\n\x1b[90m[Starting Grok directly in ${slot.meta.cwd}]\x1b[0m\r\n`,
      });
      const result = slot.pty.launchGrok({
        cwd: slot.meta.cwd,
        cols: slot.pty.cols,
        rows: slot.pty.rows,
      });
      emitTerminalStatus(slot, {
        grokRunning: true,
        grokLaunchRequested: true,
        grokReady: null,
        grokReadiness: "unknown",
        grokState: "running",
      });
      return {
        ok: true,
        cwd: slot.meta.cwd,
        sessionId: slot.meta.id,
        grokReady: null,
        grokReadiness: "unknown",
        grokState: "running",
        ...result,
      };
    } catch (err) {
      const raw = err instanceof Error ? err.message : String(err);
      const guided = actionableError({
        code: /ENOENT|not found|no such file/i.test(raw)
          ? "grok-missing"
          : "grok-launch-fail",
        message: raw,
        detail: raw,
      });
      emitTerminalStatus(slot, {
        grokRunning: false,
        grokLaunchRequested: false,
        grokReady: false,
        error: guided.text,
      });
      throw new Error(guided.text);
    }
  });

  ipcMain.handle("terminal:restart", async (_e, opts = {}) => {
    assertSessionMutationAllowed(opts.sessionId || activeTerminalId);
    const slot = ensureTerminal(opts.sessionId);
    slot.pty.start({
      cwd: slot.meta.cwd,
      cols: opts.cols || slot.pty.cols,
      rows: opts.rows || slot.pty.rows,
    });
    emitTerminalStatus(slot);
    return { ok: true, cwd: slot.meta.cwd, sessionId: slot.meta.id };
  });
}

app.whenReady().then(() => {
  applyLoadedSettings();
  registerIpc();
  createWindow();
  app.on("activate", () => {
    if (BrowserWindow.getAllWindows().length === 0) createWindow();
  });
});

app.on("before-quit", (event) => {
  // Cmd+Q / menu Quit — confirm while session is alive
  if (isQuitting) return;
  requestQuitConfirmation(event, "quit");
});

app.on("window-all-closed", () => {
  disposeAllTerminals();
  if (process.platform !== "darwin") app.quit();
});
