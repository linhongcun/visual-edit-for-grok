/**
 * Unit tests for app-chrome input helpers (shipped src/input-chrome.cjs).
 * Run: node test/input-chrome.test.cjs
 */
const assert = require("assert");
const {
  shouldShowUrlClear,
  filterRecentUrls,
  filterPaletteItems,
  paletteItemMatches,
  resolveEscapeAction,
  resolveFocusedChromeEscape,
  normalizeUrlInputValue,
  resolveUrlKeyAction,
  resolveFindKeyAction,
  clampPaletteIndex,
  movePaletteIndex,
  resolvePaletteKeyAction,
} = require("../src/input-chrome.cjs");

function testShouldShowUrlClear() {
  assert.strictEqual(shouldShowUrlClear(""), false);
  assert.strictEqual(shouldShowUrlClear("  "), true);
  assert.strictEqual(shouldShowUrlClear("http://x"), true);
  assert.strictEqual(shouldShowUrlClear(null), false);
}

function testFilterRecentEmptyQueryKeepsOrder() {
  const recent = [
    "http://localhost:3000/a",
    "http://localhost:3000/b",
    "https://example.com",
  ];
  assert.deepStrictEqual(filterRecentUrls("", recent), recent);
  assert.deepStrictEqual(filterRecentUrls("  ", recent, { limit: 2 }), [
    "http://localhost:3000/a",
    "http://localhost:3000/b",
  ]);
}

function testFilterRecentRanksStartsWith() {
  const recent = [
    "https://example.com/docs",
    "http://localhost:5173/app",
    "http://localhost:3000/",
  ];
  const hit = filterRecentUrls("localhost", recent);
  assert.ok(hit.length >= 2);
  assert.ok(hit.every((u) => u.toLowerCase().includes("localhost")));
  assert.ok(hit[0].includes("localhost"));
}

function testFilterRecentPrivateModeEmpty() {
  assert.deepStrictEqual(
    filterRecentUrls("http", ["http://a", "http://b"], { privateMode: true }),
    [],
  );
}

function testFilterRecentDedupesAndDropsJunk() {
  const recent = ["http://a", "http://a", "", null, "  http://b  ", "http://b"];
  const hit = filterRecentUrls("", recent);
  assert.deepStrictEqual(hit, ["http://a", "http://b"]);
}

function testPaletteMatchAndFilter() {
  const items = [
    { id: "find", label: "Find in terminal" },
    { id: "aim", label: "Aim" },
    { id: "settings", label: "Open settings" },
  ];
  assert.strictEqual(paletteItemMatches(items[0], "find"), true);
  assert.strictEqual(paletteItemMatches(items[1], "zzz"), false);
  assert.deepStrictEqual(
    filterPaletteItems("set", items).map((i) => i.id),
    ["settings"],
  );
  assert.strictEqual(filterPaletteItems("", items).length, 3);
}

function testEscapeOrderAimWins() {
  assert.strictEqual(
    resolveEscapeAction({
      pickMode: true,
      findOpen: true,
      paletteOpen: true,
      urlFocused: true,
    }),
    "aim-cancel",
  );
}

function testEscapeOrderFindThenPaletteThenUrl() {
  assert.strictEqual(
    resolveEscapeAction({ findOpen: true, paletteOpen: true }),
    "close-find",
  );
  assert.strictEqual(
    resolveEscapeAction({ paletteOpen: true, settingsOpen: true }),
    "close-palette",
  );
  assert.strictEqual(
    resolveEscapeAction({ settingsOpen: true }),
    "close-settings",
  );
  assert.strictEqual(
    resolveEscapeAction({ shortcutsOpen: true }),
    "close-shortcuts",
  );
  assert.strictEqual(resolveEscapeAction({ urlFocused: true }), "blur-url");
  assert.strictEqual(resolveEscapeAction({}), "none");
}

function testNormalizeUrlInputValue() {
  assert.strictEqual(normalizeUrlInputValue("  http://x  "), "http://x");
  assert.strictEqual(normalizeUrlInputValue(null), "");
}

