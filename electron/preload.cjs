const { contextBridge, ipcRenderer } = require("electron");

contextBridge.exposeInMainWorld("vefg", {
  getState: () => ipcRenderer.invoke("app:get-state"),

  navigate: (url) => ipcRenderer.invoke("preview:navigate", url),
  reload: () => ipcRenderer.invoke("preview:reload"),
  goBack: () => ipcRenderer.invoke("preview:go-back"),
  goForward: () => ipcRenderer.invoke("preview:go-forward"),
  setViewport: (opts) => ipcRenderer.invoke("preview:set-viewport", opts || {}),
  setPrivateMode: (enabled) =>
    ipcRenderer.invoke("preview:set-private-mode", Boolean(enabled)),
  clearPreviewData: (scope) =>
    ipcRenderer.invoke("preview:clear-data", scope || "all"),
  setPickMode: (enabled) => ipcRenderer.invoke("preview:set-pick-mode", enabled),

  screenshot: (options) =>
    ipcRenderer.invoke("capture:screenshot", options || {}),
  recopy: (enrichment) => ipcRenderer.invoke("capture:recopy", enrichment || {}),
  deliver: () => ipcRenderer.invoke("capture:deliver"),
  verify: () => ipcRenderer.invoke("capture:verify"),
  deliverVerification: () => ipcRenderer.invoke("capture:verify-deliver"),
  openCaptureFolder: () => ipcRenderer.invoke("capture:open-folder"),
  captureThumbnail: (capturePath) =>
    ipcRenderer.invoke("capture:thumbnail", capturePath),
  clearCapture: () => ipcRenderer.invoke("capture:clear"),
  setAutoPaste: (enabled) =>
    ipcRenderer.invoke("capture:set-auto-paste", enabled),
  setFrameMode: (mode) => ipcRenderer.invoke("capture:set-frame-mode", mode),
  setLocale: (locale) => ipcRenderer.invoke("app:set-locale", locale),
  setTermSettings: (partial) =>
    ipcRenderer.invoke("app:set-term-settings", partial || {}),
  copyDiagnostics: () => ipcRenderer.invoke("app:copy-diagnostics"),
  checkUpdates: () => ipcRenderer.invoke("app:check-updates"),
  openExternal: (url) => ipcRenderer.invoke("shell:open-external", url),

  pickProjectDir: () => ipcRenderer.invoke("project:pick-cwd"),
  setProjectDir: (cwd) => ipcRenderer.invoke("project:set-cwd", cwd),
  setSplit: (ratio, opts) =>
    ipcRenderer.invoke("layout:set-split", ratio, opts || {}),
  setPreviewCollapsed: (collapsed) =>
    ipcRenderer.invoke("layout:set-preview-collapsed", Boolean(collapsed)),

  terminalList: () => ipcRenderer.invoke("terminal:list"),
  terminalCreate: (opts) =>
    ipcRenderer.invoke("terminal:create", opts || {}),
  terminalClose: (sessionId) =>
    ipcRenderer.invoke("terminal:close", sessionId),
  terminalSetActive: (sessionId) =>
    ipcRenderer.invoke("terminal:set-active", sessionId),
  terminalRename: (sessionId, label) =>
    ipcRenderer.invoke("terminal:rename", { sessionId, label }),
  terminalReorder: (orderedIds) =>
    ipcRenderer.invoke("terminal:reorder", orderedIds || []),
  terminalStart: (opts) => ipcRenderer.invoke("terminal:start", opts || {}),
  terminalWrite: (dataOrOpts, sessionId) => {
    if (dataOrOpts && typeof dataOrOpts === "object" && "data" in dataOrOpts) {
      return ipcRenderer.invoke("terminal:write", dataOrOpts);
    }
    return ipcRenderer.invoke("terminal:write", {
      data: dataOrOpts,
      sessionId,
    });
  },
  terminalPaste: (textOrOpts, sessionId) => {
    if (textOrOpts && typeof textOrOpts === "object" && "text" in textOrOpts) {
      return ipcRenderer.invoke("terminal:paste", textOrOpts);
    }
    return ipcRenderer.invoke("terminal:paste", {
      text: textOrOpts,
      sessionId,
    });
  },
  terminalResize: (size) => ipcRenderer.invoke("terminal:resize", size || {}),
  terminalLaunchGrok: (opts) =>
    ipcRenderer.invoke("terminal:launch-grok", opts || {}),
  terminalRestart: (opts) =>
    ipcRenderer.invoke("terminal:restart", opts || {}),

  on: (channel, handler) => {
    const allowed = [
      "preview:status",
      "preview:pick-mode",
      "capture:result",
      "capture:busy",
      "layout:bounds",
      "terminal:data",
      "terminal:exit",
      "terminal:status",
      "terminal:sessions",
      "terminal:focus-request",
      "app:locale",
      "app:menu-action",
      "app:term-settings",
    ];
    if (!allowed.includes(channel)) return () => {};
    const listener = (_event, payload) => handler(payload);
    ipcRenderer.on(channel, listener);
    return () => ipcRenderer.removeListener(channel, listener);
  },
});
