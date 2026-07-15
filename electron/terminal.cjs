const os = require("os");
const path = require("path");
const fs = require("fs");
const {
  resolveGrokTermProgramIdentity,
} = require("./grok-host-policy.cjs");

/** @type {import('node-pty') | null} */
let ptyMod = null;

function loadPty() {
  if (ptyMod) return ptyMod;
  try {
    ptyMod = require("node-pty");
    return ptyMod;
  } catch (err) {
    throw new Error(
      `node-pty failed to load. Reinstall the app or run: npm run rebuild\n${err instanceof Error ? err.message : String(err)}`,
    );
  }
}

function resolveGrokBinary() {
  if (process.env.GROK_PATH && fs.existsSync(process.env.GROK_PATH)) {
    return process.env.GROK_PATH;
  }
  const home = os.homedir();
  const candidates = [
    path.join(home, ".grok", "bin", "grok"),
    path.join(home, ".local", "bin", "grok"),
    "/usr/local/bin/grok",
    "/opt/homebrew/bin/grok",
  ];
  for (const c of candidates) {
    if (fs.existsSync(c)) return c;
  }
  return "grok";
}

function quoteForPosixShell(value) {
  return `'${String(value).replace(/'/g, `'"'"'`)}'`;
}

/**
 * Build env for the embedded PTY with truecolor / 256-color forced on.
 * @param {NodeJS.ProcessEnv} base
 * @param {{ cols?: number, rows?: number }} [size]
 */
function buildColorfulEnv(base = process.env, size = {}) {
  const env = { ...base };

  // Strip flags that make apps (Grok, chalk, etc.) disable color
  delete env.NO_COLOR;
  delete env.NODE_DISABLE_COLORS;
  delete env.NODE_NO_READLINE;
  // CI often forces monochrome; Electron may inherit it from parent tools
  if (env.CI === "true" || env.CI === "1" || env.CI === "yes") {
    delete env.CI;
  }
  if (env.FORCE_COLOR === "0") {
    delete env.FORCE_COLOR;
  }

  env.TERM = "xterm-256color";
  env.COLORTERM = "truecolor";
  // chalk / supports-color level 3 = truecolor
  env.FORCE_COLOR = "3";
  env.CLICOLOR = "1";
  env.CLICOLOR_FORCE = "1";

  // Force UTF-8 so Grok / chalk measure CJK width against a Unicode-aware locale.
  // Misaligned markdown table borders often come from ASCII locale + wide CJK.
  const utf8 =
    process.platform === "darwin" || process.platform === "linux"
      ? "en_US.UTF-8"
      : "C.UTF-8";
  if (!env.LANG || !/utf-?8/i.test(env.LANG)) env.LANG = utf8;
  if (!env.LC_ALL || !/utf-?8/i.test(env.LC_ALL)) env.LC_ALL = utf8;
  if (!env.LC_CTYPE || !/utf-?8/i.test(env.LC_CTYPE)) env.LC_CTYPE = utf8;
  env.PYTHONIOENCODING = env.PYTHONIOENCODING || "utf-8";

  // Some TUI stacks read COLUMNS/LINES at startup in addition to TIOCGWINSZ.
  const cols = Number(size.cols);
  const rows = Number(size.rows);
  if (Number.isFinite(cols) && cols >= 2) {
    env.COLUMNS = String(Math.floor(cols));
  }
  if (Number.isFinite(rows) && rows >= 1) {
    env.LINES = String(Math.floor(rows));
  }

  // Grok Build terminal brand (open-source contract): Ghostty-class enables
  // native Cmd chords. Prefer pure resolveGrokTermProgramIdentity; override
  // via VEFG_TERM_PROGRAM=ghostty|grokdesktop|kitty|wezterm.
  const identity = resolveGrokTermProgramIdentity({
    parentTermProgram: env.TERM_PROGRAM,
    parentTermProgramVersion: env.TERM_PROGRAM_VERSION,
    preferredBrand: process.env.VEFG_TERM_PROGRAM || null,
  });
  env.TERM_PROGRAM = identity.termProgram;
  env.TERM_PROGRAM_VERSION = identity.termProgramVersion;
  // Surface for diagnostics without polluting Grok's public env contract.
  env.VEFG_GROK_TERM_IDENTITY = identity.reason;

  return env;
}

/**
 * Embedded PTY session for the left-pane terminal.
 */
class TerminalSession {
  /**
   * @param {{
   *   cwd?: string,
   *   onData?: (data: string) => void,
   *   onExit?: (code: number, signal?: number) => void,
   * }} options
   */
  constructor(options = {}) {
    this.cwd = options.cwd || process.cwd();
    this.onData = options.onData || (() => {});
    this.onExit = options.onExit || (() => {});
    /** @type {import('node-pty').IPty | null} */
    this.pty = null;
    /** @type {"shell" | "grok" | null} */
    this.mode = null;
    this.cols = 80;
    this.rows = 24;
  }

