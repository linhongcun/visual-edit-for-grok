import { useEffect, useRef } from "react";
import { Terminal } from "@xterm/xterm";
import { FitAddon } from "@xterm/addon-fit";
import { WebLinksAddon } from "@xterm/addon-web-links";
import { Unicode11Addon } from "@xterm/addon-unicode11";
import { WebglAddon } from "@xterm/addon-webgl";
import {
  trackpadScrollPixels,
  trackpadScrollPixelsFromFrame,
  trackpadTuiWheelImpulseFromFrame,
} from "../trackpad-scroll.cjs";
import { resolveTerminalLinkTarget } from "../link-open-policy.cjs";
import "@xterm/xterm/css/xterm.css";

/** Slightly smaller than 13 so the same pane fits more columns (helps wide CJK tables). */
const TERM_FONT_SIZE = 12;

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

interface Props {
  /** Main-process terminal session id */
  sessionId: string;
  active: boolean;
  /** Increment to force focus into the Grok/xterm input */
  focusNonce?: number;
  /** Increment after splitter / layout settle to force fit + PTY resize */
  fitNonce?: number;
  /**
   * Open http(s) links from the terminal in the in-app preview.
   * ⌘/Ctrl+click uses the system browser via openExternal instead.
   */
  onOpenHttpUrl?: (url: string) => void;
  /** Optional toast/status when a link opens in the system browser */
  onOpenHttpUrlExternal?: (url: string) => void;
}

export default function TerminalPane({
  sessionId,
  active,
  focusNonce = 0,
  fitNonce = 0,
  onOpenHttpUrl,
  onOpenHttpUrlExternal,
}: Props) {
  const hostRef = useRef<HTMLDivElement>(null);
  const termRef = useRef<Terminal | null>(null);
  const fitRef = useRef<FitAddon | null>(null);
  const startedRef = useRef(false);
  const lastDimsRef = useRef({ cols: 0, rows: 0 });
  /** Single pending deferred focus timer — avoid multi-timeout storms */
  const focusTimerRef = useRef<number | null>(null);
  const resizeTimerRef = useRef<number | null>(null);
  const sessionIdRef = useRef(sessionId);
  const onOpenHttpUrlRef = useRef(onOpenHttpUrl);
  const onOpenHttpUrlExternalRef = useRef(onOpenHttpUrlExternal);
  /** Pixel-mode deltaY summed within the current animation frame */
  const wheelFrameDeltaRef = useRef(0);
  const wheelFrameRafRef = useRef<number | null>(null);
  const wheelFrameEventRef = useRef<WheelEventInit | null>(null);
  /** Fractional TUI wheel reports carried into the next animation frame. */
  const tuiWheelRemainderRef = useRef(0);

  useEffect(() => {
    sessionIdRef.current = sessionId;
  }, [sessionId]);

  useEffect(() => {
    onOpenHttpUrlRef.current = onOpenHttpUrl;
  }, [onOpenHttpUrl]);

  useEffect(() => {
    onOpenHttpUrlExternalRef.current = onOpenHttpUrlExternal;
  }, [onOpenHttpUrlExternal]);

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

    const term = new Terminal({
      // Blink forces continuous repaints; keep off for scroll smoothness
      cursorBlink: false,
      fontSize: TERM_FONT_SIZE,
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
      scrollback: 5000,
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
    // Plain-text URL regex (non-OSC-8). OSC 8 uses Terminal.linkHandler above.
    term.loadAddon(
      new WebLinksAddon((event, uri) => {
        openTerminalHttpUrl(uri, event);
      }),
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
        (viewport.clientHeight || term.rows * TERM_FONT_SIZE) /
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
      }
      onData();
      onExit();
      onFocusReq();
      ro.disconnect();
      term.dispose();
      termRef.current = null;
      fitRef.current = null;
      startedRef.current = false;
    };
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

  return (
    <div
      className={`terminal-host ${active ? "is-active" : "is-hidden"}`}
      ref={hostRef}
      data-session-id={sessionId}
      aria-hidden={!active}
    />
  );
}
