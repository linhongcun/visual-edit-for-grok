const {
  app,
  BrowserWindow,
  BrowserView,
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
const { execFileSync } = require("child_process");
const { buildClipboardPayload } = require("./clipboard-payload.cjs");
const { TerminalSession } = require("./terminal.cjs");
const {
  loadSettings,
  saveSettings,
  defaultSettingsPath,
} = require("./settings-store.cjs");
const { cleanupCaptureDir } = require("./capture-cleanup.cjs");
const {
  buildPasteStatus,
  classifyDeliveryOutcome,
  deliveryOutcomeLabel,
} = require("./delivery-status.cjs");
const { t, normalizeLocale, detectLocale } = require("../i18n/index.cjs");
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
  DEFAULT_CLEANUP_MIN_INTERVAL_MS,
  DEFAULT_SETTINGS_DEBOUNCE_MS,
} = require("./runtime-policy.cjs");

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
  recentPreviewUrls = Array.isArray(s.recentPreviewUrls)
    ? s.recentPreviewUrls
    : [];
  recentProjectCwds = Array.isArray(s.recentProjectCwds)
    ? s.recentProjectCwds.filter((cwd) => isDirectory(cwd))
    : [];
  return s;
}

/** @param {string} key @param {Record<string, string | number>} [vars] */
function tr(key, vars) {
  return t(uiLocale, key, vars);
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
// Keep in sync with src/styles.css --toolbar-height
const TOOLBAR_HEIGHT = 96;
const SPLITTER_WIDTH = 5;
// Wider floor so Grok TUI tables keep more columns when the split is tight
const MIN_TERMINAL_WIDTH = 400;
const MIN_PREVIEW_WIDTH = 320;

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
/** @type {BrowserView | null} */
let previewView = null;
/** @type {TerminalSession | null} */
let termSession = null;

let pickMode = false;
let previewUrl = "";
/** @type {object | null} */
let lastSelection = null;
/** @type {string | null} */
let lastScreenshotPath = null;
/** @type {object | null} */
let lastCaptureMeta = null;
/** Left pane ratio 0–1 */
let splitRatio = 0.52;
/** @type {"en" | "zh"} */
let uiLocale = "en";
let projectCwd = defaultProjectCwd();
/** Auto-paste capture into terminal */
let autoPasteTerminal = true;
let preferredFrameMode = "viewport";
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

function ensureCaptureDir() {
  fs.mkdirSync(CAPTURE_DIR, { recursive: true });
}

function setCaptureBusy(busy) {
  captureInFlight = Boolean(busy);
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
    return {
      busy: true,
      statusMessage: tr("main.busy"),
    };
  }
  setCaptureBusy(true);
  try {
    return await fn();
  } finally {
    setCaptureBusy(false);
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
  mainWindow.on("closed", () => {
    mainWindow = null;
    previewView = null;
    if (termSession) {
      termSession.dispose();
      termSession = null;
    }
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
    // BrowserView to avoid a duplicate action.
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

function previewStatusSnapshot(overrides = {}) {
  const contents = previewView?.webContents;
  const rawUrl = contents && !contents.isDestroyed() ? contents.getURL() : "";
  const isWelcome = rawUrl.startsWith("file:") && rawUrl.endsWith("/welcome.html");
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
      message: plan.statusMessage || tr("main.aimBusy"),
    });
    return;
  }

  const prevSelection = lastSelection;
  const prevScreenshotPath = lastScreenshotPath;
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
      { pasteToTerminal: true, writeClipboard: true },
    );
    const commit = resolvePickCommit({
      ok: true,
      selection,
      screenshotPath: shot.path,
      prevSelection,
      prevScreenshotPath,
    });
    lastSelection = commit.lastSelection;
    lastScreenshotPath = commit.lastScreenshotPath;
    uncommittedShotPath = null;
    lastCaptureMeta = buildCaptureMeta({
      kind: "selection",
      selection: lastSelection,
      screenshotPath: lastScreenshotPath,
      shot,
      result,
      captureMode: "target-context",
    });
    await clearPickerOverlay();
    sendToRenderer("capture:result", {
      kind: "selection",
      selection: lastSelection,
      ...result,
      screenshotPath: lastScreenshotPath,
      captureMeta: lastCaptureMeta,
    });
    sendToRenderer("preview:status", previewStatusSnapshot());
    if (result.pastedToTerminal) scheduleTerminalFocus({ reason: "pick" });
  } catch (err) {
    if (uncommittedShotPath) {
      try {
        fs.unlinkSync(uncommittedShotPath);
      } catch {
        // Capture cleanup will remove any file another process still holds.
      }
    }
    const commit = resolvePickCommit({
      ok: false,
      selection: null,
      screenshotPath: null,
      prevSelection,
      prevScreenshotPath,
    });
    lastSelection = commit.lastSelection;
    lastScreenshotPath = commit.lastScreenshotPath;
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

  previewView = new BrowserView({
    webPreferences: {
      preload: path.join(__dirname, "preview-preload.cjs"),
      contextIsolation: true,
      nodeIntegration: false,
      sandbox: true,
      webSecurity: true,
      partition: "persist:vefg-preview",
    },
  });

  mainWindow.setBrowserView(previewView);
  bindAppShortcuts(previewView.webContents);

  // Aim and Frame require no website permissions. Keep embedded content from
  // requesting clipboard, media, notifications, fullscreen, or other grants.
  previewView.webContents.session.setPermissionRequestHandler(
    (_contents, _permission, callback) => callback(false),
  );
  previewView.webContents.session.setPermissionCheckHandler(() => false);

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
      persist({ previewUrl });
    }
    sendToRenderer("preview:status", previewStatusSnapshot());
  });

  previewView.webContents.on("did-navigate", (_event, url) => {
    if (/^https?:/i.test(url)) {
      previewUrl = url;
      persist({ previewUrl });
    } else if (url.endsWith("/welcome.html")) {
      previewUrl = "";
      persist({ previewUrl: "" });
    }
    sendToRenderer("preview:status", previewStatusSnapshot());
  });

  previewView.webContents.on("did-finish-load", () => {
    previewLoading = false;
    previewError = null;
    configurePreviewPicker();
    sendToRenderer("preview:status", previewStatusSnapshot());
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

function getLayoutBounds() {
  if (!mainWindow) {
    return {
      toolbarHeight: TOOLBAR_HEIGHT,
      terminalWidth: 600,
      previewWidth: 600,
      contentWidth: 1200,
      contentHeight: 800,
      splitRatio,
    };
  }
  const [width, height] = mainWindow.getContentSize();
  const { terminalWidth, previewWidth } = computeSplit(width);
  return {
    toolbarHeight: TOOLBAR_HEIGHT,
    terminalWidth,
    previewWidth,
    contentWidth: width,
    contentHeight: height,
    splitRatio,
  };
}

function computeSplit(width) {
  let terminalWidth = Math.round(width * splitRatio);
  terminalWidth = Math.max(
    MIN_TERMINAL_WIDTH,
    Math.min(terminalWidth, width - MIN_PREVIEW_WIDTH - SPLITTER_WIDTH),
  );
  const previewWidth = Math.max(
    MIN_PREVIEW_WIDTH,
    width - terminalWidth - SPLITTER_WIDTH,
  );
  return { terminalWidth, previewWidth };
}

function layoutViews() {
  if (!mainWindow || !previewView) return;
  const [width, height] = mainWindow.getContentSize();
  const { terminalWidth, previewWidth } = computeSplit(width);
  const y = TOOLBAR_HEIGHT;
  const h = Math.max(120, height - TOOLBAR_HEIGHT);

  // Preview sits on the right; left is free for xterm in the renderer
  previewView.setBounds({
    x: terminalWidth + SPLITTER_WIDTH,
    y,
    width: previewWidth,
    height: h,
  });
  previewView.setAutoResize({ width: false, height: false });

  sendToRenderer("layout:bounds", {
    toolbarHeight: TOOLBAR_HEIGHT,
    terminalWidth,
    previewWidth,
    contentWidth: width,
    contentHeight: height,
    splitRatio: terminalWidth / width,
  });
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
      throw new Error("Only http(s) URLs are supported");
    }
    previewUrl = parsed.href;
    recentPreviewUrls = [previewUrl, ...recentPreviewUrls.filter((item) => item !== previewUrl)].slice(0, 8);
    persist({ previewUrl, recentPreviewUrls });
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
      selector: selection.selector,
    });
  });
}

