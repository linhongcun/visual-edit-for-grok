import { useEffect, useRef } from "react";
import { Terminal } from "@xterm/xterm";
import { FitAddon } from "@xterm/addon-fit";
import { WebLinksAddon } from "@xterm/addon-web-links";
import "@xterm/xterm/css/xterm.css";

interface Props {
  active: boolean;
  /** Increment to force focus into the Grok/xterm input */
  focusNonce?: number;
}

export default function TerminalPane({ active, focusNonce = 0 }: Props) {
  const hostRef = useRef<HTMLDivElement>(null);
  const termRef = useRef<Terminal | null>(null);
  const fitRef = useRef<FitAddon | null>(null);
  const startedRef = useRef(false);
  /** Single pending deferred focus timer — avoid multi-timeout storms */
  const focusTimerRef = useRef<number | null>(null);

  function clearFocusTimer() {
    if (focusTimerRef.current != null) {
      window.clearTimeout(focusTimerRef.current);
      focusTimerRef.current = null;
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

  useEffect(() => {
    if (!hostRef.current || !window.vefg) return;

    const term = new Terminal({
      cursorBlink: true,
      fontSize: 13,
      fontFamily:
        '"SF Mono", "JetBrains Mono", Menlo, Monaco, Consolas, monospace',
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
    });

    const fit = new FitAddon();
    term.loadAddon(fit);
    term.loadAddon(new WebLinksAddon());
    term.open(hostRef.current);
    fit.fit();

    termRef.current = term;
    fitRef.current = fit;

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
      fit.fit();
      const dims = { cols: term.cols, rows: term.rows };
      try {
        await window.vefg.terminalStart(dims);
        startedRef.current = true;
      } catch (err) {
        term.writeln(
          `\x1b[31mTerminal failed to start: ${err instanceof Error ? err.message : String(err)}\x1b[0m`,
        );
        term.writeln("\x1b[90mFrom the project folder run: npm run rebuild\x1b[0m");
      }
    };

    void start();

    const ro = new ResizeObserver(() => {
      try {
        fit.fit();
        if (startedRef.current) {
          void window.vefg.terminalResize({ cols: term.cols, rows: term.rows });
        }
      } catch {
        /* ignore */
      }
    });
    ro.observe(hostRef.current);

    return () => {
      clearFocusTimer();
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
    requestAnimationFrame(() => {
      try {
        fitRef.current?.fit();
        const term = termRef.current;
        if (term && startedRef.current) {
          void window.vefg.terminalResize({ cols: term.cols, rows: term.rows });
        }
      } catch {
        /* ignore */
      }
    });
  }, [active]);

  // Parent bumps focusNonce after Start Grok (not after every deliver — main owns that)
  useEffect(() => {
    if (!focusNonce) return;
    scheduleFocus();
    return () => clearFocusTimer();
  }, [focusNonce]);

  return <div className="terminal-host" ref={hostRef} tabIndex={0} />;
}
