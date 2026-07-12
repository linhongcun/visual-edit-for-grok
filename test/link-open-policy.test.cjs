const assert = require("assert");
const {
  preferSystemBrowserForLinkClick,
  isHttpUrl,
  resolveTerminalLinkTarget,
} = require("../src/link-open-policy.cjs");

function testPlainClickOpensPreview() {
  assert.strictEqual(
    resolveTerminalLinkTarget("http://localhost:3004/zh/", {}),
    "preview",
  );
  assert.strictEqual(
    resolveTerminalLinkTarget("https://example.com", { metaKey: false }),
    "preview",
  );
}

function testCmdClickOpensSystemBrowser() {
  assert.strictEqual(
    resolveTerminalLinkTarget("http://localhost:3004/a", { metaKey: true }),
    "system",
  );
  assert.strictEqual(
    resolveTerminalLinkTarget("https://example.com", { ctrlKey: true }),
    "system",
  );
  assert.strictEqual(
    preferSystemBrowserForLinkClick({
      getModifierState: (k) => k === "Meta",
    }),
    true,
  );
}

function testNonHttpIsNone() {
  assert.strictEqual(isHttpUrl("mailto:a@b.com"), false);
  assert.strictEqual(
    resolveTerminalLinkTarget("mailto:a@b.com", { metaKey: true }),
    "none",
  );
}

function run() {
  const tests = [
    testPlainClickOpensPreview,
    testCmdClickOpensSystemBrowser,
    testNonHttpIsNone,
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