/**
 * Put screenshot on the OS clipboard in the form Grok TUI expects for
 * multimodal image chips (file paste preferred; native image fallback).
 * @param {string} filePath
 * @returns {boolean}
 */
function putScreenshotOnClipboardForGrok(filePath) {
  if (!filePath || !fs.existsSync(filePath)) return false;

  // macOS: file-on-clipboard → Grok "copy file then paste" creates a real image chip
  if (process.platform === "darwin") {
    try {
      const escaped = filePath.replace(/\\/g, "\\\\").replace(/"/g, '\\"');
      execFileSync(
        "osascript",
        ["-e", `set the clipboard to (POSIX file "${escaped}")`],
        { timeout: 4000 },
      );
      return true;
    } catch (err) {
      console.warn("osascript file clipboard failed, trying writeImage:", err);
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
async function pasteToGrokMultimodal(text, screenshotPath) {
  const terminalAlive = Boolean(termSession?.isAlive());
  const grokRunning = Boolean(termSession?.isGrokAlive());
  const hasShot = Boolean(screenshotPath && fs.existsSync(screenshotPath));

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

  focusMainTerminal();
  await delay(90);

  let imagePrepared = false;
  let imageChipAttempted = false;
  if (hasShot) {
    imagePrepared = putScreenshotOnClipboardForGrok(screenshotPath);
    if (imagePrepared) {
      await delay(60);
      try {
        imageChipAttempted = Boolean(termSession.write("\x16"));
        await delay(280);
      } catch (err) {
        console.warn("Ctrl+V inject failed:", err);
        imageChipAttempted = false;
      }
    }
  }

  let textPasted = false;
  try {
    textPasted = termSession.paste(text);
    await delay(40);
  } catch (err) {
    console.warn("text paste failed:", err);
    textPasted = false;
  }

  // Keep a real file/image on the clipboard after the automatic attempt so
  // the operator-facing “press ⌘V if needed” fallback remains truthful.
  if (hasShot) putScreenshotOnClipboardForGrok(screenshotPath);
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
 * }} [options]
 */
async function deliverCapture(
  selection,
  screenshotPath,
  kind = "capture",
  options = {},
) {
  const intent = options.intent ?? null;
  const styleDiffs = options.styleDiffs ?? null;
  const writeClipboard = options.writeClipboard !== false;
  const wantPaste =
    options.pasteToTerminal === false
      ? false
      : options.pasteToTerminal === true
        ? true
        : autoPasteTerminal;

  const text = buildClipboardPayload({
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
  let terminalAlive = Boolean(termSession?.isAlive());
  let deliveryDetails = {};

  if (wantPaste) {
    const result = await pasteToGrokMultimodal(text, screenshotPath);
    deliveryDetails = result;
    pastedToTerminal = result.pasted;
    imageChip = result.imageChip;
    imagePrepared = result.imagePrepared;
    fallback = result.fallback;
    statusMessage = result.statusMessage;
    terminalAlive = result.terminalAlive;
  } else if (writeClipboard) {
    if (hasImage && screenshotPath) {
      imagePrepared = putScreenshotOnClipboardForGrok(screenshotPath);
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
  ensureCaptureDir();

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
    `${prefix}${cropped ? "-el" : "-full"}-${stamp}.png`,
  );
  fs.writeFileSync(filePath, outImage.toPNG());
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
    throw new Error("Preview is not ready — open a loaded http(s) page first.");
  }
  const requestedMode = ["viewport", "target-context"].includes(options?.mode)
    ? options.mode
    : preferredFrameMode;
  preferredFrameMode = requestedMode;
  const locked = await withCaptureLock(async () => {
    if (!isPreviewCapturable()) {
      throw new Error("Preview is not ready — wait for loading to finish.");
    }
    const captureIdentity = snapshotPreviewIdentity();
    let selectionForFrame = null;
    let fallbackReason = null;
    if (requestedMode === "target-context" && lastSelection) {
      if (isSelectionFromCurrentNavigation(lastSelection)) {
        const refreshed = await resolveSelectionInPreview(lastSelection);
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
      { pasteToTerminal: true, writeClipboard: true },
    );
    // A new Frame is a new coherent pair. If a target cannot be refreshed in
    // the current navigation, commit a screenshot-only capture instead of
    // pairing current pixels with stale DOM.
    lastSelection = selectionForFrame;
    lastScreenshotPath = shot.path;
    lastCaptureMeta = buildCaptureMeta({
      kind: "screenshot",
      selection: lastSelection,
      screenshotPath: lastScreenshotPath,
      shot,
      result,
      captureMode:
        selectionForFrame && shot.cropped ? "target-context" : "viewport",
      fallbackReason,
    });
    return {
      path: shot.path,
      fullPath: shot.fullPath,
      cropped: shot.cropped,
      screenshotPath: lastScreenshotPath,
      selection: lastSelection,
      captureMode: lastCaptureMeta.captureMode,
      fallbackReason,
      captureMeta: lastCaptureMeta,
      ...result,
    };
  });
  if (locked && locked.busy) {
    throw new Error(locked.statusMessage || tr("main.busy"));
  }
  // On throw inside lock, prev pair is untouched (takeScreenshotFile no longer mutates)
  if (locked?.pastedToTerminal) {
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
      selection: lastSelection,
      ...result,
    });
    return result;
  } catch (err) {
    const message = err instanceof Error ? err.message : String(err);
    sendToRenderer("capture:result", { kind: "error", message });
    throw err;
  }
}

async function resendLastCaptureAndNotify() {
  if (!lastSelection && !lastScreenshotPath) {
    const message = tr("main.nothingResend");
    sendToRenderer("capture:result", { kind: "error", message });
    return { ok: false, message };
  }
  const locked = await withCaptureLock(async () =>
    deliverCapture(lastSelection, lastScreenshotPath, "deliver", {
      pasteToTerminal: true,
      writeClipboard: true,
    }),
  );
  if (locked?.busy) {
    const message = locked.statusMessage || tr("main.busy");
    sendToRenderer("capture:result", { kind: "error", message });
    return { ok: false, message };
  }
  lastCaptureMeta = {
    ...(lastCaptureMeta || {}),
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
  sendToRenderer("capture:result", {
    kind: "deliver",
    selection: lastSelection,
    ...locked,
    captureMeta: lastCaptureMeta,
  });
  if (locked?.pastedToTerminal) scheduleTerminalFocus({ reason: "deliver" });
  return locked;
}

function ensureTerminal() {
  if (termSession) return termSession;
  termSession = new TerminalSession({
    cwd: projectCwd,
    onData: (data) => sendToRenderer("terminal:data", data),
    onExit: (code, _signal, mode) => {
      sendToRenderer("terminal:exit", { code, mode });
      sendToRenderer("terminal:status", {
        alive: false,
        shellAlive: false,
        terminalMode: null,
        grokRunning: false,
        grokLaunchRequested: false,
        grokReady: false,
      });
    },
  });
  return termSession;
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
  if (cwd === projectCwd) {
    return { projectCwd, terminalRestarted: false, canceled: false };
  }
  if (termSession?.isGrokAlive()) {
    const confirmation = await dialog.showMessageBox(mainWindow, {
      type: "warning",
      title: "Switch project folder?",
      message: "Switching folders will stop the active Grok session.",
      detail: `Current: ${projectCwd}\nNew: ${cwd}`,
      buttons: ["Switch & stop Grok", "Cancel"],
      defaultId: 1,
      cancelId: 1,
      noLink: true,
    });
    if (confirmation.response !== 0) {
      return { projectCwd, terminalRestarted: false, canceled: true };
    }
  }
  projectCwd = cwd;
  recentProjectCwds = [
    projectCwd,
    ...recentProjectCwds.filter((item) => item !== projectCwd),
  ].slice(0, 8);
  persist({ projectCwd, recentProjectCwds });

  let terminalRestarted = false;
  if (termSession?.isAlive()) {
    const { cols, rows } = termSession;
    termSession.start({ cwd: projectCwd, cols, rows });
    terminalRestarted = true;
    sendToRenderer("terminal:status", {
      alive: true,
      shellAlive: true,
      terminalMode: "shell",
      grokRunning: false,
      grokLaunchRequested: false,
      grokReady: false,
      cwd: projectCwd,
      reason: "project-changed",
    });
  } else {
    termSession?.setCwd(projectCwd);
  }
  return { projectCwd, terminalRestarted, canceled: false };
}

function sendToRenderer(channel, payload) {
  if (mainWindow && !mainWindow.isDestroyed()) {
    mainWindow.webContents.send(channel, payload);
  }
}

/**
 * Move OS/Electron focus from BrowserView → main webContents so xterm can receive keys.
 * Prefer scheduleTerminalFocus() after deliver so retries are coordinated.
 * @param {string} [reason]
 */
function focusMainTerminal(reason = "pick-or-deliver") {
  if (!mainWindow || mainWindow.isDestroyed()) return;
  try {
    if (!mainWindow.isFocused()) mainWindow.focus();
    // BrowserView retains focus after pick clicks; reclaim for the shell renderer
    mainWindow.webContents.focus();
    sendToRenderer("terminal:focus-request", { reason });
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

  ipcMain.handle("app:get-state", () => ({
    previewUrl,
    previewStatus: previewStatusSnapshot(),
    pickMode,
    lastSelection,
    lastScreenshotPath,
    lastCaptureMeta,
    captureDir: CAPTURE_DIR,
    projectCwd,
    recentPreviewUrls,
    recentProjectCwds,
    splitRatio,
    locale: uiLocale,
    autoPasteTerminal,
    frameMode: preferredFrameMode,
    captureBusy: captureInFlight,
    terminalAlive: Boolean(termSession?.isAlive()),
    shellAlive: Boolean(termSession?.isAlive()),
    terminalMode: termSession?.getMode() || null,
    grokRunning: Boolean(termSession?.isGrokAlive()),
    grokLaunchRequested: Boolean(termSession?.isGrokAlive()),
    grokReady: termSession?.isGrokAlive() ? null : false,
    grokReadiness: termSession?.isGrokAlive() ? "unknown" : "not-running",
    grokState: termSession?.isGrokAlive() ? "running" : "idle",
    layout: getLayoutBounds(),
  }));

  ipcMain.handle("app:set-locale", async (_e, next) => {
    const locale = setUiLocale(next);
    return { locale };
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

  ipcMain.handle("preview:set-pick-mode", async (_e, enabled) => {
    const on = Boolean(enabled);
    let warning = null;
    if (on && !isPreviewCapturable()) {
      warning = tr("main.pickWarningNoPreview");
    } else if (on && !termSession?.isGrokAlive()) {
      warning = tr("main.pickWarningNoGrok");
    }
    await setPickMode(on);
    return {
      pickMode,
      warning,
      terminalAlive: Boolean(termSession?.isAlive()),
    };
  });

  ipcMain.handle("capture:screenshot", async (_event, options = {}) =>
    runScreenshotAndNotify(options),
  );

  ipcMain.handle("capture:recopy", async (_e, enrichment = {}) => {
    if (!lastSelection && !lastScreenshotPath) {
      throw new Error(tr("main.nothingResend"));
    }
    const locked = await withCaptureLock(async () =>
      deliverCapture(lastSelection, lastScreenshotPath, "recopy", {
        intent: enrichment?.intent ?? null,
        styleDiffs: enrichment?.styleDiffs ?? null,
        pasteToTerminal: enrichment?.pasteToTerminal !== false,
        writeClipboard: true,
      }),
    );
    if (locked && locked.busy) {
      sendToRenderer("capture:result", {
        kind: "error",
        message: locked.statusMessage,
      });
      throw new Error(locked.statusMessage);
    }
    sendToRenderer("capture:result", {
      kind: "recopy",
      selection: lastSelection,
      ...locked,
    });
    if (locked?.pastedToTerminal) {
      scheduleTerminalFocus({ reason: "recopy" });
    }
    return locked;
  });

  /** Re-send last capture into Grok (multimodal image + text). */
  ipcMain.handle("capture:deliver", async () => resendLastCaptureAndNotify());

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
    if (
      typeof requestedPath !== "string" ||
      requestedPath !== lastScreenshotPath ||
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
    lastSelection = null;
    lastScreenshotPath = null;
    lastCaptureMeta = null;
    sendToRenderer("preview:status", previewStatusSnapshot());
    return { ok: true };
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

  // —— Terminal ——
  ipcMain.handle("terminal:start", async (_e, opts = {}) => {
    const session = ensureTerminal();
    const cols = opts.cols || 80;
    const rows = opts.rows || 24;
    try {
      session.start({ cwd: projectCwd, cols, rows });
      sendToRenderer("terminal:status", {
        alive: true,
        shellAlive: true,
        terminalMode: "shell",
        grokRunning: false,
        grokLaunchRequested: false,
        grokReady: false,
        cwd: projectCwd,
      });
      return { ok: true, cwd: projectCwd };
    } catch (err) {
      const message = err instanceof Error ? err.message : String(err);
      sendToRenderer("terminal:status", { alive: false, error: message });
      throw err;
    }
  });

  ipcMain.handle("terminal:write", async (_e, data) => {
    if (!termSession?.isAlive()) return { ok: false };
    termSession.write(String(data ?? ""));
    return { ok: true };
  });

  ipcMain.handle("terminal:paste", async (_e, text) => {
    if (!termSession?.isAlive()) {
      throw new Error("Terminal not running");
    }
    termSession.paste(String(text ?? ""));
    return { ok: true };
  });

  ipcMain.handle("terminal:resize", async (_e, size) => {
    if (!termSession) return { ok: false };
    const cols = size?.cols || 80;
    const rows = size?.rows || 24;
    termSession.resize(cols, rows);
    return { ok: true };
  });

  ipcMain.handle("terminal:launch-grok", async () => {
    const session = ensureTerminal();
    if (session.isGrokAlive()) {
      return {
        ok: true,
        alreadyRunning: true,
        cwd: projectCwd,
        terminalMode: "grok",
        grokRunning: true,
        grokReady: null,
        grokReadiness: "unknown",
        grokState: "running",
      };
    }
    try {
      sendToRenderer(
        "terminal:data",
        `\r\n\x1b[90m[Starting Grok directly in ${projectCwd}]\x1b[0m\r\n`,
      );
      const result = session.launchGrok({
        cwd: projectCwd,
        cols: session.cols,
        rows: session.rows,
      });
      sendToRenderer("terminal:status", {
        alive: true,
        shellAlive: true,
        terminalMode: "grok",
        grokRunning: true,
        grokLaunchRequested: true,
        // Process liveness is known; whether the TUI prompt has accepted the
        // image cannot be observed without parsing Grok's private UI state.
        grokReady: null,
        grokReadiness: "unknown",
        grokState: "running",
        cwd: projectCwd,
      });
      return {
        ok: true,
        cwd: projectCwd,
        grokReady: null,
        grokReadiness: "unknown",
        grokState: "running",
        ...result,
      };
    } catch (err) {
      sendToRenderer("terminal:status", {
        alive: false,
        shellAlive: false,
        terminalMode: null,
        grokRunning: false,
        grokLaunchRequested: false,
        grokReady: false,
        error: err instanceof Error ? err.message : String(err),
      });
      throw err;
    }
  });

  ipcMain.handle("terminal:restart", async (_e, opts = {}) => {
    const session = ensureTerminal();
    session.start({
      cwd: projectCwd,
      cols: opts.cols || session.cols,
      rows: opts.rows || session.rows,
    });
    sendToRenderer("terminal:status", {
      alive: true,
      shellAlive: true,
      terminalMode: "shell",
      grokRunning: false,
      grokLaunchRequested: false,
      grokReady: false,
      cwd: projectCwd,
    });
    return { ok: true, cwd: projectCwd };
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

app.on("window-all-closed", () => {
  if (termSession) {
    termSession.dispose();
    termSession = null;
  }
  if (process.platform !== "darwin") app.quit();
});
