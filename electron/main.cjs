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
const { execFileSync } = require("child_process");
const { getPickerScript } = require("./picker-script.cjs");
const { buildClipboardPayload } = require("./clipboard-payload.cjs");
const { TerminalSession } = require("./terminal.cjs");
const {
  loadSettings,
  saveSettings,
  defaultSettingsPath,
} = require("./settings-store.cjs");
const { cleanupCaptureDir } = require("./capture-cleanup.cjs");
const { buildPasteStatus } = require("./delivery-status.cjs");
const {
  canStartCapture,
  shouldRunCleanup,
  shouldFlushSettings,
  focusHandoffDelays,
  planAimPickEvent,
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
  return s;
}

const isDev = process.env.VEFG_DEV === "1";
// Keep in sync with src/styles.css --toolbar-height
const TOOLBAR_HEIGHT = 96;
const SPLITTER_WIDTH = 5;
const MIN_TERMINAL_WIDTH = 320;
const MIN_PREVIEW_WIDTH = 360;

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
let previewUrl = "http://127.0.0.1:8765";
/** @type {object | null} */
let lastSelection = null;
/** @type {string | null} */
let lastScreenshotPath = null;
/** Left pane ratio 0–1 */
let splitRatio = 0.46;
let projectCwd = defaultProjectCwd();
/** Auto-paste capture into terminal */
let autoPasteTerminal = true;

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
      statusMessage: gate.statusMessage || "Capture in progress — wait a moment.",
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
      sandbox: false,
    },
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
    previewView.webContents.reload();
    sendToRenderer("preview:status", { loading: true, error: null });
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
      reloadPreviewPage();
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
              previewView.webContents.reloadIgnoringCache();
              sendToRenderer("preview:status", { loading: true, error: null });
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

