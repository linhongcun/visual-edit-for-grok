import {
  useCallback,
  useEffect,
  useRef,
  useState,
  type FormEvent,
  type KeyboardEvent as ReactKeyboardEvent,
  type MouseEvent as ReactMouseEvent,
} from "react";
import TerminalPane, {
  type TerminalSearchApi,
} from "./components/TerminalPane";
import TerminalFindBar from "./components/TerminalFindBar";
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
import {
  clampTermFontSize,
  nextTermFontSize,
  TERM_FONT_SIZE_DEFAULT,
  TERM_SCROLLBACK_DEFAULT,
} from "./term-settings.cjs";
import {
  shouldShowUrlClear,
  filterRecentUrls,
  filterPaletteItems,
  resolveEscapeAction,
  resolveFocusedChromeEscape,
  normalizeUrlInputValue,
  resolveUrlKeyAction,
  resolvePaletteKeyAction,
  clampPaletteIndex,
} from "./input-chrome.cjs";
import type {
  CaptureResult,
  ElementSelection,
  FrameMode,
  GrokRuntimeState,
  PreviewStatus,
  TerminalStatus,
  ViewportOrientation,
  ViewportPreset,
  ViewportPresetId,
  VerifyPair,
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
const MIN_PREVIEW_WIDTH = 600;
const SPLITTER_WIDTH = 5;
const DEFAULT_VIEWPORT_PRESETS: ViewportPreset[] = [
  { id: "fit", label: "Fit", width: null, height: null, mobile: false },
  { id: "desktop", label: "1440 × 900", width: 1440, height: 900, mobile: false },
  { id: "laptop", label: "1024 × 768", width: 1024, height: 768, mobile: false },
  { id: "tablet", label: "768 × 1024", width: 768, height: 1024, mobile: true },
  { id: "phone390", label: "390 × 844", width: 390, height: 844, mobile: true },
  { id: "phone375", label: "375 × 812", width: 375, height: 812, mobile: true },
];

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

function localizedVerificationSummary(
  pair: VerifyPair,
  locale: Locale,
): string[] {
  const comparison = pair.comparison;
  if (!comparison) return [];
  if (!comparison.targetFound) return [t(locale, "verify.targetMissing")];
  const rows: string[] = [];
  if (comparison.geometryChanged && comparison.geometryDelta) {
    const signed = (value = 0) => `${value >= 0 ? "+" : ""}${value}`;
    rows.push(
      t(locale, "verify.geometry", {
        x: signed(comparison.geometryDelta.left),
        y: signed(comparison.geometryDelta.top),
        width: signed(comparison.geometryDelta.width),
        height: signed(comparison.geometryDelta.height),
      }),
    );
  }
  if (comparison.textChanged) rows.push(t(locale, "verify.textChanged"));
  if (comparison.identityChanged) rows.push(t(locale, "verify.identityChanged"));
  if (comparison.attributeChanges?.length) {
    rows.push(
      t(locale, "verify.attributesChanged", {
        names: comparison.attributeChanges.join(", "),
      }),
    );
  }
  if (comparison.styleChanges?.length) {
    rows.push(
      t(locale, "verify.stylesChanged", {
        names: comparison.styleChanges.map((item) => item.property).join(", "),
      }),
    );
  }
  return rows.length ? rows : [t(locale, "verify.noTrackedChangeDetail")];
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
    previewUrl?: string;
    viewportPreset?: ViewportPresetId;
    viewportOrientation?: ViewportOrientation;
    lastSelection?: ElementSelection | null;
    lastScreenshotPath?: string | null;
    verifyPair?: VerifyPair | null;
  };
  const [termTabs, setTermTabs] = useState<TermTab[]>([]);
  const [activeTermId, setActiveTermId] = useState<string | null>(null);
  const activeTermIdRef = useRef<string | null>(null);
  const [maxTermSessions, setMaxTermSessions] = useState(6);
  const [frameMode, setFrameMode] = useState<FrameMode>("viewport");
  const [viewportPresets, setViewportPresets] = useState<ViewportPreset[]>(
    DEFAULT_VIEWPORT_PRESETS,
  );
  const [viewportPreset, setViewportPreset] =
    useState<ViewportPresetId>("fit");
  const [viewportOrientation, setViewportOrientation] =
    useState<ViewportOrientation>("portrait");
  const [privateMode, setPrivateMode] = useState(false);
  const [receipt, setReceipt] = useState<CaptureReceipt | null>(null);
  const [receiptThumbnail, setReceiptThumbnail] = useState<string | null>(null);
  const [verifyPair, setVerifyPair] = useState<VerifyPair | null>(null);
  const [verifyThumbnails, setVerifyThumbnails] = useState<{
    before: string | null;
    after: string | null;
  }>({ before: null, after: null });
  const [termFocusNonce, setTermFocusNonce] = useState(0);
  /** Bump after splitter settle so xterm re-fits and PTY gets new cols (wide tables). */
  const [termFitNonce, setTermFitNonce] = useState(0);
  const [locale, setLocale] = useState<Locale>(() => detectBrowserLocale());
  const localeRef = useRef(locale);
  const dragging = useRef(false);

  // Terminal host prefs (Warp-inspired Wave A/B)
  const [termFontSize, setTermFontSize] = useState(TERM_FONT_SIZE_DEFAULT);
  const [linkTooltip, setLinkTooltip] = useState(true);
  const [copyOnSelect, setCopyOnSelect] = useState(false);
  const [termScrollback, setTermScrollback] = useState(TERM_SCROLLBACK_DEFAULT);
  const [notifyOnGrokExit, setNotifyOnGrokExit] = useState(true);
  const [notifyOnLongTask, setNotifyOnLongTask] = useState(true);
  const [longTaskNotifyThresholdSec, setLongTaskNotifyThresholdSec] =
    useState(30);
  const [findOpen, setFindOpen] = useState(false);
  const [findQuery, setFindQuery] = useState("");
  const [findCaseSensitive, setFindCaseSensitive] = useState(false);
  const [findResultIndex, setFindResultIndex] = useState(-1);
  const [findResultCount, setFindResultCount] = useState(0);
  const [settingsOpen, setSettingsOpen] = useState(false);
  const [paletteOpen, setPaletteOpen] = useState(false);
  const [shortcutsOpen, setShortcutsOpen] = useState(false);
  const [paletteQuery, setPaletteQuery] = useState("");
  const [paletteIndex, setPaletteIndex] = useState(0);
  const [urlFocused, setUrlFocused] = useState(false);
  const [renamingTabId, setRenamingTabId] = useState<string | null>(null);
  const [renameDraft, setRenameDraft] = useState("");
  const [dragTabId, setDragTabId] = useState<string | null>(null);
  const searchApisRef = useRef(new Map<string, TerminalSearchApi>());
  const findQueryRef = useRef(findQuery);
  const findCaseRef = useRef(findCaseSensitive);
  const findOpenRef = useRef(findOpen);
  const paletteOpenRef = useRef(paletteOpen);
  const settingsOpenRef = useRef(settingsOpen);
  const shortcutsOpenRef = useRef(shortcutsOpen);
  const closeFindBarRef = useRef(() => {});
  const focusGrokTerminalRef = useRef(() => {});

  function requestTerminalFit() {
    setTermFitNonce((n) => n + 1);
  }

  /**
   * After maximize / collapse / layout:bounds, React width may not be painted yet.
   * Re-fit xterm + PTY on several frames so Grok reflows to the full pane width
   * (avoids half-screen black void after ⌘⇧M).
   */
  function scheduleTerminalFitAfterLayout() {
    requestTerminalFit();
    requestAnimationFrame(() => {
      requestTerminalFit();
      requestAnimationFrame(() => requestTerminalFit());
    });
    window.setTimeout(() => requestTerminalFit(), 48);
    window.setTimeout(() => requestTerminalFit(), 120);
    window.setTimeout(() => requestTerminalFit(), 280);
  }

  const lastLayoutWidthRef = useRef<number | null>(null);
  const lastLayoutCollapsedRef = useRef<boolean | null>(null);
  const selectionRef = useRef<ElementSelection | null>(null);
  const screenshotPathRef = useRef<string | null>(null);
  const previewRef = useRef(preview);
  const frameModeRef = useRef(frameMode);
  const pickModeRef = useRef(pickMode);
  const lastLaunchAtRef = useRef(0);
  const togglePickRef = useRef(async () => {});
  const onScreenshotRef = useRef(async () => {});
  const onResendRef = useRef(async () => {});
  const handleMenuActionRef = useRef<(action: string) => void>(() => {});
  const applyTermHostSettingsRef = useRef<
    (s: {
      termFontSize?: number;
      linkTooltip?: boolean;
      copyOnSelect?: boolean;
      termScrollback?: number;
      notifyOnGrokExit?: boolean;
    }) => void
  >(() => {});

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

  useEffect(() => {
    findQueryRef.current = findQuery;
  }, [findQuery]);

  useEffect(() => {
    findCaseRef.current = findCaseSensitive;
  }, [findCaseSensitive]);

  useEffect(() => {
    findOpenRef.current = findOpen;
  }, [findOpen]);

  useEffect(() => {
    paletteOpenRef.current = paletteOpen;
  }, [paletteOpen]);

  useEffect(() => {
    settingsOpenRef.current = settingsOpen;
  }, [settingsOpen]);

  useEffect(() => {
    shortcutsOpenRef.current = shortcutsOpen;
  }, [shortcutsOpen]);

  function registerSearchApi(sessionId: string, api: TerminalSearchApi | null) {
    if (api) searchApisRef.current.set(sessionId, api);
    else searchApisRef.current.delete(sessionId);
  }

  function activeSearchApi(): TerminalSearchApi | null {
    const id = activeTermIdRef.current;
    if (!id) return null;
    return searchApisRef.current.get(id) || null;
  }

  function runFind(direction: "next" | "prev", query = findQueryRef.current) {
    const api = activeSearchApi();
    if (!api) return;
    const q = query.trim();
    if (!q) {
      api.clearDecorations();
      setFindResultIndex(-1);
      setFindResultCount(0);
      return;
    }
    const opts = { caseSensitive: findCaseRef.current };
    if (direction === "prev") api.findPrevious(q, opts);
    else api.findNext(q, { ...opts, incremental: true });
  }

  function openFindBar() {
    setFindOpen(true);
    // Re-run on current selection if any text selected in terminal is hard;
    // just focus the bar.
  }

  function closeFindBar() {
    setFindOpen(false);
    activeSearchApi()?.clearDecorations();
    setFindResultIndex(-1);
    setFindResultCount(0);
    focusGrokTerminal();
  }

  useEffect(() => {
    closeFindBarRef.current = closeFindBar;
  });

  useEffect(() => {
    focusGrokTerminalRef.current = focusGrokTerminal;
  });

  async function persistTermSettings(
    partial: Partial<{
      termFontSize: number;
      linkTooltip: boolean;
      copyOnSelect: boolean;
      termScrollback: number;
      notifyOnGrokExit: boolean;
      notifyOnLongTask: boolean;
      longTaskNotifyThresholdSec: number;
    }>,
  ) {
    if (!isElectron()) return;
    try {
      const next = await window.vefg.setTermSettings(partial);
      applyTermHostSettings(next);
    } catch (err) {
      toastError(err);
    }
  }

  function applyTermHostSettings(s: {
    termFontSize?: number;
    linkTooltip?: boolean;
    copyOnSelect?: boolean;
    termScrollback?: number;
    notifyOnGrokExit?: boolean;
    notifyOnLongTask?: boolean;
    longTaskNotifyThresholdSec?: number;
  }) {
    if (typeof s.termFontSize === "number") {
      setTermFontSize(clampTermFontSize(s.termFontSize));
    }
    if (typeof s.linkTooltip === "boolean") setLinkTooltip(s.linkTooltip);
    if (typeof s.copyOnSelect === "boolean") setCopyOnSelect(s.copyOnSelect);
    if (typeof s.termScrollback === "number") {
      setTermScrollback(s.termScrollback);
    }
    if (typeof s.notifyOnGrokExit === "boolean") {
      setNotifyOnGrokExit(s.notifyOnGrokExit);
    }
    if (typeof s.notifyOnLongTask === "boolean") {
      setNotifyOnLongTask(s.notifyOnLongTask);
    }
    if (typeof s.longTaskNotifyThresholdSec === "number") {
      setLongTaskNotifyThresholdSec(s.longTaskNotifyThresholdSec);
    }
  }

  function changeFont(delta: 1 | -1 | 0) {
    const next = nextTermFontSize(termFontSize, delta);
    setTermFontSize(next);
    void persistTermSettings({ termFontSize: next });
    showToast(tr("toast.fontSize", { size: String(next) }));
  }

  function handleMenuAction(action: string) {
    switch (action) {
      case "find":
        openFindBar();
        break;
      case "find-next":
        if (!findOpenRef.current) openFindBar();
        runFind("next");
        break;
      case "find-prev":
        if (!findOpenRef.current) openFindBar();
        runFind("prev");
        break;
      case "new-tab":
        void onNewTerminal();
        break;
      case "close-tab":
        if (activeTermIdRef.current) void onCloseTerminal(activeTermIdRef.current);
        break;
      case "focus-terminal":
        focusGrokTerminal();
        break;
      case "focus-preview":
        document.getElementById("preview-url-input")?.focus();
        break;
      case "font-larger":
        changeFont(1);
        break;
      case "font-smaller":
        changeFont(-1);
        break;
      case "font-reset":
        changeFont(0);
        break;
      case "toggle-preview":
        void applyPreviewCollapsed(!previewCollapsedRef.current);
        break;
      case "maximize-terminal":
        void applyLayoutMaximize("toggle-terminal");
        break;
      case "maximize-preview":
        void applyLayoutMaximize("toggle-preview");
        break;
      case "aim":
        void togglePickRef.current();
        break;
      case "frame":
        void onScreenshotRef.current();
        break;
      case "resend":
        void onResendRef.current();
        break;
      case "settings":
        setSettingsOpen(true);
        setPaletteOpen(false);
        setShortcutsOpen(false);
        break;
      case "palette":
        setPaletteOpen(true);
        setPaletteQuery("");
        setPaletteIndex(0);
        setSettingsOpen(false);
        setShortcutsOpen(false);
        break;
      case "shortcuts":
        setShortcutsOpen(true);
        setSettingsOpen(false);
        setPaletteOpen(false);
        break;
      case "terminal-select-all": {
        // Grok Cmd+A: Kitty Super+A (same as host key encoder)
        const active = activeTermIdRef.current;
        if (active && window.vefg) {
          void window.vefg.terminalWrite({
            data: "\x1b[97;9u",
            sessionId: active,
          });
          focusGrokTerminal();
        }
        break;
      }
      default:
        break;
    }
  }

  useEffect(() => {
    handleMenuActionRef.current = handleMenuAction;
  });

  useEffect(() => {
    applyTermHostSettingsRef.current = applyTermHostSettings;
  });

  // Subscribe search results for the active tab when find is open
  useEffect(() => {
    if (!findOpen || !activeTermId) return;
    const api = searchApisRef.current.get(activeTermId);
    if (!api) return;
    return api.onResults(({ resultIndex, resultCount }) => {
      setFindResultIndex(resultIndex);
      setFindResultCount(resultCount);
    });
  }, [findOpen, activeTermId, termTabs.length]);

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

  useEffect(() => {
    const beforePath = verifyPair?.before?.screenshotPath;
    const afterPath = verifyPair?.after?.screenshotPath;
    if (!isElectron() || (!beforePath && !afterPath)) {
      setVerifyThumbnails({ before: null, after: null });
      return;
    }
    let canceled = false;
    void Promise.all([
      beforePath
        ? window.vefg.captureThumbnail(beforePath)
        : Promise.resolve({ dataUrl: null }),
      afterPath
        ? window.vefg.captureThumbnail(afterPath)
        : Promise.resolve({ dataUrl: null }),
    ])
      .then(([before, after]) => {
        if (!canceled) {
          setVerifyThumbnails({
            before: before.dataUrl,
            after: after.dataUrl,
          });
        }
      })
      .catch(() => {
        if (!canceled) setVerifyThumbnails({ before: null, after: null });
      });
    return () => {
      canceled = true;
    };
  }, [
    verifyPair?.before?.screenshotPath,
    verifyPair?.after?.screenshotPath,
  ]);

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
      if (status.grokRunning === false) {
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
        setVerifyPair(s.lastVerifyPair || null);
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
        setViewportPresets(s.viewportPresets || DEFAULT_VIEWPORT_PRESETS);
        setViewportPreset(s.viewportPreset || "fit");
        setViewportOrientation(s.viewportOrientation || "portrait");
        setPrivateMode(Boolean(s.privateMode ?? s.previewStatus?.privateMode));
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
        applyTermHostSettings({
          termFontSize: s.termFontSize,
          linkTooltip: s.linkTooltip,
          copyOnSelect: s.copyOnSelect,
          termScrollback: s.termScrollback,
          notifyOnGrokExit: s.notifyOnGrokExit,
          notifyOnLongTask: s.notifyOnLongTask,
          longTaskNotifyThresholdSec: s.longTaskNotifyThresholdSec,
        });

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
        if (next.viewportPreset) setViewportPreset(next.viewportPreset);
        if (next.viewportOrientation) {
          setViewportOrientation(next.viewportOrientation);
        }
        if (typeof next.privateMode === "boolean") {
          setPrivateMode(next.privateMode);
        }
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
          contentWidth?: number;
        };
        let layoutChanged = false;
        if (typeof b.previewCollapsed === "boolean") {
          if (lastLayoutCollapsedRef.current !== b.previewCollapsed) {
            layoutChanged = true;
            lastLayoutCollapsedRef.current = b.previewCollapsed;
          }
          setPreviewCollapsed(b.previewCollapsed);
          previewCollapsedRef.current = b.previewCollapsed;
        }
        if (!dragging.current && b.terminalWidth) {
          if (lastLayoutWidthRef.current !== b.terminalWidth) {
            layoutChanged = true;
            lastLayoutWidthRef.current = b.terminalWidth;
          }
          setTerminalWidth(b.terminalWidth);
        }
        // Window resize / maximize from main: reflow xterm + Grok cols
        if (layoutChanged && !dragging.current) {
          scheduleTerminalFitAfterLayout();
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
        if (r.kind === "workspace") {
          const targetId = r.targetSessionId || null;
          if (targetId) {
            setActiveTermId(targetId);
            activeTermIdRef.current = targetId;
          }
          const workspaceSelection = r.selection ?? null;
          const workspacePath =
            r.screenshotPath ?? r.captureMeta?.screenshotPath ?? null;
          setSelection(workspaceSelection);
          selectionRef.current = workspaceSelection;
          setScreenshotPath(workspacePath);
          screenshotPathRef.current = workspacePath;
          setVerifyPair(r.verifyPair || null);
          if (r.viewportPreset) setViewportPreset(r.viewportPreset);
          if (r.viewportOrientation) {
            setViewportOrientation(r.viewportOrientation);
          }
          if (typeof r.previewUrl === "string") {
            setUrlInput(r.previewUrl);
          }
          setReceipt(
            workspaceSelection || workspacePath || r.captureMeta
              ? makeReceipt(r, workspaceSelection, workspacePath)
              : null,
          );
          return;
        }
        if (
          r.targetSessionId &&
          r.targetSessionId !== activeTermIdRef.current
        ) {
          return;
        }
        if (r.kind === "error") {
          showToast(
            r.message ||
              t(localeRef.current, "error.captureFailed") +
                " " +
                t(localeRef.current, "error.next.capture"),
          );
          return;
        }
        if (r.kind === "verify") {
          setVerifyPair(r.verifyPair || null);
          showToast(t(localeRef.current, "verify.complete"));
          return;
        }
        if (r.kind === "verify-deliver") {
          setVerifyPair(r.verifyPair || null);
          applyTerminalRuntime(r);
          showToast(t(localeRef.current, "verify.sent"));
          return;
        }
        if (r.kind === "selection" || r.kind === "screenshot") {
          setVerifyPair(null);
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
          r.screenshotPath ??
          r.path ??
          r.captureMeta?.screenshotPath ??
          screenshotPathRef.current ??
          null;
        if (
          r.screenshotPath !== undefined ||
          r.path !== undefined ||
          r.captureMeta?.screenshotPath !== undefined
        ) {
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

    // Global Esc: Aim first, then stacked chrome surfaces (find/palette/settings/URL)
    const onKey = (e: KeyboardEvent) => {
      if (e.key === "Escape") {
        const urlEl = document.getElementById(
          "preview-url-input",
        ) as HTMLInputElement | null;
        const urlFocusedNow =
          Boolean(urlEl) && document.activeElement === urlEl;
        const action = resolveEscapeAction({
          pickMode: pickModeRef.current,
          findOpen: findOpenRef.current,
          paletteOpen: paletteOpenRef.current,
          settingsOpen: settingsOpenRef.current,
          shortcutsOpen: shortcutsOpenRef.current,
          urlFocused: urlFocusedNow,
        });
        if (action !== "none") {
          e.preventDefault();
          if (action === "aim-cancel") {
            void api.setPickMode(false);
          } else if (action === "close-find") {
            closeFindBarRef.current();
          } else if (action === "close-palette") {
            setPaletteOpen(false);
            focusGrokTerminalRef.current();
          } else if (action === "close-settings") {
            setSettingsOpen(false);
          } else if (action === "close-shortcuts") {
            setShortcutsOpen(false);
          } else if (action === "blur-url") {
            urlEl?.blur();
            focusGrokTerminalRef.current();
          }
          return;
        }
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

    const offMenu = api.on("app:menu-action", (payload) => {
      const action = String(
        (payload as { action?: string })?.action || "",
      ).toLowerCase();
      handleMenuActionRef.current?.(action);
    });
    offs.push(offMenu);

    const offTermSettings = api.on("app:term-settings", (payload) => {
      applyTermHostSettingsRef.current?.(
        payload as {
          termFontSize?: number;
          linkTooltip?: boolean;
          copyOnSelect?: boolean;
          termScrollback?: number;
          notifyOnGrokExit?: boolean;
          notifyOnLongTask?: boolean;
          longTaskNotifyThresholdSec?: number;
        },
      );
    });
    offs.push(offTermSettings);

    return () => {
      offs.forEach((off) => off());
      window.removeEventListener("keydown", onKey);
    };
  }, []);

  /**
   * Load a URL in the right-hand preview (toolbar Go, or click link in TUI).
   * Expands the preview pane when it was collapsed.
   */
  async function openPreviewUrl(
    rawUrl: string,
    opts: { fromTerminal?: boolean } = {},
  ) {
    if (!isElectron()) return;
    let url = rawUrl.trim();
    if (!url) return;
    if (!/^https?:\/\//i.test(url)) url = `http://${url}`;
    try {
      // Validate before navigating
      // eslint-disable-next-line no-new
      new URL(url);
    } catch {
      showToast(tr("toast.navFailed", { error: url }));
      return;
    }
    if (previewCollapsedRef.current) {
      await applyPreviewCollapsed(false);
    }
    setUrlInput(url);
    if (!privateMode) {
      setRecentPreviewUrls((current) =>
        [url, ...current.filter((item) => item !== url)].slice(0, 8),
      );
    }
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
      if (opts.fromTerminal) {
        showToast(
          tr("toast.previewFromTerminal", {
            url: shortPath(url, 56),
          }),
        );
      }
    } catch (err) {
      const message = err instanceof Error ? err.message : String(err);
      setPreview((current) => ({ ...current, loading: false, error: message }));
      showToast(tr("toast.navFailed", { error: message }));
    }
  }

  async function onNavigate(e?: FormEvent) {
    e?.preventDefault();
    await openPreviewUrl(urlInput);
  }

  async function applyPreviewCollapsed(collapsed: boolean) {
    if (!isElectron()) {
      setPreviewCollapsed(collapsed);
      previewCollapsedRef.current = collapsed;
      lastLayoutCollapsedRef.current = collapsed;
      scheduleTerminalFitAfterLayout();
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
      lastLayoutCollapsedRef.current = previewCollapsedRef.current;
      if (bounds.terminalWidth) {
        setTerminalWidth(bounds.terminalWidth);
        lastLayoutWidthRef.current = bounds.terminalWidth;
      }
      scheduleTerminalFitAfterLayout();
    } catch (err) {
      toastError(err);
    }
  }

  /** Wave-style maximize: expand terminal or preview; toggle again restores. */
  async function applyLayoutMaximize(
    action:
      | "terminal"
      | "preview"
      | "toggle-terminal"
      | "toggle-preview"
      | "none",
  ) {
    if (!isElectron() || !window.vefg.layoutMaximize) return;
    try {
      const bounds = await window.vefg.layoutMaximize(action);
      if (typeof bounds.previewCollapsed === "boolean") {
        setPreviewCollapsed(bounds.previewCollapsed);
        previewCollapsedRef.current = bounds.previewCollapsed;
        lastLayoutCollapsedRef.current = bounds.previewCollapsed;
      }
      if (bounds.terminalWidth) {
        setTerminalWidth(bounds.terminalWidth);
        lastLayoutWidthRef.current = bounds.terminalWidth;
      }
      // Multi-frame fit: React width + xterm host measure after maximize
      scheduleTerminalFitAfterLayout();
    } catch (err) {
      toastError(err);
    }
  }

  async function ensurePreviewExpanded() {
    if (!previewCollapsedRef.current) return;
    await applyPreviewCollapsed(false);
  }

  async function onViewportChange(
    presetId: ViewportPresetId,
    orientation: ViewportOrientation = viewportOrientation,
  ) {
    setViewportPreset(presetId);
    setViewportOrientation(orientation);
    if (!isElectron()) return;
    try {
      const status = await window.vefg.setViewport({ presetId, orientation });
      setPreview((current) => ({ ...current, ...status }));
    } catch (err) {
      toastError(err);
    }
  }

  async function onTogglePrivateMode() {
    if (!isElectron() || captureBusy) return;
    try {
      const status = await window.vefg.setPrivateMode(!privateMode);
      setPrivateMode(Boolean(status.privateMode));
      setPreview((current) => ({ ...current, ...status }));
      showToast(
        status.privateMode
          ? tr("privacy.privateOnToast")
          : tr("privacy.privateOffToast"),
      );
    } catch (err) {
      toastError(err);
    }
  }

  async function onClearPreviewData() {
    if (!isElectron()) return;
    if (!window.confirm(tr("privacy.clearConfirm"))) return;
    try {
      await window.vefg.clearPreviewData("all");
      showToast(tr("privacy.cleared"));
    } catch (err) {
      toastError(err);
    }
  }

  async function onCopyDiagnostics() {
    if (!isElectron()) return;
    try {
      await window.vefg.copyDiagnostics();
      showToast(tr("diagnostics.copied"));
    } catch (err) {
      toastError(err);
    }
  }

  async function onCheckUpdates() {
    if (!isElectron()) return;
    try {
      await window.vefg.checkUpdates();
      showToast(tr("updates.opened"));
    } catch (err) {
      toastError(err);
    }
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
      await window.vefg.deliver();
    } catch (err) {
      toastError(err);
    } finally {
      captureBusyRef.current = false;
      setCaptureBusy(false);
    }
  }
  onResendRef.current = onResend;

  async function onVerify() {
    if (!isElectron() || captureBusyRef.current || captureBusy) return;
    if (!selection?.selector || !screenshotPath) {
      showToast(tr("verify.needsAim"));
      return;
    }
    await ensurePreviewExpanded();
    captureBusyRef.current = true;
    setCaptureBusy(true);
    try {
      const result = await window.vefg.verify();
      setVerifyPair(result.verifyPair || null);
    } catch (err) {
      toastError(err);
    } finally {
      captureBusyRef.current = false;
      setCaptureBusy(false);
    }
  }

  async function onDeliverVerification() {
    if (!isElectron() || captureBusyRef.current || captureBusy || !verifyPair) {
      return;
    }
    captureBusyRef.current = true;
    setCaptureBusy(true);
    try {
      await window.vefg.deliverVerification();
    } catch (err) {
      toastError(err);
    } finally {
      captureBusyRef.current = false;
      setCaptureBusy(false);
    }
  }

  async function onClear() {
    if (!isElectron()) return;
    await window.vefg.clearCapture();
    setSelection(null);
    selectionRef.current = null;
    setScreenshotPath(null);
    screenshotPathRef.current = null;
    setReceipt(null);
    setReceiptThumbnail(null);
    setVerifyPair(null);
    setVerifyThumbnails({ before: null, after: null });
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
              scheduleTerminalFitAfterLayout();
            }
          })
          .catch(() => {
            // Keep the local split usable if the native view is closing.
          });
      } else if (force) {
        scheduleTerminalFitAfterLayout();
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
  const setupProgress = {
    folder: Boolean(projectCwd),
    grok: grokState === "launch-requested" || grokState === "ready",
    preview: previewCapturable,
    capture: hasCapture,
  };
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

  const filteredRecentUrls = filterRecentUrls(urlInput, recentPreviewUrls, {
    privateMode,
    limit: 8,
  });

  const paletteCommands = [
    {
      id: "find",
      label: tr("palette.find"),
      run: () => {
        setPaletteOpen(false);
        openFindBar();
      },
    },
    {
      id: "aim",
      label: tr("palette.aim"),
      run: () => {
        setPaletteOpen(false);
        void togglePickRef.current();
      },
    },
    {
      id: "frame",
      label: tr("palette.frame"),
      run: () => {
        setPaletteOpen(false);
        void onScreenshotRef.current();
      },
    },
    {
      id: "resend",
      label: tr("palette.resend"),
      run: () => {
        setPaletteOpen(false);
        void onResendRef.current();
      },
    },
    {
      id: "new-tab",
      label: tr("palette.newTab"),
      run: () => {
        setPaletteOpen(false);
        void onNewTerminal();
      },
    },
    {
      id: "settings",
      label: tr("palette.settings"),
      run: () => {
        setPaletteOpen(false);
        setSettingsOpen(true);
      },
    },
    {
      id: "shortcuts",
      label: tr("palette.shortcuts"),
      run: () => {
        setPaletteOpen(false);
        setShortcutsOpen(true);
      },
    },
    {
      id: "toggle-preview",
      label: tr("palette.togglePreview"),
      run: () => {
        setPaletteOpen(false);
        void applyPreviewCollapsed(!previewCollapsedRef.current);
      },
    },
  ];
  const paletteVisible = filterPaletteItems(paletteQuery, paletteCommands);
  const paletteHighlight = clampPaletteIndex(
    paletteIndex,
    paletteVisible.length,
  );

  /**
   * Palette keyboard handler — attach to the filter input ONLY (not the dialog).
   * Always stopPropagation on handled keys so Enter/arrows never fire twice.
   */
  function onPaletteKeyDown(e: ReactKeyboardEvent<HTMLElement>) {
    if (e.key === "Escape") {
      const action = resolveFocusedChromeEscape(
        "palette",
        pickModeRef.current,
      );
      e.preventDefault();
      e.stopPropagation();
      if (action === "aim-cancel") {
        void window.vefg?.setPickMode(false);
        return;
      }
      setPaletteOpen(false);
      focusGrokTerminal();
      return;
    }
    const action = resolvePaletteKeyAction(e, {
      index: paletteHighlight,
      itemCount: paletteVisible.length,
    });
    if (action.type === "move" && typeof action.index === "number") {
      e.preventDefault();
      e.stopPropagation();
      setPaletteIndex(action.index);
      return;
    }
    if (action.type === "run" && typeof action.index === "number") {
      e.preventDefault();
      e.stopPropagation();
      const item = paletteVisible[action.index];
      if (!item) return;
      const full = paletteCommands.find((c) => c.id === item.id);
      full?.run();
    }
  }

  const urlNavForm = (
    <form
      className={`url-form chrome-field ${preview.loading ? "loading" : ""} ${urlFocused ? "is-focused" : ""}`}
      onSubmit={(e) => {
        e.preventDefault();
        setUrlInput(normalizeUrlInputValue(urlInput));
        void onNavigate(e);
      }}
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
        id="preview-url-input"
        className="url-input"
        value={urlInput}
        list="recent-preview-urls"
        onChange={(e) => setUrlInput(e.target.value)}
        onFocus={() => setUrlFocused(true)}
        onBlur={() => setUrlFocused(false)}
        onKeyDown={(e) => {
          if (e.key === "Escape") {
            // Aim pickMode always wins over URL blur (do not swallow Esc).
            const action = resolveFocusedChromeEscape(
              "url",
              pickModeRef.current,
            );
            e.preventDefault();
            e.stopPropagation();
            if (action === "aim-cancel") {
              void window.vefg?.setPickMode(false);
              return;
            }
            (e.target as HTMLInputElement).blur();
            focusGrokTerminal();
            return;
          }
          // Enter submits; Shift+Enter does not invent multi-line URLs.
          const urlAction = resolveUrlKeyAction(e);
          if (urlAction === "submit") {
            // Allow form onSubmit to run (do not preventDefault).
            return;
          }
          if (e.key === "Enter" && e.shiftKey) {
            e.preventDefault();
          }
        }}
        placeholder={tr("nav.urlPlaceholder")}
        spellCheck={false}
        autoComplete="off"
        autoCorrect="off"
        autoCapitalize="off"
        enterKeyHint="go"
        aria-label={tr("nav.urlAria")}
        aria-autocomplete="list"
        aria-controls="recent-preview-urls"
      />
      <datalist id="recent-preview-urls">
        {filteredRecentUrls.map((url) => (
          <option value={url} key={url} />
        ))}
      </datalist>
      {shouldShowUrlClear(urlInput) && !preview.loading ? (
        <button
          type="button"
          className="icon-btn url-clear-btn"
          title={tr("nav.urlClear")}
          aria-label={tr("nav.urlClearAria")}
          onClick={() => {
            setUrlInput("");
            requestAnimationFrame(() => {
              document.getElementById("preview-url-input")?.focus();
            });
          }}
        >
          ×
        </button>
      ) : null}
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
        disabled={captureBusy}
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
          disabled={captureBusy}
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
        disabled={captureBusy}
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
      <select
        className="viewport-preset-select"
        value={viewportPreset}
        onChange={(event) =>
          void onViewportChange(event.target.value as ViewportPresetId)
        }
        disabled={captureBusy}
        aria-label={tr("actions.viewportAria")}
        title={tr("actions.viewportTitle")}
      >
        {viewportPresets.map((preset) => (
          <option value={preset.id} key={preset.id}>
            {preset.id === "fit" ? tr("actions.viewportFit") : preset.label}
          </option>
        ))}
      </select>
      {viewportPreset !== "fit" ? (
        <button
          type="button"
          className="btn btn-ghost btn-compact orientation-toggle"
          disabled={captureBusy}
          onClick={() =>
            void onViewportChange(
              viewportPreset,
              viewportOrientation === "portrait" ? "landscape" : "portrait",
            )
          }
          title={tr("actions.orientationTitle")}
          aria-label={tr("actions.orientationAria")}
        >
          {viewportOrientation === "portrait" ? "↕" : "↔"}
        </button>
      ) : null}
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
        <span className="action-label">
          {pickMode ? tr("actions.aiming") : tr("actions.aim")}
        </span>
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
          <span className="action-label">
            {captureBusy ? "…" : tr("actions.frame")}
          </span>
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
        <span className="action-label">{tr("actions.resend")}</span>
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

          <button
            type="button"
            className={`btn btn-ghost utility-action privacy-control ${privateMode ? "active" : ""}`}
            onClick={() => void onTogglePrivateMode()}
            disabled={captureBusy}
            aria-pressed={privateMode}
            title={tr("privacy.privateTitle")}
          >
            {privateMode ? tr("privacy.privateOn") : tr("privacy.privateOff")}
          </button>
          <button
            type="button"
            className="btn btn-ghost utility-action"
            onClick={() => void onClearPreviewData()}
            title={tr("privacy.clearTitle")}
          >
            {tr("privacy.clear")}
          </button>
          <button
            type="button"
            className="btn btn-ghost utility-action"
            onClick={() => void onCopyDiagnostics()}
            title={tr("diagnostics.title")}
          >
            {tr("diagnostics.action")}
          </button>
          <button
            type="button"
            className="btn btn-ghost utility-action"
            onClick={() => void onCheckUpdates()}
            title={tr("updates.title")}
          >
            {tr("updates.action")}
          </button>

          {/* Empty titlebar region: drag the window */}
          <div className="titlebar-drag-spacer" aria-hidden />

          <div
            className="toolbar-actions"
            role="group"
            aria-label={tr("actions.appChromeAria")}
          >
            <button
              type="button"
              className="btn btn-ghost"
              onClick={() => void applyLayoutMaximize("toggle-terminal")}
              title={tr("pane.maximizeTerminalTitle")}
              aria-label={tr("pane.maximizeTerminalAria")}
            >
              {tr("pane.maximizeTerminal")}
            </button>
            <button
              type="button"
              className="btn btn-ghost"
              onClick={() => void applyLayoutMaximize("toggle-preview")}
              title={tr("pane.maximizePreviewTitle")}
              aria-label={tr("pane.maximizePreviewAria")}
            >
              {tr("pane.maximizePreview")}
            </button>
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
              <span className={setupProgress.folder ? "done" : ""}>
                <b>{setupProgress.folder ? "✓" : "1"}</b> {tr("status.setup1")}
              </span>
              <span className={setupProgress.grok ? "done" : ""}>
                <b>{setupProgress.grok ? "✓" : "2"}</b> {tr("status.setup2")}
              </span>
              <span className={setupProgress.preview ? "done" : ""}>
                <b>{setupProgress.preview ? "✓" : "3"}</b> {tr("status.setup3")}
              </span>
              <span className={setupProgress.capture ? "done" : ""}>
                <b>{setupProgress.capture ? "✓" : "4"}</b> {tr("status.setup4")}
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
                disabled={captureBusy}
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
                    {verifyPair ? (
                      <section className="verify-card" aria-label={tr("verify.panel") }>
                        <div className="verify-heading">
                          <strong>{tr("verify.panel")}</strong>
                          <span
                            className={`verify-result ${
                              verifyPair.comparison?.changed ? "changed" : "unchanged"
                            }`}
                          >
                            {verifyPair.comparison?.changed
                              ? tr("verify.changed")
                              : tr("verify.noTrackedChange")}
                          </span>
                        </div>
                        <div className="verify-images">
                          <figure>
                            {verifyThumbnails.before ? (
                              <img src={verifyThumbnails.before} alt={tr("verify.before")} />
                            ) : (
                              <div className="verify-image-placeholder" />
                            )}
                            <figcaption>{tr("verify.before")}</figcaption>
                          </figure>
                          <figure>
                            {verifyThumbnails.after ? (
                              <img src={verifyThumbnails.after} alt={tr("verify.after")} />
                            ) : (
                              <div className="verify-image-placeholder" />
                            )}
                            <figcaption>{tr("verify.after")}</figcaption>
                          </figure>
                        </div>
                        <ul className="verify-summary">
                          {localizedVerificationSummary(verifyPair, locale).map((item) => (
                            <li key={item}>{item}</li>
                          ))}
                        </ul>
                        <button
                          type="button"
                          className="btn btn-primary verify-send"
                          disabled={captureBusy}
                          onClick={() => void onDeliverVerification()}
                        >
                          <IconSend />
                          {tr("verify.send")}
                        </button>
                      </section>
                    ) : null}
                    <div className="receipt-actions">
                      <button
                        type="button"
                        className="link-btn"
                        disabled={
                          captureBusy ||
                          preview.loading ||
                          !selection?.selector ||
                          !screenshotPath
                        }
                        onClick={() => void onVerify()}
                      >
                        {tr("verify.action")}
                      </button>
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
                  disabled={captureBusy}
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
                const isRenaming = renamingTabId === tab.id;
                return (
                  <div
                    key={tab.id}
                    className={`term-tab ${selected ? "active" : ""} ${tab.grokRunning ? "grok" : ""} ${dragTabId === tab.id ? "is-dragging" : ""}`}
                    role="tab"
                    aria-selected={selected}
                    title={
                      isRenaming
                        ? tr("term.renameHint")
                        : tab.cwd || tab.label
                    }
                    draggable={!isRenaming && termTabs.length > 1}
                    onDragStart={(e) => {
                      setDragTabId(tab.id);
                      e.dataTransfer.setData("text/plain", tab.id);
                      e.dataTransfer.effectAllowed = "move";
                    }}
                    onDragEnd={() => setDragTabId(null)}
                    onDragOver={(e) => {
                      if (!dragTabId || dragTabId === tab.id) return;
                      e.preventDefault();
                      e.dataTransfer.dropEffect = "move";
                    }}
                    onDrop={(e) => {
                      e.preventDefault();
                      const fromId =
                        e.dataTransfer.getData("text/plain") || dragTabId;
                      setDragTabId(null);
                      if (!fromId || fromId === tab.id) return;
                      const ids = termTabs.map((t) => t.id);
                      const from = ids.indexOf(fromId);
                      const to = ids.indexOf(tab.id);
                      if (from < 0 || to < 0) return;
                      const next = [...ids];
                      next.splice(from, 1);
                      next.splice(to, 0, fromId);
                      void window.vefg
                        .terminalReorder(next)
                        .then((res) => applyTerminalSessions(res))
                        .catch(toastError);
                    }}
                  >
                    {isRenaming ? (
                      <input
                        className="term-tab-rename"
                        value={renameDraft}
                        autoFocus
                        maxLength={48}
                        aria-label={tr("term.renameAria")}
                        onChange={(e) => setRenameDraft(e.target.value)}
                        onBlur={() => {
                          const next = renameDraft.trim();
                          setRenamingTabId(null);
                          if (!next || next === tab.label) return;
                          void window.vefg
                            .terminalRename(tab.id, next)
                            .then((res) => applyTerminalSessions(res))
                            .catch(toastError);
                        }}
                        onKeyDown={(e) => {
                          if (e.key === "Enter") {
                            e.preventDefault();
                            (e.target as HTMLInputElement).blur();
                          } else if (e.key === "Escape") {
                            e.preventDefault();
                            setRenamingTabId(null);
                          }
                        }}
                        onClick={(e) => e.stopPropagation()}
                      />
                    ) : (
                      <button
                        type="button"
                        className="term-tab-main"
                        onClick={() => void onSelectTerminal(tab.id)}
                        onDoubleClick={(e) => {
                          e.preventDefault();
                          e.stopPropagation();
                          setRenamingTabId(tab.id);
                          setRenameDraft(
                            tab.displayLabel || tab.label || "Terminal",
                          );
                        }}
                      >
                        <span className="term-tab-label">
                          {tab.displayLabel || tab.label || "Terminal"}
                        </span>
                        {tab.grokRunning ? (
                          <span className="term-tab-badge">Grok</span>
                        ) : null}
                      </button>
                    )}
                    {termTabs.length > 1 ? (
                      <button
                        type="button"
                        className="term-tab-close"
                        disabled={captureBusy}
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
          <TerminalFindBar
            open={findOpen}
            query={findQuery}
            caseSensitive={findCaseSensitive}
            resultIndex={findResultIndex}
            resultCount={findResultCount}
            pickMode={pickMode}
            onAimCancel={() => {
              void window.vefg?.setPickMode(false);
            }}
            onQueryChange={(q) => {
              setFindQuery(q);
              findQueryRef.current = q;
              runFind("next", q);
            }}
            onCaseSensitiveChange={(v) => {
              setFindCaseSensitive(v);
              findCaseRef.current = v;
              runFind("next", findQueryRef.current);
            }}
            onFindNext={() => runFind("next")}
            onFindPrevious={() => runFind("prev")}
            onClose={closeFindBar}
            labels={{
              placeholder: tr("find.placeholder"),
              next: tr("find.next"),
              prev: tr("find.prev"),
              close: tr("find.close"),
              caseSensitive: tr("find.case"),
              noResults: tr("find.noResults"),
              results: tr("find.results"),
              clear: tr("find.clear"),
            }}
          />
          <div className="terminal-body terminal-body-full">
            {termTabs.length === 0 && activeTermId ? (
              <TerminalPane
                sessionId={activeTermId}
                active
                focusNonce={termFocusNonce}
                fitNonce={termFitNonce}
                fontSize={termFontSize}
                scrollback={termScrollback}
                linkTooltip={linkTooltip}
                copyOnSelect={copyOnSelect}
                onSearchApi={registerSearchApi}
                onRequestFind={openFindBar}
                linkTooltipLabels={{
                  openPreview: tr("link.tipPreview"),
                  openSystem: tr("link.tipSystem"),
                }}
                contextMenuLabels={{
                  copy: tr("ctx.copy"),
                  find: tr("ctx.find"),
                  openPreview: tr("ctx.openPreview"),
                  openSystem: tr("ctx.openSystem"),
                }}
                onOpenHttpUrl={(url) => {
                  void openPreviewUrl(url, { fromTerminal: true });
                }}
                onOpenHttpUrlExternal={(url) => {
                  showToast(
                    tr("toast.previewInSystemBrowser", {
                      url: shortPath(url, 56),
                    }),
                  );
                }}
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
                  fontSize={termFontSize}
                  scrollback={termScrollback}
                  linkTooltip={linkTooltip}
                  copyOnSelect={copyOnSelect}
                  onSearchApi={registerSearchApi}
                  onRequestFind={openFindBar}
                  linkTooltipLabels={{
                    openPreview: tr("link.tipPreview"),
                    openSystem: tr("link.tipSystem"),
                  }}
                  contextMenuLabels={{
                    copy: tr("ctx.copy"),
                    find: tr("ctx.find"),
                    openPreview: tr("ctx.openPreview"),
                    openSystem: tr("ctx.openSystem"),
                  }}
                  onOpenHttpUrl={(url) => {
                    void openPreviewUrl(url, { fromTerminal: true });
                  }}
                  onOpenHttpUrlExternal={(url) => {
                    showToast(
                      tr("toast.previewInSystemBrowser", {
                        url: shortPath(url, 56),
                      }),
                    );
                  }}
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

      {settingsOpen ? (
        <div
          className="modal-backdrop"
          role="presentation"
          onClick={() => setSettingsOpen(false)}
        >
          <div
            className="modal-sheet"
            role="dialog"
            aria-label={tr("settings.title")}
            onClick={(e) => e.stopPropagation()}
          >
            <header className="modal-header">
              <h2>{tr("settings.title")}</h2>
              <button
                type="button"
                className="btn btn-ghost btn-compact"
                onClick={() => setSettingsOpen(false)}
              >
                ×
              </button>
            </header>
            <div className="modal-body settings-body">
              <label className="settings-row">
                <span>{tr("settings.fontSize")}</span>
                <input
                  type="number"
                  min={10}
                  max={22}
                  value={termFontSize}
                  onChange={(e) => {
                    const next = clampTermFontSize(Number(e.target.value));
                    setTermFontSize(next);
                    void persistTermSettings({ termFontSize: next });
                  }}
                />
              </label>
              <label className="settings-row">
                <span>{tr("settings.scrollback")}</span>
                <input
                  type="number"
                  min={1000}
                  max={50000}
                  step={1000}
                  value={termScrollback}
                  onChange={(e) => {
                    const next = Number(e.target.value) || TERM_SCROLLBACK_DEFAULT;
                    setTermScrollback(next);
                    void persistTermSettings({ termScrollback: next });
                  }}
                />
              </label>
              <label className="settings-row settings-check">
                <input
                  type="checkbox"
                  checked={linkTooltip}
                  onChange={(e) => {
                    setLinkTooltip(e.target.checked);
                    void persistTermSettings({ linkTooltip: e.target.checked });
                  }}
                />
                <span>{tr("settings.linkTooltip")}</span>
              </label>
              <label className="settings-row settings-check">
                <input
                  type="checkbox"
                  checked={copyOnSelect}
                  onChange={(e) => {
                    setCopyOnSelect(e.target.checked);
                    void persistTermSettings({ copyOnSelect: e.target.checked });
                  }}
                />
                <span>{tr("settings.copyOnSelect")}</span>
              </label>
              <label className="settings-row settings-check">
                <input
                  type="checkbox"
                  checked={notifyOnGrokExit}
                  onChange={(e) => {
                    setNotifyOnGrokExit(e.target.checked);
                    void persistTermSettings({
                      notifyOnGrokExit: e.target.checked,
                    });
                  }}
                />
                <span>{tr("settings.notifyOnGrokExit")}</span>
              </label>
              <label className="settings-row settings-check">
                <input
                  type="checkbox"
                  checked={notifyOnLongTask}
                  onChange={(e) => {
                    setNotifyOnLongTask(e.target.checked);
                    void persistTermSettings({
                      notifyOnLongTask: e.target.checked,
                    });
                  }}
                />
                <span>{tr("settings.notifyOnLongTask")}</span>
              </label>
              <label className="settings-row">
                <span>{tr("settings.longTaskThreshold")}</span>
                <input
                  type="number"
                  min={5}
                  max={600}
                  step={5}
                  value={longTaskNotifyThresholdSec}
                  onChange={(e) => {
                    const next = Number(e.target.value);
                    if (!Number.isFinite(next)) return;
                    setLongTaskNotifyThresholdSec(next);
                    void persistTermSettings({
                      longTaskNotifyThresholdSec: next,
                    });
                  }}
                />
              </label>
            </div>
          </div>
        </div>
      ) : null}

      {paletteOpen ? (
        <div
          className="modal-backdrop"
          role="presentation"
          onClick={() => {
            setPaletteOpen(false);
            focusGrokTerminal();
          }}
        >
          <div
            className="modal-sheet palette-sheet"
            role="dialog"
            aria-label={tr("palette.title")}
            onClick={(e) => e.stopPropagation()}
          >
            <div className="palette-input-row chrome-field is-focused">
              <input
                className="palette-input"
                autoFocus
                value={paletteQuery}
                placeholder={tr("palette.placeholder")}
                onChange={(e) => {
                  setPaletteQuery(e.target.value);
                  setPaletteIndex(0);
                }}
                spellCheck={false}
                autoComplete="off"
                aria-label={tr("palette.placeholder")}
                aria-controls="palette-listbox"
                aria-activedescendant={
                  paletteHighlight >= 0 && paletteVisible[paletteHighlight]
                    ? `palette-opt-${paletteVisible[paletteHighlight].id}`
                    : undefined
                }
                enterKeyHint="go"
                onKeyDown={onPaletteKeyDown}
              />
              {shouldShowUrlClear(paletteQuery) ? (
                <button
                  type="button"
                  className="icon-btn url-clear-btn"
                  title={tr("nav.urlClear")}
                  aria-label={tr("palette.clearAria")}
                  onClick={() => {
                    setPaletteQuery("");
                    setPaletteIndex(0);
                  }}
                >
                  ×
                </button>
              ) : null}
            </div>
            <ul
              id="palette-listbox"
              className="palette-list"
              role="listbox"
              aria-label={tr("palette.title")}
            >
              {paletteVisible.length === 0 ? (
                <li className="palette-empty" role="option" aria-disabled>
                  {tr("palette.noResults")}
                </li>
              ) : (
                paletteVisible.map((item, index) => {
                  const full = paletteCommands.find((c) => c.id === item.id);
                  if (!full) return null;
                  const selected = index === paletteHighlight;
                  return (
                    <li
                      key={item.id}
                      id={`palette-opt-${item.id}`}
                      role="option"
                      aria-selected={selected}
                    >
                      <button
                        type="button"
                        className={`palette-item ${selected ? "is-active" : ""}`}
                        onClick={() => full.run()}
                        onMouseEnter={() => setPaletteIndex(index)}
                      >
                        {item.label}
                      </button>
                    </li>
                  );
                })
              )}
            </ul>
          </div>
        </div>
      ) : null}

      {shortcutsOpen ? (
        <div
          className="modal-backdrop"
          role="presentation"
          onClick={() => setShortcutsOpen(false)}
        >
          <div
            className="modal-sheet"
            role="dialog"
            aria-label={tr("shortcuts.title")}
            onClick={(e) => e.stopPropagation()}
          >
            <header className="modal-header">
              <h2>{tr("shortcuts.title")}</h2>
              <button
                type="button"
                className="btn btn-ghost btn-compact"
                onClick={() => setShortcutsOpen(false)}
              >
                ×
              </button>
            </header>
            <div className="modal-body shortcuts-body">
              <dl>
                {(
                  [
                    ["⌘F", "shortcuts.find"],
                    ["Enter / ⇧Enter", "shortcuts.findNav"],
                    ["⌘K · ↑↓ · Enter", "shortcuts.paletteNav"],
                    ["Enter · ⇧Enter", "shortcuts.urlEnter"],
                    ["⇧Enter · ⌥Enter", "shortcuts.grokNewline"],
                    ["⌘⌫ · ⌘⌦", "shortcuts.grokClearLine"],
                    ["⌘A", "shortcuts.grokSelectAll"],
                    ["⌘← / ⌘→", "shortcuts.grokLineNav"],
                    ["⌘↑ / ⌘↓", "shortcuts.grokBufferNav"],
                    ["⌥← / ⌥→ · ⌥⌫ / ⌥⌦", "shortcuts.grokWordNav"],
                    ["⌘T / ⌘W", "shortcuts.tabs"],
                    ["⌘+ / ⌘- / ⌘0", "shortcuts.font"],
                    ["⌘1 / ⌘2", "shortcuts.focus"],
                    ["⌘⇧A / ⌘⇧F / ⌘⇧V", "shortcuts.capture"],
                    ["⌘⇧P", "shortcuts.preview"],
                    ["⌘⇧M / ⌘⇧E", "shortcuts.maximize"],
                    ["⌘K", "shortcuts.palette"],
                    ["⌘,", "shortcuts.settings"],
                    ["⌘/", "shortcuts.this"],
                  ] as const
                ).map(([keys, labelKey]) => (
                  <div className="shortcut-row" key={labelKey}>
                    <dt>
                      <kbd>{keys}</kbd>
                    </dt>
                    <dd>{tr(labelKey)}</dd>
                  </div>
                ))}
              </dl>
            </div>
          </div>
        </div>
      ) : null}
    </div>
  );
}
