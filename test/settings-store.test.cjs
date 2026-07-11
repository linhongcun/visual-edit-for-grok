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
  SETTINGS_VERSION,
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

function testMigratesLegacyDemoDefaultToWelcome() {
  const migrated = normalizeSettings({
    previewUrl: "http://127.0.0.1:8765",
    projectCwd: "/tmp/project",
  });
  assert.strictEqual(migrated.settingsVersion, SETTINGS_VERSION);
  assert.strictEqual(migrated.previewUrl, "");
  assert.strictEqual(migrated.projectCwd, "/tmp/project");

  const explicitCurrent = normalizeSettings({
    settingsVersion: SETTINGS_VERSION,
    previewUrl: "http://127.0.0.1:8765",
  });
  assert.strictEqual(explicitCurrent.previewUrl, "http://127.0.0.1:8765");
}

function testRoundTrip() {
  const file = tmpFile();
  try {
    const saved = saveSettings(file, {
      previewUrl: "http://127.0.0.1:5173/foo",
      projectCwd: "/Users/me/app",
      splitRatio: 0.4,
      recentPreviewUrls: [
        "http://127.0.0.1:5173/foo",
        "https://example.com/app",
      ],
      recentProjectCwds: ["/Users/me/app", "/tmp/other"],
    });
    assert.strictEqual(saved.previewUrl, "http://127.0.0.1:5173/foo");
    const loaded = loadSettings(file);
    assert.deepStrictEqual(loaded, {
      settingsVersion: SETTINGS_VERSION,
      previewUrl: "http://127.0.0.1:5173/foo",
      projectCwd: "/Users/me/app",
      splitRatio: 0.4,
      locale: "",
      previewCollapsed: false,
      recentPreviewUrls: [
        "http://127.0.0.1:5173/foo",
        "https://example.com/app",
      ],
      recentProjectCwds: ["/Users/me/app", "/tmp/other"],
    });
  } finally {
    try {
      fs.unlinkSync(file);
    } catch {
      /* ignore */
    }
  }
}

function testRecentListsAreDedupedAndCapped() {
  const s = normalizeSettings({
    recentPreviewUrls: [
      "http://localhost:3000/",
      "http://localhost:3000/",
      "javascript:alert(1)",
      ...Array.from({ length: 10 }, (_, index) => `https://example.com/${index}`),
    ],
    recentProjectCwds: ["/tmp/a", "/tmp/a", "/tmp/b"],
  });
  assert.strictEqual(s.recentPreviewUrls.length, 8);
  assert.strictEqual(s.recentPreviewUrls[0], "http://localhost:3000/");
  assert.deepStrictEqual(s.recentProjectCwds, ["/tmp/a", "/tmp/b"]);
}

function testLocaleNormalize() {
  assert.strictEqual(normalizeSettings({ locale: "zh" }).locale, "zh");
  assert.strictEqual(normalizeSettings({ locale: "zh-CN" }).locale, "zh");
  assert.strictEqual(normalizeSettings({ locale: "en-US" }).locale, "en");
  assert.strictEqual(normalizeSettings({ locale: "fr" }).locale, "");
}

function testPreviewCollapsedPersists() {
  assert.strictEqual(DEFAULTS.previewCollapsed, false);
  assert.strictEqual(
    normalizeSettings({ previewCollapsed: true }).previewCollapsed,
    true,
  );
  assert.strictEqual(
    normalizeSettings({ previewCollapsed: "yes" }).previewCollapsed,
    false,
  );
  const file = tmpFile();
  try {
    saveSettings(file, { previewCollapsed: true });
    assert.strictEqual(loadSettings(file).previewCollapsed, true);
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
    testMigratesLegacyDemoDefaultToWelcome,
    testRoundTrip,
    testMissingFileDefaults,
    testDefaultPath,
    testRecentListsAreDedupedAndCapped,
    testLocaleNormalize,
    testPreviewCollapsedPersists,
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
