import { useEffect, useRef, useState } from "react";
import { Terminal } from "@xterm/xterm";
import { FitAddon } from "@xterm/addon-fit";
import { WebLinksAddon } from "@xterm/addon-web-links";
import { Unicode11Addon } from "@xterm/addon-unicode11";
import { WebglAddon } from "@xterm/addon-webgl";
import { SearchAddon } from "@xterm/addon-search";
import {
  trackpadScrollPixels,
  trackpadScrollPixelsFromFrame,
  trackpadTuiWheelImpulseFromFrame,
} from "../trackpad-scroll.cjs";
import { resolveTerminalLinkTarget } from "../link-open-policy.cjs";
import {
  clampTermFontSize,
  clampTermScrollback,
  TERM_FONT_SIZE_DEFAULT,
  TERM_SCROLLBACK_DEFAULT,
} from "../term-settings.cjs";
import { resolveModifiedEnterForGrok } from "../terminal-key-encode.cjs";
import "@xterm/xterm/css/xterm.css";

/**
 * Prefer mono fonts that measure CJK as double-width consistently.
 * Keep Latin mono first; avoid proportional CJK faces that skew box-drawing alignment.
 */
const TERM_FONT_FAMILY = [
  "Menlo",
  "SFMono-Regular",
  "Monaco",
  "Consolas",
  "Sarasa Mono SC",
  "Sarasa Term SC",
  "Noto Sans Mono CJK SC",
  "Source Han Mono SC",
  "ui-monospace",
  "monospace",
].join(", ");

export interface TerminalSearchOptions {
  caseSensitive?: boolean;
  incremental?: boolean;
}

export interface TerminalSearchApi {
  findNext: (term: string, opts?: TerminalSearchOptions) => boolean;
  findPrevious: (term: string, opts?: TerminalSearchOptions) => boolean;
  clearDecorations: () => void;
  onResults: (
    handler: (info: { resultIndex: number; resultCount: number }) => void,
  ) => () => void;
}

interface Props {
  /** Main-process terminal session id */
  sessionId: string;
  active: boolean;
  /** Increment to force focus into the Grok/xterm input */
  focusNonce?: number;
  /** Increment after splitter / layout settle to force fit + PTY resize */
  fitNonce?: number;
  /** Terminal font size in px */
  fontSize?: number;
  /** xterm scrollback rows */
  scrollback?: number;
  /** Show hover tooltip for http(s) links */
  linkTooltip?: boolean;
  /** Copy selection to clipboard on mouseup */
  copyOnSelect?: boolean;
  /**
   * Open http(s) links from the terminal in the in-app preview.
   * ⌘/Ctrl+click uses the system browser via openExternal instead.
   */
  onOpenHttpUrl?: (url: string) => void;
  /** Optional toast/status when a link opens in the system browser */
  onOpenHttpUrlExternal?: (url: string) => void;
  /** Register/unregister search API for this session (active find bar) */
  onSearchApi?: (sessionId: string, api: TerminalSearchApi | null) => void;
  /** Link tooltip copy */
  linkTooltipLabels?: {
    openPreview: string;
    openSystem: string;
  };
  /** Context menu labels */
  contextMenuLabels?: {
    copy: string;
    find: string;
    openPreview: string;
    openSystem: string;
  };
  /** Open find bar for this terminal (e.g. from context menu) */
  onRequestFind?: () => void;
}

