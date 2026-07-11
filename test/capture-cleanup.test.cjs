/**
 * Unit tests for capture-dir cleanup (shipped electron/capture-cleanup.cjs).
 */
const assert = require("assert");
const fs = require("fs");
const os = require("os");
const path = require("path");
const { cleanupCaptureDir } = require("../electron/capture-cleanup.cjs");

function makeDir() {
  const dir = path.join(
    os.tmpdir(),
    `vefg-cleanup-${Date.now()}-${Math.random().toString(16).slice(2)}`,
  );
  fs.mkdirSync(dir, { recursive: true });
  return dir;
}

function touch(file, mtimeMs) {
  fs.writeFileSync(file, "x");
  const d = new Date(mtimeMs);
  fs.utimesSync(file, d, d);
}

function testMaxFilesKeepsNewest() {
  const dir = makeDir();
  const now = Date.now();
  try {
    touch(path.join(dir, "old.png"), now - 5000);
    touch(path.join(dir, "mid.png"), now - 3000);
    touch(path.join(dir, "new.png"), now - 1000);
    touch(path.join(dir, "readme.txt"), now); // ignored ext

    const res = cleanupCaptureDir(dir, {
      maxFiles: 2,
      maxAgeMs: 0,
      now,
    });
    assert.strictEqual(res.scanned, 3);
    assert.strictEqual(res.deleted.length, 1);
    assert.ok(res.deleted[0].endsWith("old.png"));
    assert.ok(fs.existsSync(path.join(dir, "new.png")));
    assert.ok(fs.existsSync(path.join(dir, "mid.png")));
    assert.ok(fs.existsSync(path.join(dir, "readme.txt")));
  } finally {
    fs.rmSync(dir, { recursive: true, force: true });
  }
}

function testMaxAgeDeletesOld() {
  const dir = makeDir();
  const now = Date.now();
  try {
    touch(path.join(dir, "ancient.png"), now - 10 * 24 * 60 * 60 * 1000);
    touch(path.join(dir, "fresh.png"), now - 1000);
    const res = cleanupCaptureDir(dir, {
      maxFiles: 100,
      maxAgeMs: 7 * 24 * 60 * 60 * 1000,
      now,
    });
    assert.ok(res.deleted.some((p) => p.endsWith("ancient.png")));
    assert.ok(fs.existsSync(path.join(dir, "fresh.png")));
  } finally {
    fs.rmSync(dir, { recursive: true, force: true });
  }
}

function testMissingDir() {
  const res = cleanupCaptureDir("/tmp/vefg-no-such-dir-xyz", {});
  assert.deepStrictEqual(res, { deleted: [], kept: [], scanned: 0 });
}

function run() {
  const tests = [
    testMaxFilesKeepsNewest,
    testMaxAgeDeletesOld,
    testMissingDir,
  ];
  let failed = 0;
  for (const t of tests) {
    try {
      t();
      console.log(`ok  - ${t.name}`);
    } catch (err) {
      failed += 1;
      console.error(`fail - ${t.name}`, err);
    }
  }
  console.log(`\n${tests.length - failed}/${tests.length} passed`);
  if (failed) process.exit(1);
}

run();