function createPreviewView() {
  if (!mainWindow) return;

  previewView = new BrowserView({
    webPreferences: {
      contextIsolation: true,
      nodeIntegration: false,
      sandbox: false,
      webSecurity: true,
    },
  });

  mainWindow.setBrowserView(previewView);
  // Preview: Cmd+R reloads site; Esc cancels Aim when focused in page
  bindAppShortcuts(previewView.webContents);

  previewView.webContents.setWindowOpenHandler(({ url }) => {
    shell.openExternal(url);
    return { action: "deny" };
  });

  previewView.webContents.on("did-finish-load", async () => {
    await injectPicker();
    sendToRenderer("preview:status", {
      url: previewView?.webContents.getURL() ?? previewUrl,
      title: previewView?.webContents.getTitle() ?? "",
      loading: false,
      error: null,
    });
  });

  previewView.webContents.on("did-start-loading", () => {
    sendToRenderer("preview:status", { loading: true });
  });

  previewView.webContents.on(
    "did-fail-load",
    (_e, code, desc, url, isMainFrame) => {
      if (!isMainFrame) return;
      sendToRenderer("preview:status", {
        loading: false,
        error: `${desc} (${code})`,
        url,
      });
    },
  );

  previewView.webContents.on("console-message", (_e, _level, message) => {
    if (typeof message !== "string") return;

    if (message.startsWith("__VEFG_SELECT__")) {
      void (async () => {
        // Pure policy: busy reject still cancels Aim + clears sticky overlay
        const plan = planAimPickEvent({ inFlight: captureInFlight });
        if (!plan.proceed) {
          if (plan.cancelPickMode) await setPickMode(false);
          if (plan.clearOverlay) await clearPickerOverlay();
          sendToRenderer("capture:result", {
            kind: "error",
            message:
              plan.statusMessage || "Capture in progress — wait a moment.",
          });
          return;
        }

        // Snapshot previous pair; only commit after full success
        const prevSelection = lastSelection;
        const prevScreenshotPath = lastScreenshotPath;
        setCaptureBusy(true);
        try {
          const payload = JSON.parse(message.slice("__VEFG_SELECT__".length));
          if (plan.cancelPickMode) await setPickMode(false);

          // Always capture a screenshot on pick so Grok gets visual context
          const shot = await takeScreenshotFile({
            bounds: payload.boundingBox,
            reason: "pick",
          });
          // Pick → screenshot + multimodal paste (image chip) + text into Grok
          const result = await deliverCapture(payload, shot.path, "selection", {
            pasteToTerminal: true,
            writeClipboard: true,
          });

          const commit = resolvePickCommit({
            ok: true,
            selection: payload,
            screenshotPath: shot.path,
            prevSelection,
            prevScreenshotPath,
          });
          lastSelection = commit.lastSelection;
          lastScreenshotPath = commit.lastScreenshotPath;
          if (commit.clearOverlay) await clearPickerOverlay();
          if (commit.cancelPickMode) await setPickMode(false);

          sendToRenderer("capture:result", {
            kind: "selection",
            selection: commit.lastSelection,
            ...result,
            screenshotPath: commit.lastScreenshotPath,
          });
          if (result.pastedToTerminal) {
            scheduleTerminalFocus({ reason: "pick" });
          }
        } catch (err) {
          const commit = resolvePickCommit({
            ok: false,
            selection: null,
            screenshotPath: null,
            prevSelection,
            prevScreenshotPath,
          });
          lastSelection = commit.lastSelection;
          lastScreenshotPath = commit.lastScreenshotPath;
          if (commit.cancelPickMode) await setPickMode(false);
          if (commit.clearOverlay) await clearPickerOverlay();
          sendToRenderer("capture:result", {
            kind: "error",
            message: err instanceof Error ? err.message : String(err),
          });
        } finally {
          setCaptureBusy(false);
        }
      })();
      return;
    }

    if (message === "__VEFG_CANCEL_PICK__") {
      setPickMode(false);
    }
  });

  loadPreview(previewUrl);
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

async function injectPicker() {
  if (!previewView) return;
  try {
    await previewView.webContents.executeJavaScript(getPickerScript(), true);
    if (pickMode) {
      await previewView.webContents.executeJavaScript(
        "window.__vefgSetPickMode && window.__vefgSetPickMode(true)",
        true,
      );
    }
  } catch (err) {
    console.warn("Picker inject failed:", err);
  }
}

async function setPickMode(enabled) {
  pickMode = Boolean(enabled);
  sendToRenderer("preview:pick-mode", { enabled: pickMode });
  if (!previewView) return;
  try {
    await previewView.webContents.executeJavaScript(
      `window.__vefgSetPickMode && window.__vefgSetPickMode(${pickMode ? "true" : "false"})`,
      true,
    );
  } catch {
    /* page may not be ready */
  }
}

function loadPreview(url) {
  previewUrl = url;
  persist({ previewUrl: url });
  if (!previewView) return;
  try {
    const parsed = new URL(url);
    if (!["http:", "https:"].includes(parsed.protocol)) {
      throw new Error("Only http(s) URLs are supported");
    }
    previewView.webContents.loadURL(url);
    sendToRenderer("preview:status", { url, loading: true, error: null });
  } catch (err) {
    sendToRenderer("preview:status", {
      url,
      loading: false,
      error: err instanceof Error ? err.message : String(err),
    });
  }
}

async function clearPickerOverlay() {
  if (!previewView || previewView.webContents.isDestroyed()) return;
  try {
    await previewView.webContents.executeJavaScript(
      `window.__vefgClearSelection && window.__vefgClearSelection()`,
      true,
    );
  } catch {
    /* page may not have picker */
  }
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

  if (!terminalAlive) {
    writeClipboardBundle();
    const status = buildPasteStatus({
      terminalAlive: false,
      textPasted: false,
      imagePrepared: hasShot,
      imageChipAttempted: false,
    });
    return { ...status, textPasted: false, terminalAlive: false };
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
        termSession.write("\x16");
        imageChipAttempted = true;
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

  writeClipboardBundle();

  const status = buildPasteStatus({
    terminalAlive: true,
    textPasted,
    imagePrepared,
    imageChipAttempted,
  });
  return { ...status, textPasted, terminalAlive: true };
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

  if (wantPaste) {
    const result = await pasteToGrokMultimodal(text, screenshotPath);
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
    statusMessage = "Copied to clipboard.";
  }

  // Housekeeping off critical path (throttled)
  scheduleCaptureCleanup();

  return {
    copied: writeClipboard || pastedToTerminal || Boolean(fallback),
    pastedToTerminal,
    hasImage,
    imagePrepared,
    imageChip,
    multimodal: imageChip,
    fallback,
    statusMessage,
    terminalAlive,
    textPreview: text.slice(0, 280),
    text,
    screenshotPath: screenshotPath || null,
    kind,
  };
}

/**
 * Capture preview to disk. Optionally crop around selected element (with padding)
 * while keeping a full-page shot as fallback if crop fails.
 *
 * @param {{
 *   bounds?: { x?: number, y?: number, top?: number, left?: number, width?: number, height?: number } | null,
 *   reason?: string,
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
      const pad = 32;
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

async function captureScreenshot() {
  const prevSelection = lastSelection;
  const prevScreenshotPath = lastScreenshotPath;
  const locked = await withCaptureLock(async () => {
    const shot = await takeScreenshotFile({
      bounds: lastSelection?.boundingBox,
      reason: "manual",
    });
    const result = await deliverCapture(lastSelection, shot.path, "screenshot", {
      pasteToTerminal: true,
      writeClipboard: true,
    });
    // Frame: commit only after deliver completed without throw
    const commit = resolvePickCommit({
      ok: true,
      selection: lastSelection,
      screenshotPath: shot.path,
      prevSelection,
      prevScreenshotPath,
    });
    lastSelection = commit.lastSelection;
    lastScreenshotPath = commit.lastScreenshotPath;
    return {
      path: shot.path,
      fullPath: shot.fullPath,
      cropped: shot.cropped,
      screenshotPath: lastScreenshotPath,
      ...result,
    };
  });
  if (locked && locked.busy) {
    throw new Error(locked.statusMessage || "Capture in progress");
  }
  // On throw inside lock, prev pair is untouched (takeScreenshotFile no longer mutates)
  if (locked?.pastedToTerminal) {
    scheduleTerminalFocus({ reason: "frame" });
  }
  return locked;
}

function ensureTerminal() {
  if (termSession) return termSession;
  termSession = new TerminalSession({
    cwd: projectCwd,
    onData: (data) => sendToRenderer("terminal:data", data),
    onExit: (code) => {
      sendToRenderer("terminal:exit", { code });
    },
  });
  return termSession;
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
  ipcMain.handle("app:get-state", () => ({
    previewUrl,
    pickMode,
    lastSelection,
    lastScreenshotPath,
    captureDir: CAPTURE_DIR,
    projectCwd,
    splitRatio,
    autoPasteTerminal,
    captureBusy: captureInFlight,
    terminalAlive: Boolean(termSession?.isAlive()),
    layout: getLayoutBounds(),
  }));

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
      projectCwd = result.filePaths[0];
      termSession?.setCwd(projectCwd);
      persist({ projectCwd });
    }
    return { projectCwd };
  });

  ipcMain.handle("project:set-cwd", async (_e, cwd) => {
    if (typeof cwd !== "string" || !fs.existsSync(cwd)) {
      throw new Error("Invalid directory");
    }
    projectCwd = cwd;
    termSession?.setCwd(projectCwd);
    persist({ projectCwd });
    return { projectCwd };
  });

  ipcMain.handle("preview:navigate", async (_e, url) => {
    loadPreview(url);
    return { ok: true };
  });

  ipcMain.handle("preview:reload", async () => {
    previewView?.webContents.reload();
    return { ok: true };
  });

  ipcMain.handle("preview:go-back", async () => {
    if (previewView?.webContents.canGoBack()) previewView.webContents.goBack();
    return { ok: true };
  });

  ipcMain.handle("preview:go-forward", async () => {
    if (previewView?.webContents.canGoForward()) {
      previewView.webContents.goForward();
    }
    return { ok: true };
  });

  ipcMain.handle("preview:set-pick-mode", async (_e, enabled) => {
    const on = Boolean(enabled);
    let warning = null;
    if (on && !termSession?.isAlive()) {
      warning =
        "Terminal not running. You can still Aim (clipboard), but Start Grok first for auto-send.";
    }
    await setPickMode(on);
    return {
      pickMode,
      warning,
      terminalAlive: Boolean(termSession?.isAlive()),
    };
  });

  ipcMain.handle("capture:screenshot", async () => {
    try {
      const result = await captureScreenshot();
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
  });

  ipcMain.handle("capture:recopy", async (_e, enrichment = {}) => {
    if (!lastSelection && !lastScreenshotPath) {
      throw new Error("Nothing to re-send — Aim or Frame first");
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
  ipcMain.handle("capture:deliver", async (_e, enrichment = {}) => {
    if (!lastSelection && !lastScreenshotPath) {
      throw new Error("Nothing to re-send — Aim or Frame first");
    }
    const locked = await withCaptureLock(async () =>
      deliverCapture(lastSelection, lastScreenshotPath, "deliver", {
        intent: enrichment?.intent ?? null,
        styleDiffs: enrichment?.styleDiffs ?? null,
        pasteToTerminal: true,
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
      kind: "deliver",
      selection: lastSelection,
      ...locked,
    });
    if (locked?.pastedToTerminal) {
      scheduleTerminalFocus({ reason: "deliver" });
    }
    return locked;
  });

  ipcMain.handle("capture:open-folder", async () => {
    ensureCaptureDir();
    shell.openPath(CAPTURE_DIR);
    return { ok: true, path: CAPTURE_DIR };
  });

  ipcMain.handle("capture:clear", async () => {
    lastSelection = null;
    lastScreenshotPath = null;
    return { ok: true };
  });

  ipcMain.handle("capture:set-auto-paste", async (_e, enabled) => {
    autoPasteTerminal = Boolean(enabled);
    return { autoPasteTerminal };
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
    if (!termSession?.isAlive()) {
      const session = ensureTerminal();
      session.start({ cwd: projectCwd, cols: 80, rows: 24 });
    }
    // Small delay so shell is ready
    await new Promise((r) => setTimeout(r, 120));
    termSession.launchGrok();
    return { ok: true };
  });

  ipcMain.handle("terminal:restart", async (_e, opts = {}) => {
    const session = ensureTerminal();
    session.start({
      cwd: projectCwd,
      cols: opts.cols || session.cols,
      rows: opts.rows || session.rows,
    });
    sendToRenderer("terminal:status", { alive: true, cwd: projectCwd });
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
