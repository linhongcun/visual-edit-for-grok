import {
  useCallback,
  useEffect,
  useRef,
  useState,
  type FormEvent,
  type KeyboardEvent as ReactKeyboardEvent,
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
  FrameMode,
  GrokRuntimeState,
  PreviewStatus,
  TerminalStatus,
} from "./types";

const DEFAULT_PREVIEW_URL = "";
const MIN_TERMINAL_WIDTH = 320;
const MIN_PREVIEW_WIDTH = 360;
const SPLITTER_WIDTH = 5;

interface CaptureReceipt {
  target: string;
  pageUrl: string;
  pageTitle: string;
  capturedAt: number;
  screenshotPath: string | null;
  mode: FrameMode;
  delivery: string;
}

function isElectron(): boolean {
  return typeof window !== "undefined" && Boolean(window.vefg);
}

function shortPath(p: string, max = 42) {
  if (p.length <= max) return p;
  return "…" + p.slice(-(max - 1));
}

function selectionLabelFor(selection: ElementSelection | null): string | null {
  if (!selection) return null;
  return `<${selection.tag}>${selection.id ? `#${selection.id}` : ""}${
    selection.classes?.[0] ? `.${selection.classes[0]}` : ""
  }`;
}

function deliverySummary(result: CaptureResult): string {
  if (
    result.imageChipAttempted ||
    (result.pastedToTerminal && result.imageChip)
  ) {
    return "Image + DOM paste attempted; confirm the image chip in Grok.";
  }
  if (result.deliveryAttempted || result.pastedToTerminal) {
    return "DOM/context paste attempted; confirm it in the Grok prompt.";
  }
  if (result.copied) {
    return "Copied to clipboard; it was not confirmed in Grok.";
  }
  return "Capture saved locally; delivery was not confirmed.";
}

function formatReceiptTime(timestamp: number): string {
  if (!Number.isFinite(timestamp)) return "Unknown";
  return new Intl.DateTimeFormat(undefined, {
    hour: "2-digit",
    minute: "2-digit",
    second: "2-digit",
  }).format(new Date(timestamp));
}

function isDefaultPreview(url?: string): boolean {
  if (!url) return true;
  try {
    const parsed = new URL(url);
    return (
      (parsed.hostname === "127.0.0.1" || parsed.hostname === "localhost") &&
      parsed.port === "8765"
    );
  } catch {
    return false;
  }
}

export default function App() {
  const [urlInput, setUrlInput] = useState(DEFAULT_PREVIEW_URL);
  const [preview, setPreview] = useState<PreviewStatus>({
    url: DEFAULT_PREVIEW_URL,
    loading: false,
  });
  const [pickMode, setPickMode] = useState(false);
  const [selection, setSelection] = useState<ElementSelection | null>(null);
  const [screenshotPath, setScreenshotPath] = useState<string | null>(null);
  const [toast, setToast] = useState<string | null>(null);
  /** Unified busy: Frame / Re-send / Aim-pick in flight (main single-flight) */
  const [captureBusy, setCaptureBusy] = useState(false);
  const [projectCwd, setProjectCwd] = useState("");
  const [recentPreviewUrls, setRecentPreviewUrls] = useState<string[]>([]);
  const [recentProjectCwds, setRecentProjectCwds] = useState<string[]>([]);
  const [terminalWidth, setTerminalWidth] = useState(640);
  const [terminalAlive, setTerminalAlive] = useState(false);
  const [grokState, setGrokState] = useState<GrokRuntimeState>("idle");
  const [frameMode, setFrameMode] = useState<FrameMode>("viewport");
  const [receipt, setReceipt] = useState<CaptureReceipt | null>(null);
  const [receiptThumbnail, setReceiptThumbnail] = useState<string | null>(null);
  const [termFocusNonce, setTermFocusNonce] = useState(0);
  const dragging = useRef(false);
  const selectionRef = useRef<ElementSelection | null>(null);
  const screenshotPathRef = useRef<string | null>(null);
  const previewRef = useRef(preview);
  const frameModeRef = useRef(frameMode);
  const pickModeRef = useRef(pickMode);
  const lastLaunchAtRef = useRef(0);
  const togglePickRef = useRef(async () => {});
  const onScreenshotRef = useRef(async () => {});
  const onResendRef = useRef(async () => {});

  useEffect(() => {
    selectionRef.current = selection;
  }, [selection]);

  useEffect(() => {
    screenshotPathRef.current = screenshotPath;
  }, [screenshotPath]);

  useEffect(() => {
    previewRef.current = preview;
  }, [preview]);

  useEffect(() => {
    frameModeRef.current = frameMode;
    if (isElectron()) {
      void window.vefg.setFrameMode(frameMode).catch(() => {
        // Native window may be closing; local selection remains usable.
      });
    }
  }, [frameMode]);

  useEffect(() => {
    if (preview.selectionStale && frameMode === "target-context") {
      setFrameMode("viewport");
    }
  }, [frameMode, preview.selectionStale]);

  useEffect(() => {
    pickModeRef.current = pickMode;
  }, [pickMode]);

  useEffect(() => {
    const capturePath = receipt?.screenshotPath;
    if (!capturePath || !isElectron()) {
      setReceiptThumbnail(null);
      return;
    }
    let canceled = false;
    void window.vefg
      .captureThumbnail(capturePath)
      .then(({ dataUrl }) => {
        if (!canceled) setReceiptThumbnail(dataUrl);
      })
      .catch(() => {
        if (!canceled) setReceiptThumbnail(null);
      });
    return () => {
      canceled = true;
    };
  }, [receipt?.screenshotPath]);

  function focusGrokTerminal() {
    setTermFocusNonce((n) => n + 1);
  }

  function showToast(msg: string) {
    setToast(msg);
    window.setTimeout(() => setToast((cur) => (cur === msg ? null : cur)), 5200);
  }

  function applyTerminalRuntime(status: TerminalStatus) {
    const shellAlive =
      status.shellAlive ?? status.terminalAlive ?? status.alive;
    if (typeof shellAlive === "boolean") setTerminalAlive(shellAlive);

    setGrokState((current) => {
      const raw = String(status.grokState || "").toLowerCase();
      if (
        status.grokReady === true ||
        status.grokReadiness === "ready" ||
        raw === "ready"
      ) {
        return "ready";
      }
      if (raw === "launching") return "launching";
      if (
        status.grokLaunchRequested === true ||
        raw === "launch-requested" ||
        raw === "requested" ||
        raw === "running"
      ) {
        return "launch-requested";
      }
      if (raw === "exited" || raw === "stopped") return "exited";
      if (raw === "idle" || raw === "not-started") return "idle";
      if (shellAlive === false) {
        return current === "idle" ? "idle" : "exited";
      }
      return current;
    });
  }

  function makeReceipt(
    result: CaptureResult,
    selected: ElementSelection | null,
    path: string | null,
  ): CaptureReceipt {
    const meta = result.captureMeta || null;
    const mode =
      result.captureMode ||
      meta?.captureMode ||
      (result.kind === "selection"
        ? "target-context"
        : typeof result.cropped === "boolean"
          ? result.cropped
            ? "target-context"
            : "viewport"
          : frameModeRef.current);
    const isViewportFrame = result.kind === "screenshot" && mode === "viewport";
    return {
      target: isViewportFrame
        ? "Full viewport"
        : meta?.target || selectionLabelFor(selected) || "Preview viewport",
      pageUrl:
        result.pageUrl ||
        meta?.pageUrl ||
        selected?.pageUrl ||
        previewRef.current.url ||
        "",
      pageTitle:
        result.pageTitle ||
        meta?.pageTitle ||
        selected?.pageTitle ||
        previewRef.current.title ||
        "",
      capturedAt:
        result.capturedAt ||
        meta?.capturedAt ||
        (result.kind === "selection" ? selected?.timestamp : undefined) ||
        Date.now(),
      screenshotPath: path || meta?.screenshotPath || null,
      mode,
      delivery: deliverySummary(result),
    };
  }

  useEffect(() => {
    if (!isElectron()) return;
    const api = window.vefg;

    void api
      .getState()
      .then((s) => {
        const initialPreview = {
          url: s.previewUrl,
          loading: false,
          ...(s.previewStatus || {}),
        };
        setUrlInput(initialPreview.url || s.previewUrl);
        setPreview(initialPreview);
        previewRef.current = initialPreview;
        setPickMode(s.pickMode);
        setSelection(s.lastSelection);
        selectionRef.current = s.lastSelection;
        setScreenshotPath(s.lastScreenshotPath);
        screenshotPathRef.current = s.lastScreenshotPath;
        setProjectCwd(s.projectCwd || "");
        setRecentPreviewUrls(s.recentPreviewUrls || []);
        setRecentProjectCwds(s.recentProjectCwds || []);
        applyTerminalRuntime({
          alive: s.terminalAlive,
          shellAlive: s.shellAlive,
          grokLaunchRequested: s.grokLaunchRequested,
          grokReady: s.grokReady,
          grokState: s.grokState,
        });
        setCaptureBusy(Boolean(s.captureBusy));
        setFrameMode(s.frameMode || "viewport");
        if (s.layout?.terminalWidth) setTerminalWidth(s.layout.terminalWidth);

        const saved = s.lastCapture || s.lastCaptureMeta;
        if (saved || s.lastSelection || s.lastScreenshotPath) {
          const selected = saved?.selection ?? s.lastSelection;
          setReceipt({
            target: selectionLabelFor(selected) || "Preview viewport",
            pageUrl:
              saved?.pageUrl || selected?.pageUrl || initialPreview.url || "",
            pageTitle:
              saved?.pageTitle || selected?.pageTitle || initialPreview.title || "",
            capturedAt: saved?.capturedAt || selected?.timestamp || Date.now(),
            screenshotPath:
              saved?.screenshotPath ?? s.lastScreenshotPath ?? null,
            mode: saved?.captureMode || (selected ? "target-context" : "viewport"),
            delivery: "Previous capture loaded; delivery state is unknown.",
          });
        }
      })
      .catch((err) => {
        showToast(
          `Could not read app state: ${err instanceof Error ? err.message : String(err)}`,
        );
      });

    const offs = [
      api.on("preview:status", (p) => {
        const next = p as PreviewStatus;
        setPreview((prev) => {
          const merged = { ...prev, ...next };
          previewRef.current = merged;
          return merged;
        });
        if (typeof next.url === "string") {
          setUrlInput(next.url);
        }
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
      api.on("terminal:exit", () => {
        setTerminalAlive(false);
        setGrokState((current) => (current === "idle" ? "idle" : "exited"));
      }),
      api.on("terminal:status", (p) => {
        applyTerminalRuntime(p as TerminalStatus);
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
        const selected =
          r.selection === undefined
            ? r.captureMeta?.selection ?? selectionRef.current
            : r.selection;
        if (r.selection !== undefined) {
          setSelection(r.selection || null);
          selectionRef.current = r.selection || null;
        }
        const nextPath =
          r.screenshotPath ||
          r.path ||
          r.captureMeta?.screenshotPath ||
          screenshotPathRef.current ||
          null;
        if (r.screenshotPath || r.path) {
          setScreenshotPath(nextPath);
          screenshotPathRef.current = nextPath;
        }
        applyTerminalRuntime(r);

        const delivery = deliverySummary(r);
        if (r.kind === "recopy" || r.kind === "deliver") {
          setReceipt((previous) =>
            previous
              ? { ...previous, delivery }
              : makeReceipt(r, selected || null, nextPath),
          );
        } else {
          setReceipt(makeReceipt(r, selected || null, nextPath));
        }
        showToast(delivery);
      }),
    ];

    // Global Esc in renderer (shell focused) also cancels Aim via IPC
    const onKey = (e: KeyboardEvent) => {
      if (e.key === "Escape" && pickModeRef.current) {
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
  }, []);

  async function onNavigate(e?: FormEvent) {
    e?.preventDefault();
    if (!isElectron()) return;
    let url = urlInput.trim();
    if (!url) return;
    if (!/^https?:\/\//i.test(url)) url = `http://${url}`;
    setUrlInput(url);
    setRecentPreviewUrls((current) => [
      url,
      ...current.filter((item) => item !== url),
    ].slice(0, 8));
    setPreview((current) => ({
      ...current,
      url,
      loading: true,
      error: null,
    }));
    try {
      const result = await window.vefg.navigate(url);
      if (result.status) {
        setPreview((current) => ({ ...current, ...result.status }));
      }
    } catch (err) {
      const message = err instanceof Error ? err.message : String(err);
      setPreview((current) => ({ ...current, loading: false, error: message }));
      showToast(`Preview navigation failed: ${message}`);
    }
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
    const requestedMode = frameMode;
    const effectiveMode =
      requestedMode === "target-context" &&
      (!selection || preview.selectionStale)
        ? "viewport"
        : requestedMode;
    if (effectiveMode !== requestedMode) {
      setFrameMode("viewport");
      showToast(
        preview.selectionStale
          ? "The target belongs to an earlier page, so Frame will capture the full viewport."
          : "No target is selected, so Frame will capture the full viewport.",
      );
    }
    if (!terminalAlive) {
      showToast("Shell is off; the capture will be copied for manual paste.");
    }
    setCaptureBusy(true);
    try {
      await window.vefg.screenshot({ mode: effectiveMode });
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
    selectionRef.current = null;
    setScreenshotPath(null);
    screenshotPathRef.current = null;
    setReceipt(null);
    setReceiptThumbnail(null);
    setFrameMode("viewport");
    showToast("Cleared last capture");
  }

  async function onOpenCaptureFolder() {
    if (!isElectron()) return;
    try {
      const result = await window.vefg.openCaptureFolder();
      showToast(`Opened frames: ${shortPath(result.path, 54)}`);
    } catch (err) {
      showToast(err instanceof Error ? err.message : String(err));
    }
  }

  async function onPickCwd() {
    if (!isElectron()) return;
    const { projectCwd: cwd, terminalRestarted, canceled } =
      await window.vefg.pickProjectDir();
    if (canceled) return;
    setProjectCwd(cwd);
    if (cwd) {
      setRecentProjectCwds((current) => [
        cwd,
        ...current.filter((item) => item !== cwd),
      ].slice(0, 8));
      setGrokState("idle");
      showToast(
        terminalRestarted
          ? `Project switched and terminal restarted: ${cwd}`
          : `Project folder selected: ${cwd}`,
      );
    }
  }

  async function onRecentProject(cwd: string) {
    if (!isElectron() || !cwd || cwd === projectCwd) return;
    try {
      const result = await window.vefg.setProjectDir(cwd);
      if (result.canceled) return;
      setProjectCwd(result.projectCwd);
      setRecentProjectCwds((current) => [
        result.projectCwd,
        ...current.filter((item) => item !== result.projectCwd),
      ].slice(0, 8));
      setGrokState("idle");
      showToast(
        result.terminalRestarted
          ? `Project switched and terminal restarted: ${result.projectCwd}`
          : `Project switched: ${result.projectCwd}`,
      );
    } catch (err) {
      showToast(err instanceof Error ? err.message : String(err));
    }
  }

  async function onLaunchGrok() {
    if (!isElectron()) return;
    const now = Date.now();
    if (now - lastLaunchAtRef.current < 1800) {
      showToast("Grok launch was already requested; check the left terminal.");
      return;
    }
    lastLaunchAtRef.current = now;
    setGrokState("launching");
    try {
      const result = await window.vefg.terminalLaunchGrok();
      applyTerminalRuntime({
        ...result,
        shellAlive: result.shellAlive ?? result.terminalAlive ?? true,
        grokLaunchRequested:
          result.grokLaunchRequested ?? (result.grokReady ? undefined : true),
      });
      showToast(
        result.grokReady
          ? "Grok reported ready."
          : "Grok launch requested — confirm its prompt in the left terminal.",
      );
      focusGrokTerminal();
    } catch (err) {
      setGrokState("idle");
      showToast(err instanceof Error ? err.message : String(err));
    }
  }

  async function onRestartTerminal() {
    if (!isElectron()) return;
    try {
      await window.vefg.terminalRestart({});
      setTerminalAlive(true);
      setGrokState("idle");
      lastLaunchAtRef.current = 0;
      showToast("Shell restarted — launch Grok when ready");
    } catch (err) {
      showToast(err instanceof Error ? err.message : String(err));
    }
  }

  const clampTerminalWidth = useCallback((width: number) => {
    const max = Math.max(
      MIN_TERMINAL_WIDTH,
      window.innerWidth - MIN_PREVIEW_WIDTH - SPLITTER_WIDTH,
    );
    return Math.max(MIN_TERMINAL_WIDTH, Math.min(max, width));
  }, []);

  const commitTerminalWidth = useCallback(
    (width: number, force = false) => {
      const next = clampTerminalWidth(width);
      setTerminalWidth(next);
      if (isElectron()) {
        void window.vefg
          .setSplit(next / window.innerWidth, force ? { force: true } : undefined)
          .then((bounds) => {
            if (force && bounds.terminalWidth) {
              setTerminalWidth(bounds.terminalWidth);
            }
          })
          .catch(() => {
            // Keep the local split usable if the native view is closing.
          });
      }
      return next;
    },
    [clampTerminalWidth],
  );

  const onSplitterDown = useCallback(
    (e: ReactMouseEvent) => {
      e.preventDefault();
      dragging.current = true;
      const startX = e.clientX;
      const startW = terminalWidth;
      let latest = startW;

      const onMove = (ev: MouseEvent) => {
        latest = commitTerminalWidth(startW + (ev.clientX - startX));
      };
      const onUp = () => {
        dragging.current = false;
        window.removeEventListener("mousemove", onMove);
        window.removeEventListener("mouseup", onUp);
        commitTerminalWidth(latest, true);
      };
      window.addEventListener("mousemove", onMove);
      window.addEventListener("mouseup", onUp);
    },
    [commitTerminalWidth, terminalWidth],
  );

  const onSplitterKeyDown = useCallback(
    (e: ReactKeyboardEvent<HTMLDivElement>) => {
      const step = e.shiftKey ? 48 : 16;
      let next: number | null = null;
      if (e.key === "ArrowLeft") next = terminalWidth - step;
      if (e.key === "ArrowRight") next = terminalWidth + step;
      if (e.key === "Home") next = MIN_TERMINAL_WIDTH;
      if (e.key === "End") next = window.innerWidth;
      if (next == null) return;
      e.preventDefault();
      commitTerminalWidth(next, true);
    },
    [commitTerminalWidth, terminalWidth],
  );

  const selectionLabel = selectionLabelFor(selection);

  const hasCapture = Boolean(selection || screenshotPath);
  const previewCapturable = Boolean(
    preview.url && !preview.loading && !preview.error && !preview.isWelcome,
  );
  const setupOnboarding =
    !hasCapture ||
    (Boolean(preview.error) && isDefaultPreview(preview.url));
  const grokLabel =
    grokState === "ready"
      ? "grok ready"
      : grokState === "launching"
        ? "grok launching"
        : grokState === "launch-requested"
          ? "grok requested"
          : grokState === "exited"
            ? "grok exited"
            : "grok not started";
  const launchDisabled =
    grokState === "launching" ||
    grokState === "launch-requested" ||
    grokState === "ready";
  const launchLabel =
    grokState === "launching"
      ? "Launching…"
      : grokState === "launch-requested"
        ? "Launch requested"
        : grokState === "ready"
          ? "Grok ready"
          : "Start Grok";
  const maxTerminalWidth = Math.max(
    MIN_TERMINAL_WIDTH,
    window.innerWidth - MIN_PREVIEW_WIDTH - SPLITTER_WIDTH,
  );
  const splitPercent = Math.round((terminalWidth / window.innerWidth) * 100);

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

          <form
            className={`url-form ${preview.loading ? "loading" : ""}`}
            onSubmit={onNavigate}
            aria-busy={Boolean(preview.loading)}
          >
            <button
              type="button"
              className="icon-btn"
              title="Back"
              aria-label="Go back in preview"
              disabled={preview.canGoBack === false}
              onClick={() => void window.vefg?.goBack()}
            >
              <IconChevronLeft />
            </button>
            <button
              type="button"
              className="icon-btn"
              title="Forward"
              aria-label="Go forward in preview"
              disabled={preview.canGoForward === false}
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
              list="recent-preview-urls"
              onChange={(e) => setUrlInput(e.target.value)}
              placeholder="http://127.0.0.1:5173"
              spellCheck={false}
              aria-label="Preview URL"
            />
            <datalist id="recent-preview-urls">
              {recentPreviewUrls.map((url) => (
                <option value={url} key={url} />
              ))}
            </datalist>
            {preview.loading ? (
              <span
                className="url-loading-spinner"
                role="progressbar"
                aria-label="Loading preview"
              />
            ) : null}
            <button type="submit" className="url-go" aria-label="Open URL">
              Go
            </button>
          </form>

          {/* Empty titlebar region: drag the window */}
          <div className="titlebar-drag-spacer" aria-hidden />

          <div className="toolbar-actions" role="group" aria-label="Capture actions">
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
            {recentProjectCwds.length > 1 ? (
              <select
                className="recent-project-select"
                value=""
                onChange={(event) => {
                  void onRecentProject(event.target.value);
                }}
                aria-label="Switch to recent project folder"
                title="Recent project folders"
              >
                <option value="">Recent…</option>
                {recentProjectCwds.map((cwd) => (
                  <option value={cwd} key={cwd} disabled={cwd === projectCwd}>
                    {shortPath(cwd, 30)}
                  </option>
                ))}
              </select>
            ) : null}
            <button
              type="button"
              className="btn btn-primary"
              onClick={() => void onLaunchGrok()}
              disabled={launchDisabled}
              title={
                grokState === "launch-requested"
                  ? "Launch was requested. Confirm the Grok prompt on the left; Reset term to start over."
                  : grokState === "ready"
                    ? "Grok readiness was reported by the terminal runtime"
                    : "Request Grok to start in the left terminal"
              }
              aria-label="Start Grok in terminal"
            >
              <IconPlay />
              {launchLabel}
            </button>
            <button
              type="button"
              className={`btn btn-pick ${pickMode ? "active" : ""}`}
              onClick={() => void togglePick()}
              disabled={captureBusy || (!pickMode && !previewCapturable)}
              title={
                captureBusy
                  ? "Capture in progress — wait a moment"
                  : "Aim (⌘⇧A) — capture image + DOM context for Grok"
              }
              aria-label={pickMode ? "Cancel aim mode" : "Aim at page element"}
              aria-pressed={pickMode}
              aria-busy={captureBusy}
            >
              <IconCrosshair />
              {pickMode ? "Aiming… Esc" : "Aim"}
            </button>
            <div className="frame-control">
              <select
                className="frame-mode-select"
                value={frameMode}
                onChange={(e) => setFrameMode(e.target.value as FrameMode)}
                disabled={captureBusy || !previewCapturable}
                aria-label="Frame capture area"
                title={
                  frameMode === "viewport"
                    ? "Capture the full visible preview"
                    : "Capture the selected target with surrounding context"
                }
              >
                <option value="viewport">Full view</option>
                <option
                  value="target-context"
                  disabled={!selection || preview.selectionStale}
                >
                  Target
                </option>
              </select>
              <button
                type="button"
                className="btn frame-button"
                disabled={captureBusy || !previewCapturable}
                onClick={() => void onScreenshot()}
                title={
                  captureBusy
                    ? "Capture in progress — wait a moment"
                    : frameMode === "viewport"
                      ? "Frame full viewport (⌘⇧F)"
                      : "Frame selected target with context (⌘⇧F)"
                }
                aria-label={`Capture ${
                  frameMode === "viewport"
                    ? "full preview viewport"
                    : "selected target with context"
                }`}
                aria-busy={captureBusy}
              >
                <IconCamera />
                {captureBusy ? "…" : "Frame"}
              </button>
            </div>
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
          aria-atomic="false"
        >
          {captureBusy ? (
            <div className="banner-inline pick">
              Busy — capture in flight · Aim / Frame / Re-send paused
            </div>
          ) : pickMode ? (
            <div className="banner-inline pick">
              {grokState === "launch-requested" || grokState === "ready"
                ? "Aiming — click a node on the right · Esc cancels · image + DOM paste will be attempted in Grok"
                : "Aiming — click a node on the right · Esc cancels · Grok is not running, so the capture will stay on the clipboard"}
            </div>
          ) : toast ? (
            <div className="toast-inline">{toast}</div>
          ) : setupOnboarding ? (
            <div
              className={`setup-inline ${preview.error ? "error" : ""}`}
              title={preview.error || undefined}
            >
              <strong>
                {preview.error
                  ? isDefaultPreview(preview.url)
                    ? "Default preview isn’t running."
                    : "Preview isn’t loading."
                  : "First capture:"}
              </strong>
              <span>
                <b>1</b> Folder
              </span>
              <span>
                <b>2</b> Start Grok
              </span>
              <span>
                <b>3</b> URL → Go
              </span>
              <span>
                <b>4</b> Aim, then write the change in Grok
              </span>
              <span className={`term-pill ${terminalAlive ? "on" : "off"}`}>
                {terminalAlive ? "pty on" : "pty off"}
              </span>
              <span className={`term-pill grok ${grokState}`}>{grokLabel}</span>
              <button
                type="button"
                className="link-btn setup-reset"
                onClick={() => void onRestartTerminal()}
              >
                Reset term
              </button>
            </div>
          ) : preview.error ? (
            <div className="banner-inline">
              Preview failed: {preview.error}
              <span className="hint"> · is the page running? Try Go / ⌘R</span>
            </div>
          ) : (
            <>
              {preview.loading ? (
                <span className="preview-loading-chip">preview loading…</span>
              ) : null}
              <span
                className={`chip-tag ${selectionLabel ? "" : "muted"} ${preview.selectionStale ? "stale" : ""}`}
                title={
                  preview.selectionStale
                    ? "This target belongs to a previous page; Re-send keeps its old screenshot, while a new Frame uses the current viewport."
                    : undefined
                }
              >
                {selectionLabel || "no target"}
                {preview.selectionStale ? " · prior page" : ""}
              </span>
              {receipt ? (
                <details className="capture-receipt">
                  <summary
                    className="chip-shot"
                    title={receipt.screenshotPath || "Last capture receipt"}
                  >
                    Last capture
                  </summary>
                  <div
                    className="receipt-card"
                    style={{
                      width: Math.max(220, Math.min(460, terminalWidth - 90)),
                    }}
                  >
                    <div className="receipt-heading">
                      <span className="receipt-icon" aria-hidden>
                        <IconCamera />
                      </span>
                      <div>
                        <strong>Capture receipt</strong>
                        <span>{formatReceiptTime(receipt.capturedAt)}</span>
                      </div>
                    </div>
                    {receiptThumbnail ? (
                      <img
                        className="receipt-thumbnail"
                        src={receiptThumbnail}
                        alt={`Last capture: ${receipt.target}`}
                      />
                    ) : null}
                    <dl className="receipt-grid">
                      <dt>Target</dt>
                      <dd title={receipt.target}>{receipt.target}</dd>
                      <dt>Page</dt>
                      <dd title={receipt.pageUrl || receipt.pageTitle}>
                        {shortPath(
                          receipt.pageTitle || receipt.pageUrl || "Unknown page",
                          58,
                        )}
                      </dd>
                      <dt>Frame</dt>
                      <dd title={receipt.screenshotPath || undefined}>
                        {receipt.screenshotPath
                          ? shortPath(receipt.screenshotPath, 58)
                          : "No local image path"}
                      </dd>
                      <dt>Mode</dt>
                      <dd>
                        {receipt.mode === "viewport"
                          ? "Full viewport"
                          : "Target + context"}
                      </dd>
                      <dt>Delivery</dt>
                      <dd className="receipt-delivery">{receipt.delivery}</dd>
                    </dl>
                    <div className="receipt-actions">
                      <button
                        type="button"
                        className="link-btn"
                        onClick={() => void onOpenCaptureFolder()}
                      >
                        Open frames folder
                      </button>
                      <button
                        type="button"
                        className="link-btn danger"
                        onClick={() => void onClear()}
                      >
                        Clear capture
                      </button>
                    </div>
                  </div>
                </details>
              ) : screenshotPath ? (
                <span className="chip-shot" title={screenshotPath}>
                  frame
                </span>
              ) : null}
              <span
                className={`term-pill ${terminalAlive ? "on" : "off"}`}
                title={
                  terminalAlive
                    ? "PTY process is alive; the adjacent badge reports whether it is Grok"
                    : "PTY process is not running"
                }
              >
                {terminalAlive ? "pty on" : "pty off"}
              </span>
              <span
                className={`term-pill grok ${grokState}`}
                title={
                  grokState === "ready"
                    ? "The terminal runtime explicitly reported Grok ready"
                    : grokState === "launch-requested"
                      ? "Launch was requested; confirm the Grok prompt on the left"
                      : "Grok readiness is not confirmed"
                }
              >
                {grokLabel}
              </span>
              <span
                className="chip-selector muted-hint"
                title={projectCwd || undefined}
              >
                {projectCwd
                  ? shortPath(projectCwd)
                  : "Choose Folder to anchor edits to your project"}
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
              </div>
            </>
          )}
        </div>
      </header>

      <div className="workspace">
        <section
          id="terminal-pane"
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
          onKeyDown={onSplitterKeyDown}
          tabIndex={0}
          title="Drag, or use Left/Right arrows to resize panes"
          role="separator"
          aria-orientation="vertical"
          aria-label="Resize terminal and preview"
          aria-controls="terminal-pane preview-pane"
          aria-valuemin={MIN_TERMINAL_WIDTH}
          aria-valuemax={maxTerminalWidth}
          aria-valuenow={Math.round(terminalWidth)}
          aria-valuetext={`${splitPercent}% terminal width`}
        />

        <section
          id="preview-pane"
          className="preview-pane"
          aria-label="Website preview"
        >
          <div className="preview-area" aria-hidden />
        </section>
      </div>
    </div>
  );
}
