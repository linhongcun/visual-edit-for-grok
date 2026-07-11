import { useEffect, useRef } from "react";
import { Terminal } from "@xterm/xterm";
import { FitAddon } from "@xterm/addon-fit";
import { WebLinksAddon } from "@xterm/addon-web-links";
import { Unicode11Addon } from "@xterm/addon-unicode11";
import "@xterm/xterm/css/xterm.css";

/** Slightly smaller than 13 so the same pane fits more columns (helps wide CJK tables). */
const TERM_FONT_SIZE = 12;

/**
 * macOS trackpad sends many small pixel deltas. xterm's default conversion
 * (scrollSensitivity × deltaY / rowHeight, floored) feels capped-slow.
 * Extra gain is applied in our custom wheel handler.
 */
const TRACKPAD_SCROLL_GAIN = 4.5;
/** Minimum lines to jump when a non-trivial flick is detected */
const TRACKPAD_MIN_LINES = 1;

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
}

export default function TerminalPane({
  sessionId,
  active,
  focusNonce = 0,
  fitNonce = 0,
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
  /** Sub-line wheel accumulation for trackpad pixel deltas */
  const wheelAccumRef = useRef(0);
  const wheelRafRef = useRef<number | null>(null);
  const wheelPendingLinesRef = useRef(0);

  useEffect(() => {
    sessionIdRef.current = sessionId;
  }, [sessionId]);

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
      // Blink forces continuous repaints and makes wheel-scroll feel laggy
      cursorBlink: false,
      fontSize: TERM_FONT_SIZE,
      fontFamily: TERM_FONT_FAMILY,
      lineHeight: 1.15,
      letterSpacing: 0,
      // Box-drawing without heavy per-frame rescale
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
      // Backup if custom wheel handler is bypassed
      scrollSensitivity: 12,
      fastScrollSensitivity: 20,
      smoothScrollDuration: 0,
      rescaleOverlappingGlyphs: false,
    });

    const fit = new FitAddon();
    term.loadAddon(fit);
    const unicode11 = new Unicode11Addon();
    term.loadAddon(unicode11);
    term.unicode.activeVersion = "11";
    term.loadAddon(
      new WebLinksAddon((_event, uri) => {
        void window.vefg.openExternal(uri).catch(() => {
          // Main validates schemes and owns the native browser handoff.
        });
      }),
    );
    term.open(hostRef.current);
    // Canvas renderer: WebGL + multi-tab + CJK was capping trackpad scroll FPS.
    // Prefer snappy scroll over GPU path for the embedded CLI.
    fit.fit();

    termRef.current = term;
    fitRef.current = fit;
    lastDimsRef.current = { cols: term.cols, rows: term.rows };
    wheelAccumRef.current = 0;
    wheelPendingLinesRef.current = 0;

    /**
     * Custom wheel path tuned for macOS trackpad:
     * - pixel deltas → lines with high gain
     * - coalesce to one scrollLines per animation frame (keeps up with flicks)
     * Returning `false` tells xterm to skip its own slow default handler.
     */
    const flushWheelLines = () => {
      wheelRafRef.current = null;
      const lines = wheelPendingLinesRef.current;
      wheelPendingLinesRef.current = 0;
      if (lines !== 0) {
        try {
          term.scrollLines(lines);
        } catch {
          /* ignore */
        }
      }
    };

    const estimateRowPx = () => {
      // Prefer measured cell height from the live DOM when available
      const screen = hostRef.current?.querySelector(
        ".xterm-screen",
      ) as HTMLElement | null;
      const h = screen?.clientHeight;
      const rows = term.rows || 1;
      if (h && rows > 0) return Math.max(10, h / rows);
      return Math.max(12, TERM_FONT_SIZE * 1.15);
    };

    term.attachCustomWheelEventHandler((ev) => {
      // Let shift+wheel (horizontal) and pure horizontal gestures through
      if (ev.shiftKey) return true;
      if (ev.deltaY === 0) return true;
      if (
        Math.abs(ev.deltaX) > Math.abs(ev.deltaY) &&
        Math.abs(ev.deltaX) > 1
      ) {
        return true;
      }

      let lines = 0;
      if (ev.deltaMode === WheelEvent.DOM_DELTA_PAGE) {
        lines = ev.deltaY * Math.max(1, term.rows);
      } else if (ev.deltaMode === WheelEvent.DOM_DELTA_LINE) {
        // Discrete mouse wheel notches — keep snappy
        lines = ev.deltaY * 4;
      } else {
        // DOM_DELTA_PIXEL — macOS trackpad path
        const rowPx = estimateRowPx();
        const raw = (ev.deltaY / rowPx) * TRACKPAD_SCROLL_GAIN;
        wheelAccumRef.current += raw;
        if (Math.abs(wheelAccumRef.current) >= TRACKPAD_MIN_LINES) {
          lines =
            Math.trunc(wheelAccumRef.current) ||
            (wheelAccumRef.current > 0 ? 1 : -1);
          wheelAccumRef.current -= lines;
        }
      }

      // Scale by velocity: large |deltaY| flicks jump further in one frame
      if (ev.deltaMode === WheelEvent.DOM_DELTA_PIXEL) {
        const boost = Math.min(3, Math.abs(ev.deltaY) / 80);
        if (boost > 1 && lines !== 0) {
          lines = Math.round(lines * boost);
        }
      }

      if (lines === 0) {
        // Still consume the event so the browser does not rubber-band the pane
        ev.preventDefault();
        return false;
      }

      wheelPendingLinesRef.current += lines;
      if (wheelRafRef.current == null) {
        wheelRafRef.current = window.requestAnimationFrame(flushWheelLines);
      }
      ev.preventDefault();
      // false → xterm skips its default (low-gain) wheel handling
      return false;
    });

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
      if (wheelRafRef.current != null) {
        window.cancelAnimationFrame(wheelRafRef.current);
        wheelRafRef.current = null;
      }
      wheelAccumRef.current = 0;
      wheelPendingLinesRef.current = 0;
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