  isAlive() {
    return Boolean(this.pty);
  }

  isGrokAlive() {
    return Boolean(this.pty && this.mode === "grok");
  }

  getMode() {
    return this.pty ? this.mode : null;
  }

  /**
   * Replace the current PTY with a concrete program. Keeping the child identity
   * in the exit callback prevents a late exit from an old process from marking
   * a newly-started PTY as dead.
   * @param {string} program
   * @param {string[]} args
   * @param {{ cwd?: string, cols?: number, rows?: number, mode: "shell" | "grok" }} opts
   */
  spawnProgram(program, args, opts) {
    this.dispose();
    if (opts.cwd) this.cwd = opts.cwd;
    if (opts.cols) this.cols = opts.cols;
    if (opts.rows) this.rows = opts.rows;

    const pty = loadPty();
    const child = pty.spawn(program, args, {
      name: "xterm-256color",
      cols: this.cols,
      rows: this.rows,
      cwd: this.cwd,
      env: buildColorfulEnv(process.env, {
        cols: this.cols,
        rows: this.rows,
      }),
    });

    this.pty = child;
    this.mode = opts.mode;
    child.onData((data) => {
      if (this.pty === child) this.onData(data);
    });
    child.onExit(({ exitCode, signal }) => {
      if (this.pty !== child) return;
      const mode = this.mode;
      this.pty = null;
      this.mode = null;
      this.onExit(exitCode ?? 0, signal, mode);
    });

    // Re-assert winsize after spawn (some children snapshot size only once).
    try {
      child.resize(this.cols, this.rows);
    } catch {
      /* ignore */
    }

    return { cwd: this.cwd, program, mode: this.mode };
  }

  /**
   * @param {{ cwd?: string, cols?: number, rows?: number }} [opts]
   */
  start(opts = {}) {
    const shell =
      process.env.SHELL ||
      (process.platform === "win32" ? "powershell.exe" : "/bin/zsh");
    const result = this.spawnProgram(shell, ["-l"], {
      ...opts,
      mode: "shell",
    });
    return { ...result, shell };
  }

  /**
   * @param {string} data
   */
  write(data) {
    if (!this.pty) return false;
    this.pty.write(data);
    return true;
  }

  /**
   * Paste multiline text using bracketed-paste when possible (works better with TUIs).
   * @param {string} text
   */
  paste(text) {
    if (!this.pty) return false;
    // Bracketed paste: many TUIs (incl. modern CLIs) treat this as a paste block
    this.pty.write(`\x1b[200~${text}\x1b[201~`);
    return true;
  }

  /**
   * Run a command line and press Enter.
   * @param {string} command
   */
  runCommand(command) {
    if (!this.pty) return false;
    this.pty.write(`${command}\r`);
    return true;
  }

  launchGrok(opts = {}) {
    if (this.isGrokAlive()) {
      return { cwd: this.cwd, program: resolveGrokBinary(), mode: "grok", alreadyRunning: true };
    }
    const bin = resolveGrokBinary();
    const shell =
      process.env.SHELL ||
      (process.platform === "win32" ? "powershell.exe" : "/bin/zsh");
    const useLoginShell = process.platform !== "win32";
    const program = useLoginShell ? shell : bin;
    const args = useLoginShell
      ? ["-ilc", `exec ${quoteForPosixShell(bin)}`]
      : [];
    return {
      ...this.spawnProgram(program, args, {
        cwd: opts.cwd || this.cwd,
        cols: opts.cols || this.cols,
        rows: opts.rows || this.rows,
        mode: "grok",
      }),
      program: bin,
      alreadyRunning: false,
    };
  }

  /**
   * @param {number} cols
   * @param {number} rows
   */
  resize(cols, rows) {
    this.cols = Math.max(2, cols | 0);
    this.rows = Math.max(1, rows | 0);
    if (this.pty) {
      try {
        this.pty.resize(this.cols, this.rows);
      } catch {
        /* ignore */
      }
    }
  }

  setCwd(cwd) {
    if (typeof cwd === "string" && fs.existsSync(cwd)) {
      this.cwd = cwd;
      return true;
    }
    return false;
  }

  dispose() {
    if (this.pty) {
      const child = this.pty;
      this.pty = null;
      this.mode = null;
      try {
        child.kill();
      } catch {
        /* ignore */
      }
    }
  }
}

module.exports = {
  TerminalSession,
  resolveGrokBinary,
  buildColorfulEnv,
  quoteForPosixShell,
};
