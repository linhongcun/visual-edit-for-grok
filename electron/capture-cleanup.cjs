/**
 * Pure capture-directory maintenance: keep newest N files and/or drop old ones.
 */
const fs = require("fs");
const path = require("path");

/**
 * @param {string} dir
 * @param {{
 *   maxFiles?: number,
 *   maxAgeMs?: number,
 *   now?: number,
 *   extensions?: string[],
 * }} [opts]
 * @returns {{ deleted: string[], kept: string[], scanned: number }}
 */
function cleanupCaptureDir(dir, opts = {}) {
  const maxFiles = opts.maxFiles ?? 80;
  const maxAgeMs = opts.maxAgeMs ?? 7 * 24 * 60 * 60 * 1000;
  const now = opts.now ?? Date.now();
  const extensions = opts.extensions ?? [".png", ".jpg", ".jpeg", ".webp"];

  if (!dir || !fs.existsSync(dir)) {
    return { deleted: [], kept: [], scanned: 0 };
  }

  /** @type {{ full: string, mtimeMs: number }[]} */
  const files = [];
  for (const name of fs.readdirSync(dir)) {
    const full = path.join(dir, name);
    let st;
    try {
      st = fs.statSync(full);
    } catch {
      continue;
    }
    if (!st.isFile()) continue;
    const ext = path.extname(name).toLowerCase();
    if (!extensions.includes(ext)) continue;
    files.push({ full, mtimeMs: st.mtimeMs });
  }

  files.sort((a, b) => b.mtimeMs - a.mtimeMs);

  const deleted = [];
  const kept = [];

  for (let i = 0; i < files.length; i++) {
    const f = files[i];
    const tooOld = maxAgeMs > 0 && now - f.mtimeMs > maxAgeMs;
    const overCap = maxFiles > 0 && i >= maxFiles;
    if (tooOld || overCap) {
      try {
        fs.unlinkSync(f.full);
        deleted.push(f.full);
      } catch {
        /* leave file if locked */
      }
    } else {
      kept.push(f.full);
    }
  }

  return { deleted, kept, scanned: files.length };
}

module.exports = { cleanupCaptureDir };