export default function TerminalPane({
  sessionId,
  active,
  focusNonce = 0,
  fitNonce = 0,
  fontSize = TERM_FONT_SIZE_DEFAULT,
  scrollback = TERM_SCROLLBACK_DEFAULT,
  linkTooltip = true,
  copyOnSelect = false,
  onOpenHttpUrl,
  onOpenHttpUrlExternal,
  onSearchApi,
  linkTooltipLabels,
  contextMenuLabels,
  onRequestFind,
}: Props) {
  const hostRef = useRef<HTMLDivElement>(null);
  const termRef = useRef<Terminal | null>(null);
  const fitRef = useRef<FitAddon | null>(null);
  const searchRef = useRef<SearchAddon | null>(null);
  const startedRef = useRef(false);
  const lastDimsRef = useRef({ cols: 0, rows: 0 });
  /** Single pending deferred focus timer — avoid multi-timeout storms */
  const focusTimerRef = useRef<number | null>(null);
  const resizeTimerRef = useRef<number | null>(null);
  const sessionIdRef = useRef(sessionId);
  const onOpenHttpUrlRef = useRef(onOpenHttpUrl);
  const onOpenHttpUrlExternalRef = useRef(onOpenHttpUrlExternal);
  const onSearchApiRef = useRef(onSearchApi);
  const linkTooltipEnabledRef = useRef(linkTooltip);
  const copyOnSelectRef = useRef(copyOnSelect);
  const linkTooltipLabelsRef = useRef(linkTooltipLabels);
  /** Pixel-mode deltaY summed within the current animation frame */
  const wheelFrameDeltaRef = useRef(0);
  const wheelFrameRafRef = useRef<number | null>(null);
  const wheelFrameEventRef = useRef<WheelEventInit | null>(null);
  /** Fractional TUI wheel reports carried into the next animation frame. */
  const tuiWheelRemainderRef = useRef(0);
  const [tooltip, setTooltip] = useState<{
    uri: string;
    x: number;
    y: number;
  } | null>(null);
  const [ctxMenu, setCtxMenu] = useState<{
    x: number;
    y: number;
    selection: string;
    link: string | null;
  } | null>(null);
  const onRequestFindRef = useRef(onRequestFind);
  const lastHoverUriRef = useRef<string | null>(null);

  useEffect(() => {
    onRequestFindRef.current = onRequestFind;
  }, [onRequestFind]);

  useEffect(() => {
    sessionIdRef.current = sessionId;
  }, [sessionId]);

  useEffect(() => {
    onOpenHttpUrlRef.current = onOpenHttpUrl;
  }, [onOpenHttpUrl]);

  useEffect(() => {
    onOpenHttpUrlExternalRef.current = onOpenHttpUrlExternal;
  }, [onOpenHttpUrlExternal]);

  useEffect(() => {
    onSearchApiRef.current = onSearchApi;
  }, [onSearchApi]);

  useEffect(() => {
    linkTooltipEnabledRef.current = linkTooltip;
    if (!linkTooltip) setTooltip(null);
  }, [linkTooltip]);

  useEffect(() => {
    copyOnSelectRef.current = copyOnSelect;
  }, [copyOnSelect]);

  useEffect(() => {
    linkTooltipLabelsRef.current = linkTooltipLabels;
  }, [linkTooltipLabels]);

  /**
   * Shared open path for WebLinksAddon (regex URLs) and OSC 8 linkHandler.
   * Without linkHandler, xterm OscLinkProvider shows confirm() + window.open
   * (denied by our main-window setWindowOpenHandler) — the regression dialog.
   */
  function openTerminalHttpUrl(uri: string, event?: MouseEvent | null) {
    const target = resolveTerminalLinkTarget(uri, event);
    if (target === "preview" && onOpenHttpUrlRef.current) {
      onOpenHttpUrlRef.current(uri);
      return;
    }
    if (target === "system") {
      void window.vefg
        ?.openExternal(uri)
        .then(() => {
          onOpenHttpUrlExternalRef.current?.(uri);
        })
        .catch(() => {
          // Main validates schemes and owns the native browser handoff.
        });
    }
  }

  function showLinkTooltip(uri: string, event: MouseEvent) {
    lastHoverUriRef.current = uri;
    if (!linkTooltipEnabledRef.current) {
      setTooltip(null);
      return;
    }
    const host = hostRef.current;
    if (!host) return;
    const rect = host.getBoundingClientRect();
    setTooltip({
      uri,
      x: Math.min(Math.max(8, event.clientX - rect.left + 12), rect.width - 16),
      y: Math.min(Math.max(8, event.clientY - rect.top + 16), rect.height - 16),
    });
  }

  function hideLinkTooltip() {
    lastHoverUriRef.current = null;
    setTooltip(null);
  }

  function clearFocusTimer() {
    if (focusTimerRef.current != null) {
      window.clearTimeout(focusTimerRef.current);
      focusTimerRef.current = null;
    }
  }

  function clearResizeTimer() {
    if (resizeTimerRef.current != null) {
      window.clearTimeout(resizeTimerRef.current);
      resizeTimerRef.current = null;
    }
  }

  function focusTerminal() {
    const term = termRef.current;
    const host = hostRef.current;
    if (!term) return;
    try {
      host?.scrollIntoView({ block: "nearest" });
      term.focus();
      const helper = host?.querySelector(
        "textarea.xterm-helper-textarea",
      ) as HTMLTextAreaElement | null;
      helper?.focus({ preventScroll: true });
    } catch {
      /* ignore */
    }
  }

  /**
   * One coordinated focus pass: rAF now + single deferred retry (matches main
   * process focusHandoffDelays policy of [0, 100] without stacking storms).
   */
  function scheduleFocus() {
    clearFocusTimer();
    requestAnimationFrame(() => {
      focusTerminal();
      focusTimerRef.current = window.setTimeout(() => {
        focusTimerRef.current = null;
        focusTerminal();
      }, 100);
    });
  }

  /**
   * Fit xterm to host and push cols/rows to the PTY so Grok reflows to width.
   * @param force when true, always notify PTY even if cols/rows unchanged
   */
  function fitAndSyncPty(force = false) {
    const term = termRef.current;
    const fit = fitRef.current;
    if (!term || !fit) return;
    try {
      fit.fit();
      const cols = term.cols;
      const rows = term.rows;
      if (cols < 2 || rows < 1) return;
      const prev = lastDimsRef.current;
      const changed = prev.cols !== cols || prev.rows !== rows;
      if (!changed && !force) return;
      lastDimsRef.current = { cols, rows };
      if (startedRef.current && window.vefg) {
        void window.vefg.terminalResize({
          cols,
          rows,
          sessionId: sessionIdRef.current,
        });
      }
    } catch {
      /* ignore */
    }
  }

  /** Debounce intermediate resizes; optional trailing force for splitter end. */
  function scheduleFit(force = false, debounceMs = 48) {
    clearResizeTimer();
    if (force || debounceMs <= 0) {
      requestAnimationFrame(() => fitAndSyncPty(force));
      return;
    }
    resizeTimerRef.current = window.setTimeout(() => {
      resizeTimerRef.current = null;
      fitAndSyncPty(false);
    }, debounceMs);
  }

  useEffect(() => {
    if (!hostRef.current || !window.vefg || !sessionId) return;

    const initialFont = clampTermFontSize(fontSize);
    const initialScrollback = clampTermScrollback(scrollback);

    const term = new Terminal({
      // Blink forces continuous repaints; keep off for scroll smoothness
      cursorBlink: false,
      fontSize: initialFont,
      fontFamily: TERM_FONT_FAMILY,
      // Integer-ish cell metrics help CJK + box-drawing table borders line up
      lineHeight: 1.2,
      letterSpacing: 0,
      // Draw box-drawing glyphs on the atlas (needed for Grok markdown tables)
      customGlyphs: true,
      theme: {
        background: "#0a0c10",
        foreground: "#e8eaef",
        cursor: "#6d8cff",
        cursorAccent: "#0a0c10",
        selectionBackground: "rgba(109, 140, 255, 0.35)",
        black: "#1a1e28",
        red: "#f31260",
        green: "#3dd68c",
        yellow: "#f5a524",
        blue: "#6d8cff",
        magenta: "#a78bfa",
        cyan: "#22d3ee",
        white: "#e8eaef",
        brightBlack: "#5c6578",
        brightRed: "#ff7a9c",
        brightGreen: "#6ee7b7",
        brightYellow: "#fcd34d",
        brightBlue: "#93b4ff",
        brightMagenta: "#c4b5fd",
        brightCyan: "#67e8f9",
        brightWhite: "#ffffff",
      },
      allowProposedApi: true,
      scrollback: initialScrollback,
      convertEol: false,
      windowsMode: false,
      scrollSensitivity: 3,
      fastScrollSensitivity: 8,
      smoothScrollDuration: 0,
      // Restored: reduces “broken” table border / CJK overlap artifacts
      rescaleOverlappingGlyphs: true,
      // OSC 8 hyperlinks (Grok writes these). Default = confirm() + window.open.
      linkHandler: {
        activate: (event, uri) => {
          openTerminalHttpUrl(uri, event);
        },
        hover: (event, uri) => {
          showLinkTooltip(uri, event);
        },
        leave: () => {
          hideLinkTooltip();
        },
        // http(s) only — matches main shell:open-external allowlist
        allowNonHttpProtocols: false,
      },
    });

    const fit = new FitAddon();
    term.loadAddon(fit);
    // Unicode 11 East Asian Width — required for CJK double-width vs ASCII table pipes
    const unicode11 = new Unicode11Addon();
    term.loadAddon(unicode11);
    term.unicode.activeVersion = "11";

    const search = new SearchAddon({ highlightLimit: 1000 });
    term.loadAddon(search);
    searchRef.current = search;

    const searchDecorations = {
      matchBackground: "#3b4a6b",
      matchBorder: "#6d8cff",
      matchOverviewRuler: "#6d8cff",
      activeMatchBackground: "#f5a524",
      activeMatchBorder: "#ffffff",
      activeMatchColorOverviewRuler: "#f5a524",
    };

    const api: TerminalSearchApi = {
      findNext: (q, opts) =>
        search.findNext(q, {
          caseSensitive: Boolean(opts?.caseSensitive),
          incremental: Boolean(opts?.incremental),
          decorations: searchDecorations,
        }),
      findPrevious: (q, opts) =>
        search.findPrevious(q, {
          caseSensitive: Boolean(opts?.caseSensitive),
          decorations: searchDecorations,
        }),
      clearDecorations: () => {
        try {
          search.clearDecorations();
        } catch {
          /* ignore */
        }
      },
      onResults: (handler) => {
        const d = search.onDidChangeResults((info) => {
          handler({
            resultIndex: info.resultIndex,
            resultCount: info.resultCount,
          });
        });
        return () => {
          try {
            d.dispose();
          } catch {
            /* ignore */
          }
        };
      },
    };
    onSearchApiRef.current?.(sessionId, api);

    // Plain-text URL regex (non-OSC-8). OSC 8 uses Terminal.linkHandler above.
    term.loadAddon(
      new WebLinksAddon(
        (event, uri) => {
          openTerminalHttpUrl(uri, event);
        },
        {
          hover: (event, text) => {
            showLinkTooltip(text, event);
          },
          leave: () => {
            hideLinkTooltip();
          },
        },
      ),
    );
    term.open(hostRef.current);
    // WebGL: cleaner box-drawing for Grok tables; fall back to canvas if GPU path fails.
    // Trackpad scroll no longer depends on renderer (viewport.scrollTop path).
    try {
      const webgl = new WebglAddon();
      webgl.onContextLoss(() => {
        try {
          webgl.dispose();
        } catch {
          /* ignore */
        }
      });
      term.loadAddon(webgl);
    } catch {
      /* canvas renderer remains */
    }
    fit.fit();

    termRef.current = term;
    fitRef.current = fit;
    lastDimsRef.current = { cols: term.cols, rows: term.rows };
    wheelFrameDeltaRef.current = 0;
    wheelFrameEventRef.current = null;
    tuiWheelRemainderRef.current = 0;

    /**
     * Own precision wheel in capture phase on xterm's root. The visible
     * .xterm-screen and the scrollable .xterm-viewport are siblings, so a
     * listener on the viewport alone never sees gestures over terminal text.
     */
    const viewportEl = term.element?.querySelector(
      ".xterm-viewport",
    ) as HTMLElement | null;
    const terminalEl = term.element;
    const forwardedWheelEvents = new WeakSet<WheelEvent>();

    const terminalRowPx = (viewport: HTMLElement) =>
      Math.max(
        10,
        (viewport.clientHeight || term.rows * initialFont) /
          Math.max(1, term.rows),
      );

    const flushWheelFrame = () => {
      wheelFrameRafRef.current = null;
      const viewport = viewportEl;
      const frameEvent = wheelFrameEventRef.current;
      wheelFrameEventRef.current = null;
      if (!viewport) {
        wheelFrameDeltaRef.current = 0;
        tuiWheelRemainderRef.current = 0;
        return;
      }
      const frameDelta = wheelFrameDeltaRef.current;
      wheelFrameDeltaRef.current = 0;
      if (frameDelta === 0) return;

      const maxScroll = Math.max(
        0,
        viewport.scrollHeight - viewport.clientHeight,
      );
      const rowPx = terminalRowPx(viewport);

      if (maxScroll >= 1) {
        tuiWheelRemainderRef.current = 0;
        const pixels = trackpadScrollPixelsFromFrame(frameDelta);
        if (pixels === 0) return;
        viewport.scrollTop = Math.min(
          maxScroll,
          Math.max(0, viewport.scrollTop + pixels),
        );
        return;
      }

      const isMouseReportingTui =
        term.buffer.active.type === "alternate" &&
        term.modes.mouseTrackingMode !== "none";
      if (!isMouseReportingTui || !terminalEl || !frameEvent) {
        tuiWheelRemainderRef.current = 0;
        return;
      }

      const impulse = trackpadTuiWheelImpulseFromFrame(frameDelta, rowPx);
      if (
        tuiWheelRemainderRef.current !== 0 &&
        Math.sign(tuiWheelRemainderRef.current) !== Math.sign(impulse)
      ) {
        tuiWheelRemainderRef.current = 0;
      }
      const total = tuiWheelRemainderRef.current + impulse;
      const steps = Math.trunc(total);
      tuiWheelRemainderRef.current = total - steps;
      if (steps === 0) return;

      const direction = Math.sign(steps);
      const forwardTarget =
        terminalEl.querySelector<HTMLElement>(".xterm-screen") || terminalEl;
      for (let index = 0; index < Math.abs(steps); index += 1) {
        const forwarded = new WheelEvent("wheel", {
          ...frameEvent,
          bubbles: true,
          cancelable: true,
          composed: true,
          deltaX: 0,
          deltaY: direction,
          deltaMode: WheelEvent.DOM_DELTA_LINE,
        });
        forwardedWheelEvents.add(forwarded);
        forwardTarget.dispatchEvent(forwarded);
      }
    };

    const consumeWheel = (ev: WheelEvent) => {
      ev.preventDefault();
      ev.stopPropagation();
      ev.stopImmediatePropagation();
    };

    const onTerminalWheel = (ev: WheelEvent) => {
      if (forwardedWheelEvents.has(ev)) {
        forwardedWheelEvents.delete(ev);
        return;
      }
      if (ev.shiftKey || ev.deltaY === 0) return;
      if (
        Math.abs(ev.deltaX) > Math.abs(ev.deltaY) &&
        Math.abs(ev.deltaX) > 1
      ) {
        return;
      }

      const viewport = viewportEl;
      if (!viewport) return;
      const maxScroll = Math.max(
        0,
        viewport.scrollHeight - viewport.clientHeight,
      );
      const isPixelMode = ev.deltaMode === WheelEvent.DOM_DELTA_PIXEL;
      const isMouseReportingTui =
        maxScroll < 1 &&
        term.buffer.active.type === "alternate" &&
        term.modes.mouseTrackingMode !== "none";

      // Non-pixel wheel events and non-mouse-reporting alternate buffers keep
      // xterm's native semantics (including arrow-key conversion for TUIs).
      if (maxScroll < 1 && (!isMouseReportingTui || !isPixelMode)) return;

      const rowPx = terminalRowPx(viewport);
      if (maxScroll >= 1 && !isPixelMode) {
        const pixels = trackpadScrollPixels(
          ev.deltaY,
          ev.deltaMode,
          rowPx,
          viewport.clientHeight,
          16,
        );
        viewport.scrollTop = Math.min(
          maxScroll,
          Math.max(0, viewport.scrollTop + pixels),
        );
        consumeWheel(ev);
        return;
      }

      wheelFrameDeltaRef.current += ev.deltaY;
      wheelFrameEventRef.current = {
        view: window,
        clientX: ev.clientX,
        clientY: ev.clientY,
        screenX: ev.screenX,
        screenY: ev.screenY,
        ctrlKey: ev.ctrlKey,
        altKey: ev.altKey,
        metaKey: ev.metaKey,
      };
      if (wheelFrameRafRef.current == null) {
        wheelFrameRafRef.current =
          window.requestAnimationFrame(flushWheelFrame);
      }

      consumeWheel(ev);
    };

    if (terminalEl) {
      terminalEl.addEventListener("wheel", onTerminalWheel, {
        passive: false,
        capture: true,
      });
    }

    const onSelectionChange = () => {
      if (!copyOnSelectRef.current) return;
      const text = term.getSelection();
      if (!text) return;
      try {
        void navigator.clipboard.writeText(text);
      } catch {
        /* ignore */
      }
    };
    const selectionDisp = term.onSelectionChange(onSelectionChange);

    const onContextMenu = (ev: MouseEvent) => {
      ev.preventDefault();
      const host = hostRef.current;
      if (!host) return;
      const rect = host.getBoundingClientRect();
      const selection = term.getSelection() || "";
      // Prefer last hovered OSC/plain link URI when right-clicking a link.
      const link = lastHoverUriRef.current || null;
      setCtxMenu({
        x: Math.min(ev.clientX - rect.left, rect.width - 160),
        y: Math.min(ev.clientY - rect.top, rect.height - 120),
        selection,
        link,
      });
    };
    terminalEl?.addEventListener("contextmenu", onContextMenu);

    const onData = window.vefg.on("terminal:data", (payload) => {
      if (typeof payload === "string") {
        // Legacy single-terminal payload
        term.write(payload);
        return;
      }
      const p = payload as { sessionId?: string; data?: string };
      if (p.sessionId && p.sessionId !== sessionIdRef.current) return;
      term.write(String(p.data ?? ""));
    });

    const onExit = window.vefg.on("terminal:exit", (payload) => {
      const p = payload as { sessionId?: string; code?: number };
      if (p.sessionId && p.sessionId !== sessionIdRef.current) return;
      const code = p.code ?? 0;
      term.writeln(
        `\r\n\x1b[90m[process exited: ${code}]  Use “Reset term” to restart.\x1b[0m\r\n`,
      );
      startedRef.current = false;
    });

    const onFocusReq = window.vefg.on("terminal:focus-request", (payload) => {
      const p = payload as { sessionId?: string | null };
      if (p.sessionId && p.sessionId !== sessionIdRef.current) return;
      scheduleFocus();
    });

    term.onData((data) => {
      void window.vefg.terminalWrite({
        data,
        sessionId: sessionIdRef.current,
      });
    });

    /**
     * Grok TUI: Shift+Enter = newline, Enter = send.
     * Stock xterm.js encodes both as bare CR on keydown. We remap Shift+Enter
     * to ESC+CR (same as Alt+Enter). Also swallow the following keypress/keyup
     * — otherwise xterm still emits bare CR after our write and Grok submits
     * (user: Alt+Enter works, Shift+Enter still sends).
     */
    term.attachCustomKeyEventHandler((ev) => {
      const resolved = resolveModifiedEnterForGrok(ev);
      if (!resolved) return true;
      // Always cancel DOM default for write *and* swallow — otherwise keypress
      // still emits bare CR after a keydown remapping.
      try {
        ev.preventDefault?.();
        ev.stopPropagation?.();
      } catch {
        /* ignore */
      }
      if (resolved.action === "write") {
        void window.vefg.terminalWrite({
          data: resolved.sequence,
          sessionId: sessionIdRef.current,
        });
      }
      // false = do not let xterm handle this event
      return false;
    });

    const start = async () => {
      fitAndSyncPty(true);
      const dims = {
        cols: term.cols,
        rows: term.rows,
        sessionId: sessionIdRef.current,
      };
      try {
        await window.vefg.terminalStart(dims);
        startedRef.current = true;
        requestAnimationFrame(() => fitAndSyncPty(true));
      } catch (err) {
        term.writeln(
          `\x1b[31mTerminal failed to start: ${err instanceof Error ? err.message : String(err)}\x1b[0m`,
        );
        term.writeln(
          "\x1b[90mFrom the project folder run: npm run rebuild\x1b[0m",
        );
      }
    };

    void start();

    const ro = new ResizeObserver(() => {
      scheduleFit(false, 40);
    });
    ro.observe(hostRef.current);

    return () => {
      onSearchApiRef.current?.(sessionId, null);
      searchRef.current = null;
      clearFocusTimer();
      clearResizeTimer();
      if (wheelFrameRafRef.current != null) {
        window.cancelAnimationFrame(wheelFrameRafRef.current);
        wheelFrameRafRef.current = null;
      }
      wheelFrameDeltaRef.current = 0;
      wheelFrameEventRef.current = null;
      tuiWheelRemainderRef.current = 0;
      if (terminalEl) {
        terminalEl.removeEventListener("wheel", onTerminalWheel, true);
        terminalEl.removeEventListener("contextmenu", onContextMenu);
      }
      try {
        selectionDisp.dispose();
      } catch {
        /* ignore */
      }
      onData();
      onExit();
      onFocusReq();
      ro.disconnect();
      term.dispose();
      termRef.current = null;
      fitRef.current = null;
      startedRef.current = false;
      setTooltip(null);
    };
    // sessionId is the identity of this pane instance; other options apply via effects.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [sessionId]);

  useEffect(() => {
    if (!active) return;
    requestAnimationFrame(() => fitAndSyncPty(true));
  }, [active]);

  useEffect(() => {
    if (!focusNonce || !active) return;
    scheduleFocus();
    return () => clearFocusTimer();
  }, [focusNonce, active]);

  useEffect(() => {
    if (!fitNonce) return;
    scheduleFit(true, 0);
  }, [fitNonce]);

  // Live font size changes (zoom) — re-fit + PTY resize so Grok tables reflow.
  useEffect(() => {
    const term = termRef.current;
    if (!term) return;
    const next = clampTermFontSize(fontSize);
    if (term.options.fontSize === next) return;
    term.options.fontSize = next;
    scheduleFit(true, 0);
  }, [fontSize]);

  useEffect(() => {
    const term = termRef.current;
    if (!term) return;
    const next = clampTermScrollback(scrollback);
    if (term.options.scrollback === next) return;
    term.options.scrollback = next;
  }, [scrollback]);

  const tipLabels = linkTooltipLabels || {
    openPreview: "Click → preview",
    openSystem: "⌘-click → browser",
  };
  const menuLabels = contextMenuLabels || {
    copy: "Copy",
    find: "Find",
    openPreview: "Open in preview",
    openSystem: "Open in browser",
  };

  return (
    <div
      className={`terminal-host ${active ? "is-active" : "is-hidden"}`}
      ref={hostRef}
      data-session-id={sessionId}
      aria-hidden={!active}
      onClick={() => {
        if (ctxMenu) setCtxMenu(null);
      }}
    >
      {tooltip && active ? (
        <div
          className="term-link-tooltip"
          style={{ left: tooltip.x, top: tooltip.y }}
          role="tooltip"
        >
          <div className="term-link-tooltip-url">{tooltip.uri}</div>
          <div className="term-link-tooltip-hint">
            {tipLabels.openPreview} · {tipLabels.openSystem}
          </div>
        </div>
      ) : null}
      {ctxMenu && active ? (
        <div
          className="term-context-menu"
          style={{ left: ctxMenu.x, top: ctxMenu.y }}
          role="menu"
          onClick={(e) => e.stopPropagation()}
        >
          <button
            type="button"
            role="menuitem"
            disabled={!ctxMenu.selection}
            onClick={() => {
              if (ctxMenu.selection) {
                void navigator.clipboard.writeText(ctxMenu.selection);
              }
              setCtxMenu(null);
            }}
          >
            {menuLabels.copy}
          </button>
          <button
            type="button"
            role="menuitem"
            onClick={() => {
              setCtxMenu(null);
              onRequestFindRef.current?.();
            }}
          >
            {menuLabels.find}
          </button>
          {ctxMenu.link ? (
            <>
              <button
                type="button"
                role="menuitem"
                onClick={() => {
                  openTerminalHttpUrl(ctxMenu.link!, null);
                  setCtxMenu(null);
                }}
              >
                {menuLabels.openPreview}
              </button>
              <button
                type="button"
                role="menuitem"
                onClick={() => {
                  openTerminalHttpUrl(ctxMenu.link!, {
                    metaKey: true,
                  } as MouseEvent);
                  setCtxMenu(null);
                }}
              >
                {menuLabels.openSystem}
              </button>
            </>
          ) : null}
        </div>
      ) : null}
    </div>
  );
}
