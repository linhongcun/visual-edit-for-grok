import {
  useCallback,
  useEffect,
  useRef,
  useState,
  type FormEvent,
  type MouseEvent as ReactMouseEvent,
} from "react";
import TerminalPane from "./components/TerminalPane";
import {
  IconCamera,
  IconChevronLeft,
  IconChevronRight,
  IconCrosshair,
  IconFolder,
  IconMark,
  IconPlay,
  IconRefresh,
  IconSend,
} from "./components/Icons";
import type {
  CaptureResult,
  ElementSelection,
  PreviewStatus,
} from "./types";

function isElectron(): boolean {
  return typeof window !== "undefined" && Boolean(window.vefg);
}

function shortPath(p: string, max = 42) {
  if (p.length <= max) return p;
  return "…" + p.slice(-(max - 1));
}

export default function App() {
  const [urlInput, setUrlInput] = useState("http://127.0.0.1:8765");
  const [preview, setPreview] = useState<PreviewStatus>({
    url: "http://127.0.0.1:8765",
    loading: false,
  });
  const [pickMode, setPickMode] = useState(false);
  const [selection, setSelection] = useState<ElementSelection | null>(null);
  const [screenshotPath, setScreenshotPath] = useState<string | null>(null);
  const [toast, setToast] = useState<string | null>(null);
  /** Unified busy: Frame / Re-send / Aim-pick in flight (main single-flight) */
  const [captureBusy, setCaptureBusy] = useState(false);
  const [projectCwd, setProjectCwd] = useState("");
  const [terminalWidth, setTerminalWidth] = useState(640);
  const [terminalAlive, setTerminalAlive] = useState(false);
  const [termFocusNonce, setTermFocusNonce] = useState(0);
  const dragging = useRef(false);

  function focusGrokTerminal() {
    setTermFocusNonce((n) => n + 1);
  }

  function showToast(msg: string) {
    setToast(msg);
    window.setTimeout(() => setToast((cur) => (cur === msg ? null : cur)), 5200);
  }

  useEffect(() => {
    if (!isElectron()) return;
    const api = window.vefg;

    void api.getState().then((s) => {
      setUrlInput(s.previewUrl);
      setPickMode(s.pickMode);
      setSelection(s.lastSelection);
      setScreenshotPath(s.lastScreenshotPath);
      setProjectCwd(s.projectCwd || "");
      setTerminalAlive(Boolean(s.terminalAlive));
      setCaptureBusy(Boolean((s as { captureBusy?: boolean }).captureBusy));
      if (s.layout?.terminalWidth) setTerminalWidth(s.layout.terminalWidth);
    });

    const offs = [
      api.on("preview:status", (p) => {
        setPreview((prev) => ({ ...prev, ...(p as PreviewStatus) }));
      }),
      api.on("preview:pick-mode", (p) => {
        setPickMode(Boolean((p as { enabled: boolean }).enabled));
      }),
      api.on("layout:bounds", (p) => {
        const b = p as { terminalWidth: number };
        if (!dragging.current && b.terminalWidth) {
          setTerminalWidth(b.terminalWidth);
        }
      }),
      api.on("terminal:exit", () => setTerminalAlive(false)),
      api.on("terminal:status", (p) => {
        const st = p as { alive?: boolean };
        if (typeof st.alive === "boolean") setTerminalAlive(st.alive);
      }),
      api.on("capture:busy", (p) => {
        const st = p as { busy?: boolean };
        setCaptureBusy(Boolean(st.busy));
      }),
      api.on("capture:result", (p) => {
        const r = p as CaptureResult & {
          statusMessage?: string;
          fallback?: string | null;
          imageChip?: boolean;
          terminalAlive?: boolean;
        };
        // Main process owns post-deliver focus handoff — do not storm timers here
        if (r.kind === "error") {
          showToast(r.message || "Couldn't capture");
          return;
        }
        if (r.selection) setSelection(r.selection);
        if (r.screenshotPath || r.path) {
          setScreenshotPath(r.screenshotPath || r.path || null);
        }
        if (typeof r.terminalAlive === "boolean") {
          setTerminalAlive(r.terminalAlive);
        }

        if (r.statusMessage) {
          showToast(r.statusMessage);
        } else if (r.kind === "selection" || r.kind === "screenshot") {
          showToast(
            r.pastedToTerminal
              ? "Sent to Grok — type your change in the prompt, then Enter"
              : "Captured — Start Grok, then Re-send (or ⌘V)",
          );
        } else if (r.kind === "recopy" || r.kind === "deliver") {
          showToast(
            r.pastedToTerminal
              ? "Re-sent last capture to Grok"
              : "Copied last capture to clipboard",
          );
        }
      }),
    ];

    // Global Esc in renderer (shell focused) also cancels Aim via IPC
    const onKey = (e: KeyboardEvent) => {
      if (e.key === "Escape" && pickMode) {
        e.preventDefault();
        void api.setPickMode(false);
      }
      // ⌘⇧A Aim · ⌘⇧F Frame · ⌘⇧V Re-send
      if ((e.metaKey || e.ctrlKey) && e.shiftKey) {
        const k = e.key.toLowerCase();
        if (k === "a") {
          e.preventDefault();
          void togglePickRef.current();
        } else if (k === "f") {
          e.preventDefault();
          void onScreenshotRef.current();
        } else if (k === "v") {
          e.preventDefault();
          void onResendRef.current();
        }
      }
    };
    window.addEventListener("keydown", onKey);

    return () => {
      offs.forEach((off) => off());
      window.removeEventListener("keydown", onKey);
    };
  }, [pickMode]);

  const togglePickRef = useRef(async () => {});
  const onScreenshotRef = useRef(async () => {});
  const onResendRef = useRef(async () => {});

  async function onNavigate(e?: FormEvent) {
    e?.preventDefault();
    if (!isElectron()) return;
    let url = urlInput.trim();
    if (!url) return;
    if (!/^https?:\/\//i.test(url)) url = `http://${url}`;
    setUrlInput(url);
    await window.vefg.navigate(url);
  }

  async function togglePick() {
    if (!isElectron() || captureBusy) return;
    const next = !pickMode;
    const res = await window.vefg.setPickMode(next);
    setPickMode(res.pickMode);
    if (res.warning) showToast(res.warning);
    if (typeof res.terminalAlive === "boolean") {
      setTerminalAlive(res.terminalAlive);
    }
  }
  togglePickRef.current = togglePick;

  async function onScreenshot() {
    if (!isElectron() || captureBusy) return;
    if (!terminalAlive) {
      showToast("Start Grok first for auto-send (or capture will copy only).");
    }
    setCaptureBusy(true);
    try {
      await window.vefg.screenshot();
    } catch (err) {
      showToast(err instanceof Error ? err.message : String(err));
    } finally {
      // Main also emits capture:busy; clear local in case event was missed
      setCaptureBusy(false);
    }
  }
  onScreenshotRef.current = onScreenshot;

  async function onResend() {
    if (!isElectron() || captureBusy) return;
    if (!selection && !screenshotPath) {
      showToast("Nothing to re-send — Aim at an element or grab a Frame first.");
      return;
    }
    setCaptureBusy(true);
    try {
      await window.vefg.deliver({});
    } catch (err) {
      showToast(err instanceof Error ? err.message : String(err));
    } finally {
      setCaptureBusy(false);
    }
  }
  onResendRef.current = onResend;

  async function onClear() {
    if (!isElectron()) return;
    await window.vefg.clearCapture();
    setSelection(null);
    setScreenshotPath(null);
    showToast("Cleared last capture");
  }

  async function onPickCwd() {
    if (!isElectron()) return;
    const { projectCwd: cwd } = await window.vefg.pickProjectDir();
    setProjectCwd(cwd);
    showToast(`Working folder: ${cwd}`);
  }

  async function onLaunchGrok() {
    if (!isElectron()) return;
    try {
      await window.vefg.terminalLaunchGrok();
      setTerminalAlive(true);
      showToast("Grok started — Aim when the prompt is ready");
      focusGrokTerminal();
    } catch (err) {
      showToast(err instanceof Error ? err.message : String(err));
    }
  }

  async function onRestartTerminal() {
    if (!isElectron()) return;
    try {
      await window.vefg.terminalRestart({});
      setTerminalAlive(true);
      showToast("Terminal restarted");
    } catch (err) {
      showToast(err instanceof Error ? err.message : String(err));
    }
  }

  const onSplitterDown = useCallback(
    (e: ReactMouseEvent) => {
      e.preventDefault();
      dragging.current = true;
      const startX = e.clientX;
      const startW = terminalWidth;
      let latest = startW;

      const onMove = (ev: MouseEvent) => {
        latest = Math.max(
          320,
          Math.min(window.innerWidth - 380, startW + (ev.clientX - startX)),
        );
        setTerminalWidth(latest);
        if (isElectron()) {
          // Live layout only; main debounces disk persist
          void window.vefg.setSplit(latest / window.innerWidth);
        }
      };
      const onUp = () => {
        dragging.current = false;
        window.removeEventListener("mousemove", onMove);
        window.removeEventListener("mouseup", onUp);
        if (isElectron()) {
          // Final flush to disk
          void window.vefg.setSplit(latest / window.innerWidth, {
            force: true,
          });
        }
      };
      window.addEventListener("mousemove", onMove);
      window.addEventListener("mouseup", onUp);
    },
    [terminalWidth],
  );

  const selectionLabel = selection
    ? `<${selection.tag}>${selection.id ? `#${selection.id}` : ""}${
        selection.classes?.[0] ? `.${selection.classes[0]}` : ""
      }`
    : null;

  const hasCapture = Boolean(selection || screenshotPath);

  return (
    <div className="shell">
      <header className="toolbar">
        <div className="toolbar-row">
          <div className="brand" title="Visual Capture for Grok">
            <div className="brand-mark" aria-hidden>
              <IconMark />
            </div>
            <div className="brand-text">
              <span className="brand-name">Capture</span>
              <span className="brand-sub">for Grok</span>
            </div>
          </div>

          <form className="url-form" onSubmit={onNavigate}>
            <button
              type="button"
              className="icon-btn"
              title="Back"
              aria-label="Go back in preview"
              onClick={() => void window.vefg?.goBack()}
            >
              <IconChevronLeft />
            </button>
            <button
              type="button"
              className="icon-btn"
              title="Forward"
              aria-label="Go forward in preview"
              onClick={() => void window.vefg?.goForward()}
            >
              <IconChevronRight />
            </button>
            <button
              type="button"
              className="icon-btn"
              title="Reload preview (⌘R)"
              aria-label="Reload preview page"
              onClick={() => void window.vefg?.reload()}
            >
              <IconRefresh />
            </button>
            <input
              className="url-input"
              value={urlInput}
              onChange={(e) => setUrlInput(e.target.value)}
              placeholder="http://127.0.0.1:5173"
              spellCheck={false}
              aria-label="Preview URL"
            />
            <button type="submit" className="url-go" aria-label="Open URL">
              Go
            </button>
          </form>

          {/* Empty titlebar region: drag the window */}
          <div className="titlebar-drag-spacer" aria-hidden />

          <div className="toolbar-actions" role="toolbar" aria-label="Capture actions">
            <button
              type="button"
              className="btn btn-ghost"
              onClick={() => void onPickCwd()}
              title={projectCwd || "Project folder (terminal cwd)"}
              aria-label="Choose project folder"
            >
              <IconFolder />
              Folder
            </button>
            <button
              type="button"
              className="btn btn-primary"
              onClick={() => void onLaunchGrok()}
              title="Run grok in the left terminal"
              aria-label="Start Grok in terminal"
            >
              <IconPlay />
              Start Grok
            </button>
            <button
              type="button"
              className={`btn btn-pick ${pickMode ? "active" : ""}`}
              onClick={() => void togglePick()}
              disabled={captureBusy}
              title={
                captureBusy
                  ? "Capture in progress — wait a moment"
                  : "Aim (⌘⇧A) — click an element; context goes into Grok"
              }
              aria-label={pickMode ? "Cancel aim mode" : "Aim at page element"}
              aria-pressed={pickMode}
              aria-busy={captureBusy}
            >
              <IconCrosshair />
              {pickMode ? "Aiming… Esc" : "Aim"}
            </button>
            <button
              type="button"
              className="btn"
              disabled={captureBusy}
              onClick={() => void onScreenshot()}
              title={
                captureBusy
                  ? "Capture in progress — wait a moment"
                  : "Frame (⌘⇧F) — grab preview into Grok"
              }
              aria-label="Capture preview frame"
              aria-busy={captureBusy}
            >
              <IconCamera />
              {captureBusy ? "…" : "Frame"}
            </button>
            <button
              type="button"
              className="btn"
              disabled={!hasCapture || captureBusy}
              onClick={() => void onResend()}
              title={
                captureBusy
                  ? "Capture in progress — wait a moment"
                  : hasCapture
                    ? "Re-send last capture into Grok (⌘⇧V)"
                    : "Nothing captured yet — Aim or Frame first"
              }
              aria-label="Re-send last capture to Grok"
              aria-busy={captureBusy}
            >
              <IconSend />
              Re-send
            </button>
          </div>
        </div>

        <div
          className="status-strip"
          role="status"
          aria-live="polite"
          aria-atomic="true"
        >
          {preview.error ? (
            <div className="banner-inline">
              Preview failed: {preview.error}
              <span className="hint"> · is the page running? Try Go / ⌘R</span>
            </div>
          ) : captureBusy ? (
            <div className="banner-inline pick">
              Busy — capture in flight · Aim / Frame / Re-send paused
            </div>
          ) : pickMode ? (
            <div className="banner-inline pick">
              Aiming — click a node on the right · Esc cancels · image + DOM → Grok
            </div>
          ) : toast ? (
            <div className="toast-inline">{toast}</div>
          ) : (
            <>
              <span className={`chip-tag ${selectionLabel ? "" : "muted"}`}>
                {selectionLabel || "no target"}
              </span>
              {screenshotPath ? (
                <span className="chip-shot" title={screenshotPath}>
                  frame
                </span>
              ) : null}
              <span
                className={`term-pill ${terminalAlive ? "on" : "off"}`}
                title={
                  terminalAlive
                    ? "Terminal session alive"
                    : "Start Grok for auto-send"
                }
              >
                {terminalAlive ? "terminal on" : "terminal off"}
              </span>
              <span
                className="chip-selector muted-hint"
                title={projectCwd || undefined}
              >
                {projectCwd
                  ? shortPath(projectCwd)
                  : "Aim → Grok gets image + DOM → type change in Grok"}
              </span>
              <div className="chip-actions">
                <button
                  type="button"
                  className="link-btn"
                  onClick={() => void onRestartTerminal()}
                  aria-label="Reset terminal session"
                >
                  Reset term
                </button>
                {hasCapture && (
                  <>
                    <button
                      type="button"
                      className="link-btn"
                      onClick={() => void window.vefg?.openCaptureFolder()}
                      aria-label="Open frames folder"
                    >
                      Frames
                    </button>
                    <button
                      type="button"
                      className="link-btn danger"
                      onClick={() => void onClear()}
                      aria-label="Clear last capture"
                    >
                      Clear
                    </button>
                  </>
                )}
              </div>
            </>
          )}
        </div>
      </header>

      <div className="workspace">
        <section
          className="terminal-pane"
          style={{ width: terminalWidth }}
          aria-label="Grok terminal"
        >
          <div className="pane-label">
            <span>Grok · Terminal</span>
            <span className="pane-hint">type change here · ⌘R reloads preview only</span>
          </div>
          <div className="terminal-body terminal-body-full">
            <TerminalPane active focusNonce={termFocusNonce} />
          </div>
        </section>

        <div
          className="splitter"
          onMouseDown={onSplitterDown}
          title="Drag to resize panes"
          role="separator"
          aria-orientation="vertical"
          aria-label="Resize terminal and preview"
        />

        <section className="preview-pane" aria-label="Website preview">
          <div className="preview-area" aria-hidden />
        </section>
      </div>
    </div>
  );
}
