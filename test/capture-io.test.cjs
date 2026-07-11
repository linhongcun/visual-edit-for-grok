const assert = require("assert");
const fs = require("fs");
const os = require("os");
const path = require("path");
const {
  copyFileToMacClipboard,
  writePrivatePng,
} = require("../electron/capture-io.cjs");

async function testClipboardUsesArgvAndTimeout() {
  const dangerousPath = '/tmp/screenshot "quote"\nreturn.png';
  let invocation = null;
  const result = await copyFileToMacClipboard(dangerousPath, {
    platform: "darwin",
    timeoutMs: 123,
    execFile(file, args, options, callback) {
      invocation = { file, args, options };
      queueMicrotask(() => callback(null, "", ""));
      return { kill() {} };
    },
  });

  assert.deepStrictEqual(result, { ok: true, method: "osascript" });
  assert.strictEqual(invocation.file, "osascript");
  assert.strictEqual(invocation.options.timeout, 123);
  assert.strictEqual(invocation.args[0], "-e");
  assert.ok(invocation.args[1].includes("on run argv"));
  assert.ok(!invocation.args[1].includes(dangerousPath));
  assert.strictEqual(invocation.args[2], dangerousPath);
}

async function testClipboardReportsExecFailure() {
  const expected = new Error("Apple events denied");
  const result = await copyFileToMacClipboard("/tmp/frame.png", {
    platform: "darwin",
    execFile(_file, _args, _options, callback) {
      queueMicrotask(() => callback(expected, "", "denied"));
      return { kill() {} };
    },
  });
  assert.strictEqual(result.ok, false);
  assert.strictEqual(result.reason, "osascript-failed");
  assert.strictEqual(result.error, expected);
}

async function testClipboardEnforcesTimeoutAndKillsChild() {
  let killed = false;
  const started = Date.now();
  const result = await copyFileToMacClipboard("/tmp/frame.png", {
    platform: "darwin",
    timeoutMs: 15,
    execFile(_file, _args, _options, callback) {
      return {
        kill() {
          killed = true;
          callback(new Error("killed synchronously"));
        },
      };
    },
  });
  assert.strictEqual(result.ok, false);
  assert.strictEqual(result.reason, "timeout");
  assert.strictEqual(result.error.code, "ETIMEDOUT");
  assert.strictEqual(killed, true);
  assert.ok(Date.now() - started < 1_000);
}

async function testClipboardRejectsUnsupportedAndRelativePaths() {
  let called = false;
  const execFile = () => {
    called = true;
  };
  assert.deepStrictEqual(
    await copyFileToMacClipboard("/tmp/frame.png", {
      platform: "linux",
      execFile,
    }),
    { ok: false, reason: "unsupported-platform" },
  );
  assert.deepStrictEqual(
    await copyFileToMacClipboard("frame.png", {
      platform: "darwin",
      execFile,
    }),
    { ok: false, reason: "invalid-path" },
  );
  assert.strictEqual(called, false);
}

async function testPrivatePngPermissionsAndContent() {
  const root = await fs.promises.mkdtemp(path.join(os.tmpdir(), "vefg-io-"));
  const dir = path.join(root, "captures");
  const file = path.join(dir, "frame.png");
  const bytes = Buffer.from([0x89, 0x50, 0x4e, 0x47, 1, 2, 3]);
  try {
    const result = await writePrivatePng(file, bytes);
    assert.deepStrictEqual(result, { path: file, bytes: bytes.length });
    assert.deepStrictEqual(await fs.promises.readFile(file), bytes);
    assert.strictEqual((await fs.promises.stat(dir)).mode & 0o777, 0o700);
    assert.strictEqual((await fs.promises.stat(file)).mode & 0o777, 0o600);
  } finally {
    await fs.promises.rm(root, { recursive: true, force: true });
  }
}

async function testPrivatePngDoesNotOverwrite() {
  const root = await fs.promises.mkdtemp(path.join(os.tmpdir(), "vefg-io-"));
  const file = path.join(root, "frame.png");
  try {
    await writePrivatePng(file, Buffer.from("first"));
    await assert.rejects(
      writePrivatePng(file, Buffer.from("second")),
      (error) => error?.code === "EEXIST",
    );
    assert.strictEqual((await fs.promises.readFile(file)).toString(), "first");
  } finally {
    await fs.promises.rm(root, { recursive: true, force: true });
  }
}

async function run() {
  const tests = [
    testClipboardUsesArgvAndTimeout,
    testClipboardReportsExecFailure,
    testClipboardEnforcesTimeoutAndKillsChild,
    testClipboardRejectsUnsupportedAndRelativePaths,
    testPrivatePngPermissionsAndContent,
    testPrivatePngDoesNotOverwrite,
  ];
  let failed = 0;
  for (const test of tests) {
    try {
      await test();
      console.log(`ok  - ${test.name}`);
    } catch (error) {
      failed += 1;
      console.error(`fail - ${test.name}`, error);
    }
  }
  console.log(`\n${tests.length - failed}/${tests.length} passed`);
  if (failed) process.exitCode = 1;
}

void run();
