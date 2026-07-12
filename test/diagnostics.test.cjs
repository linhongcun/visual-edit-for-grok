const assert = require("assert");
const {
  sanitizeDiagnosticUrl,
  sanitizeErrorText,
  buildDiagnosticSummary,
  formatDiagnosticSummary,
} = require("../electron/diagnostics.cjs");

function testUrlDropsCredentialsQueryAndHash() {
  assert.strictEqual(
    sanitizeDiagnosticUrl("https://user:pass@example.com/a?token=secret#private"),
    "https://example.com/a",
  );
}

function testErrorRedactsSecretsAndUrlQuery() {
  const text = sanitizeErrorText(
    "failed https://example.com/a?token=x api_key=abc123",
  );
  assert.doesNotMatch(text, /abc123|token=x/);
  assert.match(text, /\[REDACTED\]/);
}

function testSummaryOmitsCwdAndTerminalText() {
  const summary = buildDiagnosticSummary({
    appVersion: "0.6.0",
    preview: { url: "http://localhost:5173/?secret=x" },
    sessions: [
      {
        id: "term-123456789",
        label: "project",
        cwd: "/Users/private/project",
        cwdValid: true,
        shellAlive: true,
        terminalText: "sensitive output",
      },
    ],
  });
  const text = JSON.stringify(summary);
  assert.doesNotMatch(text, /Users\/private|sensitive output|secret=x/);
  assert.strictEqual(summary.sessions[0].cwdValid, true);
}

function testFormattedSummaryIsJson() {
  const parsed = JSON.parse(formatDiagnosticSummary({ appVersion: "0.6.0" }));
  assert.strictEqual(parsed.app.version, "0.6.0");
}

function testSummaryIncludesHealthWhenProvided() {
  const summary = buildDiagnosticSummary({
    appVersion: "0.8.10",
    health: {
      ok: false,
      at: "2026-01-01T00:00:00.000Z",
      notes: ["preview-error", "actionable-errors"],
      lastActionableCode: "preview-crash",
      rings: { faults: 1, network: 2, stability: 3, actionable: 1 },
    },
  });
  assert.ok(summary.health);
  assert.strictEqual(summary.health.ok, false);
  assert.ok(summary.health.notes.includes("preview-error"));
  assert.strictEqual(summary.health.lastActionableCode, "preview-crash");
}

const tests = [
  testUrlDropsCredentialsQueryAndHash,
  testErrorRedactsSecretsAndUrlQuery,
  testSummaryOmitsCwdAndTerminalText,
  testFormattedSummaryIsJson,
  testSummaryIncludesHealthWhenProvided,
];
let failed = 0;
for (const test of tests) {
  try {
    test();
    console.log(`ok  - ${test.name}`);
  } catch (error) {
    failed += 1;
    console.error(`fail - ${test.name}`, error);
  }
}
console.log(`\n${tests.length - failed}/${tests.length} passed`);
if (failed) process.exit(1);