function testFocusedChromeEscDefersToAim() {
  // Local surface handlers must use this so Aim cancel wins over close/blur.
  assert.strictEqual(resolveFocusedChromeEscape("url", true), "aim-cancel");
  assert.strictEqual(resolveFocusedChromeEscape("find", true), "aim-cancel");
  assert.strictEqual(resolveFocusedChromeEscape("palette", true), "aim-cancel");
  assert.strictEqual(resolveFocusedChromeEscape("url", false), "blur-url");
  assert.strictEqual(resolveFocusedChromeEscape("find", false), "close-find");
  assert.strictEqual(
    resolveFocusedChromeEscape("palette", false),
    "close-palette",
  );
}

function testUrlEnterSubmitShiftEnterNone() {
  assert.strictEqual(resolveUrlKeyAction({ key: "Enter" }), "submit");
  assert.strictEqual(
    resolveUrlKeyAction({ key: "Enter", shiftKey: true }),
    "none",
  );
  assert.strictEqual(resolveUrlKeyAction({ key: "a" }), "none");
  assert.strictEqual(
    resolveUrlKeyAction({ key: "Enter", metaKey: true }),
    "none",
  );
}

function testFindEnterNextShiftPrev() {
  assert.strictEqual(resolveFindKeyAction({ key: "Enter" }), "find-next");
  assert.strictEqual(
    resolveFindKeyAction({ key: "Enter", shiftKey: true }),
    "find-prev",
  );
  assert.strictEqual(resolveFindKeyAction({ key: "Escape" }), "none");
}

function testPaletteArrowClampAndRun() {
  assert.strictEqual(clampPaletteIndex(-1, 3), 0);
  assert.strictEqual(clampPaletteIndex(99, 3), 2);
  assert.strictEqual(clampPaletteIndex(1, 0), -1);
  assert.strictEqual(movePaletteIndex(0, 3, "down"), 1);
  assert.strictEqual(movePaletteIndex(2, 3, "down"), 0);
  assert.strictEqual(movePaletteIndex(0, 3, "up"), 2);
  assert.strictEqual(movePaletteIndex(-1, 3, "down"), 0);
  assert.strictEqual(movePaletteIndex(-1, 3, "up"), 2);

  assert.deepStrictEqual(
    resolvePaletteKeyAction({ key: "ArrowDown" }, { index: 0, itemCount: 3 }),
    { type: "move", index: 1 },
  );
  assert.deepStrictEqual(
    resolvePaletteKeyAction({ key: "ArrowUp" }, { index: 0, itemCount: 3 }),
    { type: "move", index: 2 },
  );
  assert.deepStrictEqual(
    resolvePaletteKeyAction({ key: "Enter" }, { index: 1, itemCount: 3 }),
    { type: "run", index: 1 },
  );
  assert.deepStrictEqual(
    resolvePaletteKeyAction({ key: "Enter" }, { index: -1, itemCount: 3 }),
    { type: "run", index: 0 },
  );
  assert.deepStrictEqual(
    resolvePaletteKeyAction({ key: "Enter" }, { index: 0, itemCount: 0 }),
    { type: "none" },
  );
  assert.deepStrictEqual(
    resolvePaletteKeyAction(
      { key: "Enter", shiftKey: true },
      { index: 0, itemCount: 3 },
    ),
    { type: "none" },
  );
}

function run() {
  const tests = [
    testShouldShowUrlClear,
    testFilterRecentEmptyQueryKeepsOrder,
    testFilterRecentRanksStartsWith,
    testFilterRecentPrivateModeEmpty,
    testFilterRecentDedupesAndDropsJunk,
    testPaletteMatchAndFilter,
    testEscapeOrderAimWins,
    testEscapeOrderFindThenPaletteThenUrl,
    testNormalizeUrlInputValue,
    testFocusedChromeEscDefersToAim,
    testUrlEnterSubmitShiftEnterNone,
    testFindEnterNextShiftPrev,
    testPaletteArrowClampAndRun,
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
