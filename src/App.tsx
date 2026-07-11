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
  IconPanelCollapse,
  IconPanelExpand,
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
import {
  detectBrowserLocale,
  localeLabel,
  normalizeLocale,
  t,
  type Locale,
} from "./i18n";

const DEFAULT_PREVIEW_URL = "";
const MIN_TERMINAL_WIDTH = 400;
const MIN_PREVIEW_WIDTH = 320;
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

const DELIVERY_KIND_KEYS: Record<string, string> = {
  "image-attempted": "delivery.kind.imageAttempted",
  "text-attempted": "delivery.kind.textAttempted",
  "clipboard-only": "delivery.kind.clipboardOnly",
  "local-only": "delivery.kind.localOnly",
  failed: "delivery.kind.failed",
  unknown: "delivery.kind.unknown",
};

/** Prefer structured outcome from main; never implies a confirmed image chip. */
function deliverySummary(result: CaptureResult, locale: Locale): string {
  if (result.deliveryOutcomeLabel) return result.deliveryOutcomeLabel;
  const kind = result.deliveryOutcome;
  if (kind && DELIVERY_KIND_KEYS[kind]) {
    return t(locale, DELIVERY_KIND_KEYS[kind]);
  }
  if (result.kind === "error") return t(locale, "delivery.kind.failed");
  if (
    result.imageChipAttempted ||
    (result.pastedToTerminal && result.imageChip)
  ) {
    return t(locale, "delivery.kind.imageAttempted");
  }
  if (result.deliveryAttempted || result.pastedToTerminal) {
    return t(locale, "delivery.kind.textAttempted");
  }
  if (result.copied) return t(locale, "delivery.kind.clipboardOnly");
  return t(locale, "delivery.kind.localOnly");
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
  const captureBusyRef = useRef(false);
  const [projectCwd, setProjectCwd] = useState("");
  const [recentPreviewUrls, setRecentPreviewUrls] = useState<string[]>([]);
  const [recentProjectCwds, setRecentProjectCwds] = useState<string[]>([]);
  const [terminalWidth, setTerminalWidth] = useState(640);
  /** When true, hide preview + URL chrome; terminal is full width */
  const [previewCollapsed, setPreviewCollapsed] = useState(false);
  const previewCollapsedRef = useRef(false);
  const [terminalAlive, setTerminalAlive] = useState(false);
  const [grokState, setGrokState] = useState<GrokRuntimeState>("idle");
  type TermTab = {
    id: string;
    cwd: string;
    label: string;
    /** Disambiguated when multiple tabs share the same basename */
    displayLabel?: string;
    shellAlive?: boolean;
    grokRunning?: boolean;
    mode?: string | null;
  };
  const [termTabs, setTermTabs] = useState<TermTab[]>([]);
  const [activeTermId, setActiveTermId] = useState<string | null>(null);
  const activeTermIdRef = useRef<string | null>(null);
  const [maxTermSessions, setMaxTermSessions] = useState(6);
  const [frameMode, setFrameMode] = useState<FrameMode>("viewport");
  const [receipt, setReceipt] = useState<CaptureReceipt | null>(null);
  const [receiptThumbnail, setReceiptThumbnail] = useState<string | null>(null);
  const [termFocusNonce, setTermFocusNonce] = useState(0);
  /** Bump after splitter settle so xterm re-fits and PTY gets new cols (wide tables). */
  const [termFitNonce, setTermFitNonce] = useState(0);
  const [locale, setLocale] = useState<Locale>(() => detectBrowserLocale());
  const localeRef = useRef(locale);
  const dragging = useRef(false);

  function requestTerminalFit() {
    setTermFitNonce((n) => n + 1);
  }
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
    captureBusyRef.current = captureBusy;
  }, [captureBusy]);

  useEffect(() => {
    previewCollapsedRef.current = previewCollapsed;
  }, [previewCollapsed]);

  useEffect(() => {
    activeTermIdRef.current = activeTermId;
  }, [activeTermId]);

  /**
   * Bind Folder / Start Grok / status pills to the *active* tab only.
   * Mirrors electron/runtime-policy resolveActiveTabUiState (no sticky Grok).
   */
  function applyActiveTabUi(tab: TermTab | undefined | null) {
    if (!tab) {
      setProjectCwd("");
      setTerminalAlive(false);
      setGrokState("idle");
      return;
    }
    setProjectCwd(tab.cwd || "");
    // Same policy as resolveActiveTabUiState({ shellAlive, grokRunning })
    const shellAlive = Boolean(tab.shellAlive);
    setTerminalAlive(shellAlive);
    if (tab.grokRunning) {
      setGrokState("launch-requested");
    } else if (shellAlive) {
      setGrokState("idle");
    } else {
      setGrokState("exited");
    }
  }

  function applyTerminalSessions(payload: unknown) {
    const p = payload as {
      sessions?: TermTab[];
      activeId?: string | null;
      maxSessions?: number;
    };
    const sessions = Array.isArray(p.sessions) ? p.sessions : [];
    setTermTabs(sessions);
    if (typeof p.maxSessions === "number" && p.maxSessions > 0) {
      setMaxTermSessions(p.maxSessions);
    }
    const nextActive =
      p.activeId && sessions.some((s) => s.id === p.activeId)
        ? p.activeId
        : sessions[0]?.id || null;
    setActiveTermId(nextActive);
    activeTermIdRef.current = nextActive;
    const active = sessions.find((s) => s.id === nextActive);
    applyActiveTabUi(active || null);
  }

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
    localeRef.current = locale;
    document.documentElement.lang = locale === "zh" ? "zh-CN" : "en";
  }, [locale]);

  function tr(key: string, vars?: Record<string, string | number>) {
    return t(locale, key, vars);
  }

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
    window.setTimeout(() => setToast((cur) => (cur === msg ? null : cur)), 6200);
  }

  /** Prefer main-process actionable errors; still never invent chip confirmation. */
  function toastError(err: unknown) {
    const raw = err instanceof Error ? err.message : String(err);
    showToast(raw);
  }

  async function onToggleLocale() {
    const next: Locale = locale === "zh" ? "en" : "zh";
    setLocale(next);
    if (isElectron()) {
      try {
        const res = await window.vefg.setLocale(next);
        setLocale(normalizeLocale(res.locale));
      } catch {
        /* keep local */
      }
    }
    showToast(t(next, "toast.langChanged", { lang: localeLabel(next) }));
  }

  function applyTerminalRuntime(status: TerminalStatus) {
    const shellAlive =
      status.shellAlive ?? status.terminalAlive ?? status.alive;
    if (typeof shellAlive === "boolean") setTerminalAlive(shellAlive);

    // Keep shell-alive separate from Grok readiness. "running" / launch-requested
    // never promote to ready unless grokReady/readiness is explicitly ready.
    // When grokRunning is explicitly false, clear sticky launch state (active tab).
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
        status.grokRunning === true ||
        raw === "launch-requested" ||
        raw === "requested" ||
        raw === "running"
      ) {
        return "launch-requested";
      }
      if (raw === "exited" || raw === "stopped") return "exited";
      if (raw === "idle" || raw === "not-started") return "idle";
      if (status.grokRunning === false && status.grokLaunchRequested !== true) {
        return shellAlive === false ? "exited" : "idle";
      }
      if (shellAlive === false) {
        return current === "idle" ? "idle" : "exited";
      }
      // Sparse update with no Grok signal: do not keep another tab's "requested"
      if (
        status.grokRunning == null &&
        status.grokLaunchRequested == null &&
        !status.grokState &&
        status.grokReady == null
      ) {
        return current;
      }
      return "idle";
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
        ? t(localeRef.current, "target.fullViewport")
        : meta?.target || selectionLabelFor(selected) || t(localeRef.current, "target.previewViewport"),
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
      delivery: deliverySummary(result, localeRef.current),
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
        if (s.terminals) {
          applyTerminalSessions(s.terminals);
        } else {
          applyTerminalRuntime({
            alive: s.terminalAlive,
            shellAlive: s.shellAlive,
            grokLaunchRequested: s.grokLaunchRequested,
            grokReady: s.grokReady,
            grokState: s.grokState,
          });
        }
        setCaptureBusy(Boolean(s.captureBusy));
        setFrameMode(s.frameMode || "viewport");
        if (s.layout?.terminalWidth) setTerminalWidth(s.layout.terminalWidth);
        const collapsed = Boolean(
          s.previewCollapsed ?? s.layout?.previewCollapsed,
        );
        setPreviewCollapsed(collapsed);
        previewCollapsedRef.current = collapsed;
        if (s.locale) {
          const loc = normalizeLocale(s.locale);
          setLocale(loc);
          localeRef.current = loc;
        }

        const saved = s.lastCapture || s.lastCaptureMeta;
        if (saved || s.lastSelection || s.lastScreenshotPath) {
          const selected = saved?.selection ?? s.lastSelection;
          const loc = normalizeLocale(s.locale || localeRef.current);
          setReceipt({
            target: selectionLabelFor(selected) || t(loc, "target.previewViewport"),
            pageUrl:
              saved?.pageUrl || selected?.pageUrl || initialPreview.url || "",
            pageTitle:
              saved?.pageTitle || selected?.pageTitle || initialPreview.title || "",
            capturedAt: saved?.capturedAt || selected?.timestamp || Date.now(),
            screenshotPath:
              saved?.screenshotPath ?? s.lastScreenshotPath ?? null,
            mode: saved?.captureMode || (selected ? "target-context" : "viewport"),
            delivery: t(loc, "delivery.kind.unknown"),
          });
        }
      })
      .catch((err) => {
        showToast(
          t(localeRef.current, "toast.stateFailed", {
            error: err instanceof Error ? err.message : String(err),
          }),
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
        const b = p as {
          terminalWidth?: number;
          previewCollapsed?: boolean;
        };
        if (typeof b.previewCollapsed === "boolean") {
          setPreviewCollapsed(b.previewCollapsed);
          previewCollapsedRef.current = b.previewCollapsed;
        }
        if (!dragging.current && b.terminalWidth) {
          setTerminalWidth(b.terminalWidth);
        }
      }),
      api.on("terminal:exit", (p) => {
        const st = p as { sessionId?: string };
        if (st.sessionId && st.sessionId !== activeTermIdRef.current) return;
        setTerminalAlive(false);
        setGrokState((current) => (current === "idle" ? "idle" : "exited"));
      }),
      api.on("terminal:status", (p) => {
        const st = p as TerminalStatus & { sessionId?: string };
        if (st.sessionId && st.sessionId !== activeTermIdRef.current) return;
        applyTerminalRuntime(st);
        if (typeof st.cwd === "string" && st.cwd) setProjectCwd(st.cwd);
      }),
      api.on("terminal:sessions", (p) => {
        applyTerminalSessions(p);
      }),
      api.on("capture:busy", (p) => {
        const st = p as { busy?: boolean };
        const busy = Boolean(st.busy);
        captureBusyRef.current = busy;
        setCaptureBusy(busy);
      }),
      api.on("app:locale", (p) => {
        const loc = normalizeLocale((p as { locale?: string }).locale);
        setLocale(loc);
        localeRef.current = loc;
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
          showToast(
            r.message ||
              t(localeRef.current, "error.captureFailed") +
                " " +
                t(localeRef.current, "error.next.capture"),
          );
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

        const delivery = deliverySummary(r, localeRef.current);
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
      // ⌘⇧A Aim · ⌘⇧F Frame · ⌘⇧V Re-send — same busy single-flight as buttons
      if ((e.metaKey || e.ctrlKey) && e.shiftKey) {
        const k = e.key.toLowerCase();
        if (k === "a" || k === "f" || k === "v") {
          e.preventDefault();
          if (captureBusyRef.current) {
            // Match main busy guidance: message + next step
            setToast(
              `${t(localeRef.current, "error.busy")} ${t(localeRef.current, "error.next.wait")}`,
            );
            return;
          }
          if (k === "a") void togglePickRef.current();
          else if (k === "f") void onScreenshotRef.current();
          else void onResendRef.current();
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
      showToast(tr("toast.navFailed", { error: message }));
    }
  }

  async function applyPreviewCollapsed(collapsed: boolean) {
    if (!isElectron()) {
      setPreviewCollapsed(collapsed);
      previewCollapsedRef.current = collapsed;
      requestAnimationFrame(() => requestTerminalFit());
      return;
    }
    try {
      if (collapsed && pickModeRef.current) {
        const res = await window.vefg.setPickMode(false);
        setPickMode(res.pickMode);
      }
      const bounds = await window.vefg.setPreviewCollapsed(collapsed);
      setPreviewCollapsed(Boolean(bounds.previewCollapsed ?? collapsed));
      previewCollapsedRef.current = Boolean(
        bounds.previewCollapsed ?? collapsed,
      );
      if (bounds.terminalWidth) setTerminalWidth(bounds.terminalWidth);
      requestAnimationFrame(() => requestTerminalFit());
    } catch (err) {
      toastError(err);
    }
  }

  async function ensurePreviewExpanded() {
    if (!previewCollapsedRef.current) return;
    await applyPreviewCollapsed(false);
  }

  async function togglePick() {
    if (!isElectron() || captureBusyRef.current || captureBusy) return;
    const next = !pickMode;
    if (next) await ensurePreviewExpanded();
    const res = await window.vefg.setPickMode(next);
    setPickMode(res.pickMode);
    if (res.warning) showToast(res.warning);
    if (typeof res.terminalAlive === "boolean") {
      setTerminalAlive(res.terminalAlive);
    }
  }
  togglePickRef.current = togglePick;

  async function onScreenshot() {
    if (!isElectron() || captureBusyRef.current || captureBusy) return;
    await ensurePreviewExpanded();
    captureBusyRef.current = true;
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
          ? tr("toast.staleTargetFrame")
          : tr("toast.noTargetFrame"),
      );
    }
    if (!terminalAlive) {
      showToast(tr("toast.shellOffCopy"));
    }
    setCaptureBusy(true);
    try {
      await window.vefg.screenshot({ mode: effectiveMode });
    } catch (err) {
      toastError(err);
    } finally {
      // Main also emits capture:busy; clear local in case event was missed
      captureBusyRef.current = false;
      setCaptureBusy(false);
    }
  }
  onScreenshotRef.current = onScreenshot;

  async function onResend() {
    if (!isElectron() || captureBusyRef.current || captureBusy) return;
    if (!selection && !screenshotPath) {
      showToast(tr("toast.nothingResend"));
      return;
    }
    captureBusyRef.current = true;
    setCaptureBusy(true);
    try {
      await window.vefg.deliver({});
    } catch (err) {
      toastError(err);
    } finally {
      captureBusyRef.current = false;
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
    showToast(tr("toast.cleared"));
  }

  async function onOpenCaptureFolder() {
    if (!isElectron()) return;
    try {
      const result = await window.vefg.openCaptureFolder();
      showToast(tr("toast.openedFrames", { path: shortPath(result.path, 54) }));
    } catch (err) {
      toastError(err);
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
          ? tr("toast.folderRestarted", { path: cwd })
          : tr("toast.folderSwitched", { path: cwd }),
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
          ? tr("toast.folderRestarted", { path: result.projectCwd })
          : tr("toast.folderSwitched", { path: result.projectCwd }),
      );
    } catch (err) {
      toastError(err);
    }
  }

  async function onLaunchGrok() {
    if (!isElectron()) return;
    const now = Date.now();
    if (now - lastLaunchAtRef.current < 1800) {
      showToast(tr("toast.grokAlready"));
      return;
    }
    lastLaunchAtRef.current = now;
    setGrokState("launching");
    try {
      const result = await window.vefg.terminalLaunchGrok({
        sessionId: activeTermIdRef.current || undefined,
      });
      applyTerminalRuntime({
        ...result,
        shellAlive: result.shellAlive ?? result.terminalAlive ?? true,
        grokLaunchRequested:
          result.grokLaunchRequested ?? (result.grokReady ? undefined : true),
      });
      showToast(
        result.grokReady ? tr("toast.grokStarted") : tr("toast.grokLaunching"),
      );
      focusGrokTerminal();
    } catch (err) {
      setGrokState("idle");
      toastError(err);
    }
  }

  async function onRestartTerminal() {
    if (!isElectron()) return;
    try {
      await window.vefg.terminalRestart({
        sessionId: activeTermIdRef.current || undefined,
      });
      setTerminalAlive(true);
      setGrokState("idle");
      lastLaunchAtRef.current = 0;
      showToast(tr("toast.shellRestarted"));
    } catch (err) {
      toastError(err);
    }
  }

  async function onSelectTerminal(sessionId: string) {
    if (!isElectron() || !sessionId || sessionId === activeTermIdRef.current) {
      return;
    }
    try {
      const snap = await window.vefg.terminalSetActive(sessionId);
      applyTerminalSessions(snap);
      requestAnimationFrame(() => requestTerminalFit());
      focusGrokTerminal();
    } catch (err) {
      toastError(err);
    }
  }

  async function onNewTerminal() {
    if (!isElectron()) return;
    if (termTabs.length >= maxTermSessions) {
      showToast(tr("term.maxSessions", { max: maxTermSessions }));
      return;
    }
    try {
      const snap = await window.vefg.terminalCreate({
        cwd: projectCwd || undefined,
        activate: true,
      });
      applyTerminalSessions(snap);
      requestAnimationFrame(() => requestTerminalFit());
      showToast(tr("term.created"));
    } catch (err) {
      toastError(err);
    }
  }

  async function onCloseTerminal(sessionId: string) {
    if (!isElectron() || !sessionId) return;
    if (termTabs.length <= 1) {
      showToast(tr("term.keepOne"));
      return;
    }
    try {
      const snap = (await window.vefg.terminalClose(sessionId)) as {
        canceled?: boolean;
        sessions?: TermTab[];
        activeId?: string | null;
      };
      if (snap.canceled) return;
      applyTerminalSessions(snap);
      requestAnimationFrame(() => requestTerminalFit());
    } catch (err) {
      toastError(err);
    }
  }

  const clampTerminalWidth = useCallback((width: number) => {
    if (previewCollapsedRef.current) {
      return Math.max(MIN_TERMINAL_WIDTH, window.innerWidth);
    }
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
            // After layout flush, force xterm fit + PTY resize for Grok reflow
            if (force) {
              requestAnimationFrame(() => requestTerminalFit());
            }
          })
          .catch(() => {
            // Keep the local split usable if the native view is closing.
          });
      } else if (force) {
        requestAnimationFrame(() => requestTerminalFit());
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
      ? tr("status.grokReady")
      : grokState === "launching"
        ? tr("status.grokLaunching")
        : grokState === "launch-requested"
          ? tr("status.grokRequested")
          : grokState === "exited"
            ? tr("status.grokExited")
            : grokState === "unknown"
              ? tr("status.grokUnknown")
              : tr("status.grokIdle");
  const launchDisabled =
    grokState === "launching" ||
    grokState === "launch-requested" ||
    grokState === "ready";
  const launchLabel =
    grokState === "launching"
      ? tr("actions.launching")
      : grokState === "launch-requested"
        ? tr("actions.launchRequested")
        : grokState === "ready"
          ? tr("actions.grokReady")
          : tr("actions.startGrok");
  const maxTerminalWidth = previewCollapsed
    ? window.innerWidth
    : Math.max(
        MIN_TERMINAL_WIDTH,
        window.innerWidth - MIN_PREVIEW_WIDTH - SPLITTER_WIDTH,
      );
  const splitPercent = Math.round((terminalWidth / window.innerWidth) * 100);
  const terminalPaneStyle = previewCollapsed
    ? { width: "100%" as const, flex: "1 1 auto" as const }
    : { width: terminalWidth };

  const activeTabMeta = termTabs.find((t) => t.id === activeTermId);
  const activeTabLabel =
    activeTabMeta?.displayLabel ||
    activeTabMeta?.label ||
    (projectCwd ? projectCwd.split(/[/\\]/).pop() : "") ||
    tr("pane.terminal");

  const urlNavForm = (
    <form
      className={`url-form ${preview.loading ? "loading" : ""}`}
      onSubmit={onNavigate}
      aria-busy={Boolean(preview.loading)}
    >
      <button
        type="button"
        className="icon-btn"
        title={tr("nav.back")}
        aria-label={tr("nav.backAria")}
        disabled={preview.canGoBack === false}
        onClick={() => void window.vefg?.goBack()}
      >
        <IconChevronLeft />
      </button>
      <button
        type="button"
        className="icon-btn"
        title={tr("nav.forward")}
        aria-label={tr("nav.forwardAria")}
        disabled={preview.canGoForward === false}
        onClick={() => void window.vefg?.goForward()}
      >
        <IconChevronRight />
      </button>
      <button
        type="button"
        className="icon-btn"
        title={tr("nav.reload")}
        aria-label={tr("nav.reloadAria")}
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
        aria-label={tr("nav.urlAria")}
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
          aria-label={tr("nav.loading")}
        />
      ) : null}
      <button type="submit" className="url-go" aria-label={tr("nav.goAria")}>
        {tr("nav.go")}
      </button>
    </form>
  );

  /** Terminal-scoped: folder + Start Grok for the active tab */
  const terminalScopedActions = (
    <div
      className="pane-actions term-pane-actions"
      role="group"
      aria-label={tr("term.actionsAria")}
    >
      <button
        type="button"
        className="btn btn-ghost btn-compact"
        onClick={() => void onPickCwd()}
        title={projectCwd || tr("actions.folderTitle")}
        aria-label={tr("actions.folderAria")}
      >
        <IconFolder />
        {tr("actions.folder")}
      </button>
      {recentProjectCwds.length > 1 ? (
        <select
          className="recent-project-select compact"
          value=""
          onChange={(event) => {
            void onRecentProject(event.target.value);
          }}
          aria-label={tr("actions.recentAria")}
          title={tr("actions.recentTitle")}
        >
          <option value="">{tr("actions.recent")}</option>
          {recentProjectCwds.map((cwd) => (
            <option value={cwd} key={cwd} disabled={cwd === projectCwd}>
              {shortPath(cwd, 30)}
            </option>
          ))}
        </select>
      ) : null}
      <button
        type="button"
        className="btn btn-primary btn-compact"
        onClick={() => void onLaunchGrok()}
        disabled={launchDisabled}
        title={
          grokState === "launch-requested"
            ? tr("actions.startGrokTitleRequested")
            : grokState === "ready"
              ? tr("actions.startGrokTitleReady")
              : tr("actions.startGrokTitleIdle")
        }
        aria-label={tr("actions.startGrokAria")}
      >
        <IconPlay />
        {launchLabel}
      </button>
      <button
        type="button"
        className="btn btn-ghost btn-compact"
        onClick={() => void onRestartTerminal()}
        title={tr("status.resetTermAria")}
        aria-label={tr("status.resetTermAria")}
      >
        {tr("status.resetTerm")}
      </button>
    </div>
  );

  /** Preview-scoped: Aim / Frame / Resend → deliver into active terminal */
  const previewScopedActions = (
    <div
      className="pane-actions preview-pane-actions"
      role="group"
      aria-label={tr("actions.groupAria")}
    >
      <button
        type="button"
        className={`btn btn-pick btn-compact ${pickMode ? "active" : ""}`}
        onClick={() => void togglePick()}
        disabled={
          captureBusy ||
          (!pickMode && !previewCapturable && !previewCollapsed)
        }
        title={
          captureBusy
            ? tr("actions.busyTitle")
            : tr("actions.aimTitle")
        }
        aria-label={
          pickMode ? tr("actions.aimCancelAria") : tr("actions.aimAria")
        }
        aria-pressed={pickMode}
        aria-busy={captureBusy}
      >
        <IconCrosshair />
        {pickMode ? tr("actions.aiming") : tr("actions.aim")}
      </button>
      <div className="frame-control compact">
        <select
          className="frame-mode-select"
          value={frameMode}
          onChange={(e) => setFrameMode(e.target.value as FrameMode)}
          disabled={captureBusy || (!previewCapturable && !previewCollapsed)}
          aria-label={tr("actions.frameModeAria")}
          title={
            frameMode === "viewport"
              ? tr("actions.frameModeViewport")
              : tr("actions.frameModeTarget")
          }
        >
          <option value="viewport">{tr("actions.frameFull")}</option>
          <option
            value="target-context"
            disabled={!selection || preview.selectionStale}
          >
            {tr("actions.frameTarget")}
          </option>
        </select>
        <button
          type="button"
          className="btn frame-button btn-compact"
          disabled={captureBusy || (!previewCapturable && !previewCollapsed)}
          onClick={() => void onScreenshot()}
          title={
            captureBusy
              ? tr("actions.busyTitle")
              : frameMode === "viewport"
                ? tr("actions.frameTitleViewport")
                : tr("actions.frameTitleTarget")
          }
          aria-label={`Capture ${
            frameMode === "viewport"
              ? tr("actions.frameAriaViewport")
              : tr("actions.frameAriaTarget")
          }`}
          aria-busy={captureBusy}
        >
          <IconCamera />
          {captureBusy ? "…" : tr("actions.frame")}
        </button>
      </div>
      <button
        type="button"
        className="btn btn-compact"
        disabled={!hasCapture || captureBusy}
        onClick={() => void onResend()}
        title={
          captureBusy
            ? tr("actions.busyTitle")
            : hasCapture
              ? tr("actions.resendTitleActive", { tab: activeTabLabel })
              : tr("actions.resendEmpty")
        }
        aria-label={tr("actions.resendAria")}
        aria-busy={captureBusy}
      >
        <IconSend />
        {tr("actions.resend")}
      </button>
    </div>
  );

  return (
    <div className={`shell ${previewCollapsed ? "preview-collapsed" : ""}`}>
      <header className="toolbar">
        <div className="toolbar-row">
          <div className="brand" title={tr("app.name")}>
            <div className="brand-mark" aria-hidden>
              <IconMark />
            </div>
            <div className="brand-text">
              <span className="brand-name">{tr("brand.name")}</span>
              <span className="brand-sub">{tr("brand.sub")}</span>
            </div>
          </div>

          <button
            type="button"
            className="btn btn-ghost lang-toggle"
            onClick={() => void onToggleLocale()}
            title={tr("actions.langTitle")}
            aria-label={tr("actions.langTitle")}
          >
            {locale === "zh" ? tr("actions.langEn") : tr("actions.langZh")}
          </button>

          {/* Empty titlebar region: drag the window */}
          <div className="titlebar-drag-spacer" aria-hidden />

          <div
            className="toolbar-actions"
            role="group"
            aria-label={tr("actions.appChromeAria")}
          >
            {previewCollapsed ? (
              <>
                <button
                  type="button"
                  className="btn btn-ghost"
                  onClick={() => void applyPreviewCollapsed(false)}
                  title={tr("pane.expandTitle")}
                  aria-label={tr("pane.expandAria")}
                >
                  <IconPanelExpand />
                  {tr("pane.expand")}
                </button>
                {/* Capture stays available while preview is hidden (auto-expands) */}
                {previewScopedActions}
              </>
            ) : null}
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
              {tr("status.busy")}
            </div>
          ) : pickMode ? (
            <div className="banner-inline pick">
              {grokState === "launch-requested" || grokState === "ready"
                ? tr("status.aimingWithGrok")
                : tr("status.aimingNoGrok")}
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
                    ? tr("status.setupDefaultDead")
                    : tr("status.setupPreviewFail")
                  : tr("status.setupFirst")}
              </strong>
              <span>
                <b>1</b> {tr("status.setup1")}
              </span>
              <span>
                <b>2</b> {tr("status.setup2")}
              </span>
              <span>
                <b>3</b> {tr("status.setup3")}
              </span>
              <span>
                <b>4</b> {tr("status.setup4")}
              </span>
              <span
                className={`term-pill ${terminalAlive ? "on" : "off"}`}
                title={
                  terminalAlive
                    ? tr("status.shellOnTitle")
                    : tr("status.shellOffTitle")
                }
              >
                {terminalAlive ? tr("status.shellOn") : tr("status.shellOff")}
              </span>
              <span className={`term-pill grok ${grokState}`}>{grokLabel}</span>
              <button
                type="button"
                className="link-btn setup-reset"
                onClick={() => void onRestartTerminal()}
              >
                {tr("status.resetTerm")}
              </button>
            </div>
          ) : preview.error ? (
            <div className="banner-inline">
              {tr("status.previewFailed", { error: preview.error })}
              <span className="hint">
                {" "}
                {tr("error.next.preview")}
              </span>
            </div>
          ) : (
            <>
              {preview.loading ? (
                <span className="preview-loading-chip">{tr("status.previewLoading")}</span>
              ) : null}
              <span
                className={`chip-tag ${selectionLabel ? "" : "muted"} ${preview.selectionStale ? "stale" : ""}`}
                title={
                  preview.selectionStale
                    ? tr("status.staleTargetTitle")
                    : undefined
                }
              >
                {selectionLabel || tr("status.noTarget")}
                {preview.selectionStale ? tr("status.priorPage") : ""}
              </span>
              {receipt ? (
                <details className="capture-receipt">
                  <summary
                    className="chip-shot"
                    title={receipt.screenshotPath || tr("status.lastCapture")}
                  >
                    {tr("status.lastCapture")}
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
                        <strong>{tr("status.receipt")}</strong>
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
                      <dt>{tr("status.receiptTarget")}</dt>
                      <dd title={receipt.target}>{receipt.target}</dd>
                      <dt>{tr("status.receiptPage")}</dt>
                      <dd title={receipt.pageUrl || receipt.pageTitle}>
                        {shortPath(
                          receipt.pageTitle || receipt.pageUrl || tr("status.unknownPage"),
                          58,
                        )}
                      </dd>
                      <dt>{tr("status.receiptFrame")}</dt>
                      <dd title={receipt.screenshotPath || undefined}>
                        {receipt.screenshotPath
                          ? shortPath(receipt.screenshotPath, 58)
                          : tr("status.noImagePath")}
                      </dd>
                      <dt>{tr("status.receiptMode")}</dt>
                      <dd>
                        {receipt.mode === "viewport"
                          ? tr("status.fullViewport")
                          : tr("status.targetContext")}
                      </dd>
                      <dt>{tr("status.receiptDelivery")}</dt>
                      <dd className="receipt-delivery">{receipt.delivery}</dd>
                    </dl>
                    <div className="receipt-actions">
                      <button
                        type="button"
                        className="link-btn"
                        onClick={() => void onOpenCaptureFolder()}
                      >
                        {tr("status.openFrames")}
                      </button>
                      <button
                        type="button"
                        className="link-btn danger"
                        onClick={() => void onClear()}
                      >
                        {tr("status.clearCapture")}
                      </button>
                    </div>
                  </div>
                </details>
              ) : screenshotPath ? (
                <span className="chip-shot" title={screenshotPath}>
                  {tr("status.frameChip")}
                </span>
              ) : null}
              <span
                className={`term-pill ${terminalAlive ? "on" : "off"}`}
                title={
                  terminalAlive
                    ? tr("status.shellOnTitle")
                    : tr("status.shellOffTitle")
                }
              >
                {terminalAlive ? tr("status.shellOn") : tr("status.shellOff")}
              </span>
              <span
                className={`term-pill grok ${grokState}`}
                title={
                  grokState === "ready"
                    ? tr("status.grokReadyTitle")
                    : grokState === "launch-requested"
                      ? tr("status.grokRequestedTitle")
                      : tr("status.grokUnknownTitle")
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
                  : tr("status.chooseFolder")}
              </span>
              <div className="chip-actions">
                <button
                  type="button"
                  className="link-btn"
                  onClick={() => void onRestartTerminal()}
                  aria-label={tr("status.resetTermAria")}
                >
                  {tr("status.resetTerm")}
                </button>
              </div>
            </>
          )}
        </div>
      </header>

      <div className={`workspace ${previewCollapsed ? "is-preview-collapsed" : ""}`}>
        <section
          id="terminal-pane"
          className={`terminal-pane ${previewCollapsed ? "is-full" : ""}`}
          style={terminalPaneStyle}
          aria-label={tr("pane.terminalAria")}
        >
          <div className="term-chrome">
            <div className="term-tabs" role="tablist" aria-label={tr("term.tabsAria")}>
              {(termTabs.length
                ? termTabs
                : activeTermId
                  ? [
                      {
                        id: activeTermId,
                        cwd: projectCwd,
                        label: projectCwd
                          ? projectCwd.split(/[/\\]/).pop() || "Terminal"
                          : "Terminal",
                      },
                    ]
                  : []
              ).map((tab) => {
                const selected = tab.id === activeTermId;
                return (
                  <div
                    key={tab.id}
                    className={`term-tab ${selected ? "active" : ""} ${tab.grokRunning ? "grok" : ""}`}
                    role="tab"
                    aria-selected={selected}
                    title={tab.cwd || tab.label}
                  >
                    <button
                      type="button"
                      className="term-tab-main"
                      onClick={() => void onSelectTerminal(tab.id)}
                    >
                      <span className="term-tab-label">
                        {tab.displayLabel || tab.label || "Terminal"}
                      </span>
                      {tab.grokRunning ? (
                        <span className="term-tab-badge">Grok</span>
                      ) : null}
                    </button>
                    {termTabs.length > 1 ? (
                      <button
                        type="button"
                        className="term-tab-close"
                        title={
                          tab.grokRunning
                            ? tr("term.closeGrokTitle")
                            : tr("term.closeTitle")
                        }
                        aria-label={tr("term.closeAria", {
                          name: tab.displayLabel || tab.label,
                        })}
                        onClick={(e) => {
                          e.stopPropagation();
                          void onCloseTerminal(tab.id);
                        }}
                      >
                        ×
                      </button>
                    ) : null}
                  </div>
                );
              })}
              <button
                type="button"
                className="term-tab-add"
                onClick={() => void onNewTerminal()}
                disabled={termTabs.length >= maxTermSessions}
                title={tr("term.addTitle")}
                aria-label={tr("term.addAria")}
              >
                +
              </button>
            </div>
            {terminalScopedActions}
            <span className="term-tabs-hint" title={tr("term.deliverHint")}>
              {tr("term.activeHint", { tab: activeTabLabel })}
            </span>
          </div>
          <div className="terminal-body terminal-body-full">
            {termTabs.length === 0 && activeTermId ? (
              <TerminalPane
                sessionId={activeTermId}
                active
                focusNonce={termFocusNonce}
                fitNonce={termFitNonce}
              />
            ) : null}
            {termTabs.map((tab) => (
              <div
                key={tab.id}
                className={`terminal-stack ${tab.id === activeTermId ? "is-active" : "is-hidden"}`}
                hidden={tab.id !== activeTermId}
              >
                <TerminalPane
                  sessionId={tab.id}
                  active={tab.id === activeTermId}
                  focusNonce={
                    tab.id === activeTermId ? termFocusNonce : 0
                  }
                  fitNonce={tab.id === activeTermId ? termFitNonce : 0}
                />
              </div>
            ))}
          </div>
        </section>

        {!previewCollapsed ? (
          <>
            <div
              className="splitter"
              onMouseDown={onSplitterDown}
              onKeyDown={onSplitterKeyDown}
              tabIndex={0}
              title={tr("pane.splitterTitle")}
              role="separator"
              aria-orientation="vertical"
              aria-label={tr("pane.splitterAria")}
              aria-controls="terminal-pane preview-pane"
              aria-valuemin={MIN_TERMINAL_WIDTH}
              aria-valuemax={maxTerminalWidth}
              aria-valuenow={Math.round(terminalWidth)}
              aria-valuetext={tr("pane.splitterValue", {
                percent: splitPercent,
              })}
            />

            <section
              id="preview-pane"
              className="preview-pane"
              aria-label={tr("pane.previewAria")}
            >
              <div
                className="preview-chrome"
                role="region"
                aria-label={tr("pane.previewChromeAria")}
              >
                <span className="preview-chrome-label">{tr("pane.preview")}</span>
                {urlNavForm}
                {previewScopedActions}
                <button
                  type="button"
                  className="icon-btn preview-collapse-btn"
                  onClick={() => void applyPreviewCollapsed(true)}
                  title={tr("pane.collapseTitle")}
                  aria-label={tr("pane.collapseAria")}
                >
                  <IconPanelCollapse />
                </button>
              </div>
              <div className="preview-area" aria-hidden />
            </section>
          </>
        ) : null}
      </div>
    </div>
  );
}
