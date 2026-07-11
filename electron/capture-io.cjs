const childProcess = require("child_process");
const fs = require("fs");
const path = require("path");

const DEFAULT_OSASCRIPT_TIMEOUT_MS = 4_000;

// The file path is passed as argv, never interpolated into AppleScript source.
const SET_FILE_CLIPBOARD_SCRIPT = [
  "on run argv",
  "  set the clipboard to (POSIX file (item 1 of argv))",
  "end run",
].join("\n");

function timeoutError(timeoutMs) {
  const error = new Error(`osascript timed out after ${timeoutMs}ms`);
  error.code = "ETIMEDOUT";
  return error;
}

/**
 * Callback-style execFile wrapped with a hard timeout. The explicit timer also
 * protects tests/injected implementations that ignore Node's timeout option.
 *
 * @param {typeof childProcess.execFile} execFileImpl
 * @param {string} file
 * @param {string[]} args
 * @param {{ timeout: number }} options
 */
function execFileWithTimeout(execFileImpl, file, args, options) {
  return new Promise((resolve, reject) => {
    let child = null;
    let timer = null;
    let settled = false;

    const finish = (error, value) => {
      if (settled) return;
      settled = true;
      if (timer) clearTimeout(timer);
      if (error) reject(error);
      else resolve(value);
    };

    try {
      child = execFileImpl(file, args, options, (error, stdout, stderr) => {
        if (error) {
          if (error.code === "ETIMEDOUT" || error.killed === true) {
            finish(timeoutError(options.timeout));
          } else {
            finish(error);
          }
          return;
        }
        finish(null, { stdout, stderr });
      });
    } catch (error) {
      finish(error);
    }

    if (!settled) {
      timer = setTimeout(() => {
        if (settled) return;
        // Claim the result before kill: a child implementation may invoke its
        // callback synchronously from kill(), but the timeout must still win.
        settled = true;
        const error = timeoutError(options.timeout);
        try {
          child?.kill?.();
        } catch {
          // Best effort: the timeout result remains deterministic.
        }
        reject(error);
      }, options.timeout);
    }
  });
}

/**
 * Put a file reference on the macOS clipboard without blocking Electron's main
 * event loop. Structured failures let callers fall back to nativeImage.
 *
 * @param {string} filePath
 * @param {{
 *   execFile?: typeof childProcess.execFile,
 *   timeoutMs?: number,
 *   platform?: NodeJS.Platform | string,
 * }} [opts]
 * @returns {Promise<{ ok: true, method: "osascript" } | { ok: false, reason: string, error?: Error }>}
 */
async function copyFileToMacClipboard(filePath, opts = {}) {
  const platform = opts.platform ?? process.platform;
  if (platform !== "darwin") {
    return { ok: false, reason: "unsupported-platform" };
  }
  if (typeof filePath !== "string" || !path.isAbsolute(filePath)) {
    return { ok: false, reason: "invalid-path" };
  }

  const requestedTimeout = Number(opts.timeoutMs);
  const timeoutMs =
    Number.isFinite(requestedTimeout) && requestedTimeout > 0
      ? Math.floor(requestedTimeout)
      : DEFAULT_OSASCRIPT_TIMEOUT_MS;
  const execFileImpl = opts.execFile || childProcess.execFile;

  try {
    await execFileWithTimeout(
      execFileImpl,
      "osascript",
      ["-e", SET_FILE_CLIPBOARD_SCRIPT, filePath],
      { timeout: timeoutMs },
    );
    return { ok: true, method: "osascript" };
  } catch (error) {
    const normalized =
      error instanceof Error ? error : new Error(String(error));
    return {
      ok: false,
      reason:
        normalized.code === "ETIMEDOUT" ? "timeout" : "osascript-failed",
      error: normalized,
    };
  }
}

/**
 * Create or tighten an existing directory used for sensitive screenshots.
 *
 * @param {string} dirPath
 * @param {{ fs?: typeof fs.promises }} [opts]
 */
async function ensurePrivateDirectory(dirPath, opts = {}) {
  if (typeof dirPath !== "string" || !path.isAbsolute(dirPath)) {
    throw new TypeError("Private directory path must be absolute");
  }
  const io = opts.fs || fs.promises;
  await io.mkdir(dirPath, { recursive: true, mode: 0o700 });
  // mkdir's mode does not affect an existing directory.
  await io.chmod(dirPath, 0o700);
  return dirPath;
}

/**
 * Write a new PNG asynchronously with private permissions. `wx` rejects an
 * existing file or symlink instead of overwriting it.
 *
 * @param {string} filePath
 * @param {Buffer | Uint8Array} pngBytes
 * @param {{ fs?: typeof fs.promises }} [opts]
 * @returns {Promise<{ path: string, bytes: number }>}
 */
async function writePrivatePng(filePath, pngBytes, opts = {}) {
  if (
    typeof filePath !== "string" ||
    !path.isAbsolute(filePath) ||
    path.extname(filePath).toLowerCase() !== ".png"
  ) {
    throw new TypeError("PNG path must be an absolute .png path");
  }
  if (!(pngBytes instanceof Uint8Array) || pngBytes.byteLength === 0) {
    throw new TypeError("PNG bytes must be a non-empty Buffer or Uint8Array");
  }

  const io = opts.fs || fs.promises;
  const dirPath = path.dirname(filePath);
  await ensurePrivateDirectory(dirPath, { fs: io });

  let written = false;
  try {
    await io.writeFile(filePath, pngBytes, { flag: "wx", mode: 0o600 });
    written = true;
    // Defend against permissive umasks or platform-specific write defaults.
    await io.chmod(filePath, 0o600);
  } catch (error) {
    if (written) {
      try {
        await io.unlink(filePath);
      } catch {
        // Preserve the original failure; scheduled cleanup can retry later.
      }
    }
    throw error;
  }

  return { path: filePath, bytes: pngBytes.byteLength };
}

module.exports = {
  DEFAULT_OSASCRIPT_TIMEOUT_MS,
  SET_FILE_CLIPBOARD_SCRIPT,
  copyFileToMacClipboard,
  ensurePrivateDirectory,
  writePrivatePng,
};
