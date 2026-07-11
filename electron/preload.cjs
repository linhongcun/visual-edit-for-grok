const { contextBridge, ipcRenderer } = require("electron");

contextBridge.exposeInMainWorld("vefg", {
  getState: () => ipcRenderer.invoke("app:get-state"),

  navigate: (url) => ipcRenderer.invoke("preview:navigate", url),
  reload: () => ipcRenderer.invoke("preview:reload"),
  goBack: () => ipcRenderer.invoke("preview:go-back"),
  goForward: () => ipcRenderer.invoke("preview:go-forward"),
  setPickMode: (enabled) => ipcRenderer.invoke("preview:set-pick-mode", enabled),

  screenshot: () => ipcRenderer.invoke("capture:screenshot"),
  recopy: (enrichment) => ipcRenderer.invoke("capture:recopy", enrichment || {}),
  deliver: (enrichment) =>
    ipcRenderer.invoke("capture:deliver", enrichment || {}),
  openCaptureFolder: () => ipcRenderer.invoke("capture:open-folder"),
  clearCapture: () => ipcRenderer.invoke("capture:clear"),
  setAutoPaste: (enabled) =>
    ipcRenderer.invoke("capture:set-auto-paste", enabled),

  pickProjectDir: () => ipcRenderer.invoke("project:pick-cwd"),
  setProjectDir: (cwd) => ipcRenderer.invoke("project:set-cwd", cwd),
  setSplit: (ratio, opts) =>
    ipcRenderer.invoke("layout:set-split", ratio, opts || {}),

  terminalStart: (opts) => ipcRenderer.invoke("terminal:start", opts),
  terminalWrite: (data) => ipcRenderer.invoke("terminal:write", data),
  terminalPaste: (text) => ipcRenderer.invoke("terminal:paste", text),
  terminalResize: (size) => ipcRenderer.invoke("terminal:resize", size),
  terminalLaunchGrok: () => ipcRenderer.invoke("terminal:launch-grok"),
  terminalRestart: (opts) => ipcRenderer.invoke("terminal:restart", opts),

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
      "terminal:focus-request",
    ];
    if (!allowed.includes(channel)) return () => {};
    const listener = (_event, payload) => handler(payload);
    ipcRenderer.on(channel, listener);
    return () => ipcRenderer.removeListener(channel, listener);
  },
});
