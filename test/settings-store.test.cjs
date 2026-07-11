/**
 * Unit tests for settings persistence (shipped electron/settings-store.cjs).
 * Run: node test/settings-store.test.cjs
 */
const assert = require("assert");
const fs = require("fs");
const os = require("os");
const path = require("path");
const {
  loadSettings,
  saveSettings,
  normalizeSettings,
  DEFAULTS,
  defaultSettingsPath,
} = require("../electron/settings-store.cjs");

function tmpFile() {
  return path.join(
    os.tmpdir(),
    `vefg-settings-${Date.now()}-${Math.random().toString(16).slice(2)}.json`,
  );
}

function testNormalizeClampsSplit() {
  const s = normalizeSettings({
    previewUrl: "http://localhost:3000/app",
    projectCwd: "/tmp/proj",
    splitRatio: 0.99,
  });
  assert.strictEqual(s.previewUrl, "http://localhost:3000/app");
  assert.strictEqual(s.projectCwd, "/tmp/proj");
  assert.ok(s.splitRatio <= 0.75);
  assert.ok(s.splitRatio >= 0.22);
}

function testNormalizeRejectsBadUrl() {
  const s = normalizeSettings({ previewUrl: "javascript:alert(1)" });
  assert.strictEqual(s.previewUrl, DEFAULTS.previewUrl);
}

function testRoundTrip() {
  const file = tmpFile();
  try {
    const saved = saveSettings(file, {
      previewUrl: "http://127.0.0.1:5173/foo",
      projectCwd: "/Users/me/app",
      splitRatio: 0.4,
    });
    assert.strictEqual(saved.previewUrl, "http://127.0.0.1:5173/foo");
    const loaded = loadSettings(file);
    assert.deepStrictEqual(loaded, {
      previewUrl: "http://127.0.0.1:5173/foo",
      projectCwd: "/Users/me/app",
      splitRatio: 0.4,
    });
  } finally {
    try {
      fs.unlinkSync(file);
    } catch {
      /* ignore */
    }
  }
}

function testMissingFileDefaults() {
  const file = path.join(os.tmpdir(), `vefg-missing-${Date.now()}.json`);
  const s = loadSettings(file);
  assert.deepStrictEqual(s, { ...DEFAULTS });
}

function testDefaultPath() {
  const p = defaultSettingsPath("/tmp/userdata");
  assert.ok(p.includes("visual-capture-settings.json"));
  assert.ok(p.startsWith("/tmp/userdata"));
}

function run() {
  const tests = [
    testNormalizeClampsSplit,
    testNormalizeRejectsBadUrl,
    testRoundTrip,
    testMissingFileDefaults,
    testDefaultPath,
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
