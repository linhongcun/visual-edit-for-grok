import { useEffect, useRef } from "react";
import { Terminal } from "@xterm/xterm";
import { FitAddon } from "@xterm/addon-fit";
import { WebLinksAddon } from "@xterm/addon-web-links";
import { Unicode11Addon } from "@xterm/addon-unicode11";
import { WebglAddon } from "@xterm/addon-webgl";
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
  active: boolean;
  /** Increment to force focus into the Grok/xterm input */
  focusNonce?: number;
  /** Increment after splitter / layout settle to force fit + PTY resize */
  fitNonce?: number;
}

export default function TerminalPane({
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
        void window.vefg.terminalResize({ cols, rows });
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
    if (!hostRef.current || !window.vefg) return;

    const term = new Terminal({
      cursorBlink: true,
      fontSize: TERM_FONT_SIZE,
      fontFamily: TERM_FONT_FAMILY,
      // Integer cell metrics reduce box-drawing drift with CJK double-width cells
      lineHeight: 1.2,
      letterSpacing: 0,
      // Draw box-drawing / powerline glyphs on canvas for cleaner table borders
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
      scrollback: 8000,
      convertEol: false,
      windowsMode: false,
      // Reduce glyph overlap artifacts that make table borders look “broken”
      rescaleOverlappingGlyphs: true,
    });

    const fit = new FitAddon();
    term.loadAddon(fit);
    // Unicode 11 widths match modern TUI / CJK East Asian Width better than default v6
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
    // WebGL renderer: crisper box-drawing; fall back to canvas if GPU path fails
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

    const onData = window.vefg.on("terminal:data", (payload) => {
      term.write(String(payload ?? ""));
    });

    const onExit = window.vefg.on("terminal:exit", (payload) => {
      const { code } = payload as { code: number };
      term.writeln(
        `\r\n\x1b[90m[process exited: ${code}]  Use “Reset term” to restart.\x1b[0m\r\n`,
      );
      startedRef.current = false;
    });

    // Main process is the owner of post-deliver focus; respond once per request
    const onFocusReq = window.vefg.on("terminal:focus-request", () => {
      scheduleFocus();
    });

    term.onData((data) => {
      void window.vefg.terminalWrite(data);
    });

    const start = async () => {
      fitAndSyncPty(true);
      const dims = { cols: term.cols, rows: term.rows };
      try {
        await window.vefg.terminalStart(dims);
        startedRef.current = true;
        // Second fit after layout paints (titlebar / split settle)
        requestAnimationFrame(() => fitAndSyncPty(true));
      } catch (err) {
        term.writeln(
          `\x1b[31mTerminal failed to start: ${err instanceof Error ? err.message : String(err)}\x1b[0m`,
        );
        term.writeln("\x1b[90mFrom the project folder run: npm run rebuild\x1b[0m");
      }
    };

    void start();

    const ro = new ResizeObserver(() => {
      // Debounce while dragging the splitter; still sync soon enough for live feel
      scheduleFit(false, 40);
    });
    ro.observe(hostRef.current);

    return () => {
      clearFocusTimer();
      clearResizeTimer();
      onData();
      onExit();
      onFocusReq();
      ro.disconnect();
      term.dispose();
      termRef.current = null;
      fitRef.current = null;
    };
  }, []);

  useEffect(() => {
    if (!active) return;
    requestAnimationFrame(() => fitAndSyncPty(true));
  }, [active]);

  // Parent bumps focusNonce after Start Grok (not after every deliver — main owns that)
  useEffect(() => {
    if (!focusNonce) return;
    scheduleFocus();
    return () => clearFocusTimer();
  }, [focusNonce]);

  // Splitter mouseup / keyboard resize / window layout settle
  useEffect(() => {
    if (!fitNonce) return;
    // Double rAF: wait for CSS width to apply, then fit + SIGWINCH-equivalent
    requestAnimationFrame(() => {
      requestAnimationFrame(() => {
        fitAndSyncPty(true);
        // One more pass after fonts/layout settle (CJK mono fallback)
        window.setTimeout(() => fitAndSyncPty(true), 80);
      });
    });
  }, [fitNonce]);

  return (
    <div
      className="terminal-host"
      ref={hostRef}
      tabIndex={0}
      aria-label="Interactive Grok terminal"
    />
  );
}
