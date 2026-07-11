const os = require("os");
const path = require("path");
const fs = require("fs");

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

/**
 * Build env for the embedded PTY with truecolor / 256-color forced on.
 * @param {NodeJS.ProcessEnv} base
 */
function buildColorfulEnv(base = process.env) {
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

  // Help TUI detectors that key off terminal identity (not Warp-specific)
  if (!env.TERM_PROGRAM || env.TERM_PROGRAM === "Apple_Terminal") {
    env.TERM_PROGRAM = "iTerm.app";
  }
  if (!env.TERM_PROGRAM_VERSION) {
    env.TERM_PROGRAM_VERSION = "3.5.0";
  }

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
    this.cols = 80;
    this.rows = 24;
  }

  isAlive() {
    return Boolean(this.pty);
  }

  /**
   * @param {{ cwd?: string, cols?: number, rows?: number }} [opts]
   */
  start(opts = {}) {
    this.dispose();
    if (opts.cwd) this.cwd = opts.cwd;
    if (opts.cols) this.cols = opts.cols;
    if (opts.rows) this.rows = opts.rows;

    const pty = loadPty();
    const shell =
      process.env.SHELL ||
      (process.platform === "win32" ? "powershell.exe" : "/bin/zsh");

    // Force truecolor so Grok TUI (and chalk-style apps) match Warp/iTerm,
    // not monochrome fallback when Electron inherits NO_COLOR/CI from the parent.
    const env = buildColorfulEnv(process.env);

    this.pty = pty.spawn(shell, ["-l"], {
      name: "xterm-256color",
      cols: this.cols,
      rows: this.rows,
      cwd: this.cwd,
      env,
    });

    this.pty.onData((data) => this.onData(data));
    this.pty.onExit(({ exitCode, signal }) => {
      this.pty = null;
      this.onExit(exitCode ?? 0, signal);
    });

    return { cwd: this.cwd, shell };
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

  launchGrok() {
    const bin = resolveGrokBinary();
    // Quote if path has spaces
    const cmd = bin.includes(" ") ? `"${bin}"` : bin;
    return this.runCommand(cmd);
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
      try {
        this.pty.kill();
      } catch {
        /* ignore */
      }
      this.pty = null;
    }
  }
}

module.exports = { TerminalSession, resolveGrokBinary, buildColorfulEnv };
