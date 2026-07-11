/**
 * Unit tests for multi-terminal session registry (shipped terminal-hub.cjs).
 */
const assert = require("assert");
const {
  MAX_TERMINAL_SESSIONS,
  labelFromCwd,
  createSessionMeta,
  canCreateSession,
  nextActiveAfterClose,
  normalizeSessionList,
  sessionsSnapshot,
  anySessionAlive,
  displayLabelForTab,
  withDisplayLabels,
  shouldConfirmCloseTab,
} = require("../electron/terminal-hub.cjs");

function testLabelFromCwd() {
  assert.strictEqual(labelFromCwd("/Users/me/my-app"), "my-app");
  assert.strictEqual(labelFromCwd(""), "Terminal");
  assert.strictEqual(labelFromCwd(null), "Terminal");
}

function testCreateSessionMeta() {
  const a = createSessionMeta({ cwd: "/tmp/proj" });
  assert.ok(a.id.startsWith("term-"));
  assert.strictEqual(a.cwd, "/tmp/proj");
  assert.strictEqual(a.label, "proj");
  const b = createSessionMeta({ id: "term-fixed", cwd: "/x", label: "Custom" });
  assert.strictEqual(b.id, "term-fixed");
  assert.strictEqual(b.label, "Custom");
}

function testCanCreateSessionCap() {
  assert.strictEqual(canCreateSession(0).ok, true);
  assert.strictEqual(canCreateSession(MAX_TERMINAL_SESSIONS - 1).ok, true);
  assert.strictEqual(canCreateSession(MAX_TERMINAL_SESSIONS).ok, false);
  assert.strictEqual(canCreateSession(MAX_TERMINAL_SESSIONS).reason, "max-sessions");
}

function testNextActiveAfterClose() {
  const ids = ["a", "b", "c"];
  assert.strictEqual(nextActiveAfterClose(ids, "b", "b"), "a");
  assert.strictEqual(nextActiveAfterClose(ids, "a", "a"), "b");
  assert.strictEqual(nextActiveAfterClose(ids, "c", "c"), "b");
  assert.strictEqual(nextActiveAfterClose(ids, "a", "b"), "a");
  assert.strictEqual(nextActiveAfterClose(["only"], "only", "only"), null);
}

function testNormalizeSessionList() {
  const empty = normalizeSessionList([], "/home/work");
  assert.strictEqual(empty.sessions.length, 1);
  assert.strictEqual(empty.sessions[0].cwd, "/home/work");
  assert.strictEqual(empty.activeId, empty.sessions[0].id);

  const multi = normalizeSessionList(
    [
      { id: "t1", cwd: "/a", label: "A" },
      { id: "t1", cwd: "/dup" },
      { id: "t2", cwd: "/b" },
    ],
    "/fallback",
  );
  assert.strictEqual(multi.sessions.length, 2);
  assert.strictEqual(multi.sessions[0].id, "t1");
  assert.strictEqual(multi.sessions[1].cwd, "/b");
}

function testSessionsSnapshotAndAlive() {
  const snap = sessionsSnapshot(
    [
      {
        id: "t1",
        cwd: "/a",
        label: "A",
        shellAlive: true,
        grokRunning: false,
        mode: "shell",
      },
      {
        id: "t2",
        cwd: "/b",
        label: "B",
        shellAlive: true,
        grokRunning: true,
        mode: "grok",
      },
    ],
    "t2",
  );
  assert.strictEqual(snap.activeId, "t2");
  assert.strictEqual(snap.sessions[1].grokRunning, true);
  assert.strictEqual(snap.maxSessions, MAX_TERMINAL_SESSIONS);
  assert.ok(snap.sessions[0].displayLabel);
  assert.strictEqual(
    anySessionAlive([
      { shellAlive: false, grokRunning: false },
      { shellAlive: true },
    ]),
    true,
  );
  assert.strictEqual(anySessionAlive([{ shellAlive: false }]), false);
}

function testDisambiguateSameBasename() {
  const tabs = [
    { id: "term-aaaa1111", cwd: "/Users/me/projects/hongcunlin", label: "hongcunlin" },
    { id: "term-bbbb2222", cwd: "/Users/me/other/hongcunlin", label: "hongcunlin" },
  ];
  const a = displayLabelForTab(tabs[0], tabs);
  const b = displayLabelForTab(tabs[1], tabs);
  assert.notStrictEqual(a, b, "same basename must produce distinct labels");
  assert.ok(a.includes("hongcunlin"));
  assert.ok(b.includes("hongcunlin"));
  // Prefer parent/name form when parents differ
  assert.ok(
    a.includes("projects/") || a.includes(" · "),
    `expected disambiguated a, got ${a}`,
  );
  assert.ok(
    b.includes("other/") || b.includes(" · "),
    `expected disambiguated b, got ${b}`,
  );

  const unique = withDisplayLabels([
    { id: "only", cwd: "/tmp/solo", label: "solo" },
  ]);
  assert.strictEqual(unique[0].displayLabel, "solo");

  const sameParent = withDisplayLabels([
    { id: "term-xxxx1111", cwd: "/Users/me/hongcunlin", label: "hongcunlin" },
    { id: "term-yyyy2222", cwd: "/Users/me/hongcunlin", label: "hongcunlin" },
  ]);
  assert.notStrictEqual(
    sameParent[0].displayLabel,
    sameParent[1].displayLabel,
  );
}

function testShouldConfirmCloseTab() {
  assert.strictEqual(shouldConfirmCloseTab({ grokRunning: true }), true);
  assert.strictEqual(shouldConfirmCloseTab({ grokRunning: false }), false);
  assert.strictEqual(shouldConfirmCloseTab({}), false);
  assert.strictEqual(shouldConfirmCloseTab({ shellAlive: true }), false);
}

function run() {
  const tests = [
    testLabelFromCwd,
    testCreateSessionMeta,
    testCanCreateSessionCap,
    testNextActiveAfterClose,
    testNormalizeSessionList,
    testSessionsSnapshotAndAlive,
    testDisambiguateSameBasename,
    testShouldConfirmCloseTab,
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
