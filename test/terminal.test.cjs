const assert = require("assert");
const { execFileSync } = require("child_process");
const {
  buildColorfulEnv,
  quoteForPosixShell,
} = require("../electron/terminal.cjs");

function testShellQuoteRoundTripsSpacesAndApostrophe() {
  const value = "/tmp/project's fake grok";
  const output = execFileSync(
    "/bin/zsh",
    ["-c", `printf %s ${quoteForPosixShell(value)}`],
    { encoding: "utf8" },
  );
  assert.strictEqual(output, value);
}

function testColorEnvRemovesMonochromeFlags() {
  const env = buildColorfulEnv({
    NO_COLOR: "1",
    NODE_DISABLE_COLORS: "1",
    CI: "true",
    FORCE_COLOR: "0",
  });
  assert.strictEqual(env.NO_COLOR, undefined);
  assert.strictEqual(env.NODE_DISABLE_COLORS, undefined);
  assert.strictEqual(env.CI, undefined);
  assert.strictEqual(env.FORCE_COLOR, "3");
  assert.strictEqual(env.COLORTERM, "truecolor");
}

function testShellQuoteRejectsNoData() {
  assert.strictEqual(quoteForPosixShell(""), "''");
  assert.strictEqual(quoteForPosixShell("grok"), "'grok'");
}

for (const test of [
  testShellQuoteRoundTripsSpacesAndApostrophe,
  testColorEnvRemovesMonochromeFlags,
  testShellQuoteRejectsNoData,
]) {
  try {
    test();
    console.log(`ok  - ${test.name}`);
  } catch (err) {
    console.error(`fail - ${test.name}`, err);
    process.exitCode = 1;
  }
}

