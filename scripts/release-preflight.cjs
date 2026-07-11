#!/usr/bin/env node

const fs = require("fs");
const path = require("path");
const { spawnSync } = require("child_process");

const ROOT = path.resolve(__dirname, "..");
process.chdir(ROOT);

function fail(message) {
  console.error(`release preflight failed: ${message}`);
  process.exit(1);
}

function readJson(file) {
  return JSON.parse(fs.readFileSync(path.join(ROOT, file), "utf8"));
}

function run(command, args, options = {}) {
  console.log(`\n> ${command} ${args.join(" ")}`);
  const result = spawnSync(command, args, {
    cwd: ROOT,
    env: { ...process.env, ...(options.env || {}) },
    encoding: "utf8",
    stdio: options.capture ? ["ignore", "pipe", "pipe"] : "inherit",
  });
  if (result.error) fail(`${command}: ${result.error.message}`);
  if (result.status !== 0) {
    const detail = [result.stdout, result.stderr].filter(Boolean).join("\n").trim();
    fail(`${command} exited ${result.status}${detail ? `\n${detail}` : ""}`);
  }
  return options.capture ? String(result.stdout || "").trim() : "";
}

function assert(condition, message) {
  if (!condition) fail(message);
}

function escapeRegExp(value) {
  return value.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
}

if (process.platform !== "darwin" || process.arch !== "arm64") {
  fail(`release artifacts require macOS arm64; got ${process.platform}/${process.arch}`);
}

const allowDirty = process.env.VEFG_RELEASE_ALLOW_DIRTY === "1";
const status = run(
  "git",
  ["status", "--porcelain", "--untracked-files=all"],
  { capture: true },
);
if (status && !allowDirty) {
  fail(`worktree is not clean:\n${status}`);
}
if (status && allowDirty) {
  console.warn("warning: VEFG_RELEASE_ALLOW_DIRTY=1; dirty-tree gate bypassed");
}

const pkg = readJson("package.json");
const lock = readJson("package-lock.json");
const version = pkg.version;
const expectedDmgName = `Visual-Capture-for-Grok-${version}-arm64.dmg`;
const appPath = path.join(
  ROOT,
  "release",
  "mac-arm64",
  "Visual Capture for Grok.app",
);
const executablePath = path.join(
  appPath,
  "Contents",
  "MacOS",
  "Visual Capture for Grok",
);
const infoPlist = path.join(appPath, "Contents", "Info.plist");
const dmgPath = path.join(ROOT, "release", expectedDmgName);

assert(/^\d+\.\d+\.\d+$/.test(version), `invalid version: ${version}`);
assert(lock.version === version, `package-lock version ${lock.version} != ${version}`);
assert(
  lock.packages?.[""]?.version === version,
  `package-lock root version ${lock.packages?.[""]?.version} != ${version}`,
);
const nonOfficialResolved = Object.values(lock.packages || {})
  .map((row) => row?.resolved)
  .filter(Boolean)
  .filter((resolved) => {
    try {
      return new URL(resolved).hostname !== "registry.npmjs.org";
    } catch {
      return true;
    }
  });
assert(
  nonOfficialResolved.length === 0,
  `package-lock has non-official resolved URLs: ${nonOfficialResolved.slice(0, 3).join(", ")}`,
);

for (const script of [
  "test",
  "typecheck",
  "check",
  "test:electron",
  "test:packaged",
  "dist",
  "release:preflight",
]) {
  assert(pkg.scripts?.[script], `missing npm script: ${script}`);
}

const readme = fs.readFileSync(path.join(ROOT, "README.md"), "utf8");
const changelog = fs.readFileSync(path.join(ROOT, "CHANGELOG.md"), "utf8");
assert(
  readme.includes(`**Version ${version}**`),
  `README version is not ${version}`,
);
assert(
  readme.includes(`release/${expectedDmgName}`),
  `README DMG path is not ${expectedDmgName}`,
);
assert(
  !/\| `npm test` \| \d+ pure-helper/.test(readme),
  "README hard-codes a unit-test count",
);
assert(
  new RegExp(`^## \\[${escapeRegExp(version)}\\]`, "m").test(changelog),
  `CHANGELOG has no ${version} entry`,
);

const macTargets = Array.isArray(pkg.build?.mac?.target)
  ? pkg.build.mac.target
  : [];
for (const target of ["dir", "dmg"]) {
  assert(
    macTargets.some(
      (item) =>
        item?.target === target &&
        Array.isArray(item.arch) &&
        item.arch.includes("arm64"),
    ),
    `electron-builder is missing mac arm64 ${target} target`,
  );
}

console.log(`release preflight: ${version} (${process.platform}/${process.arch})`);
run("npm", ["run", "check"]);
run("npm", ["run", "test:electron"]);
run("npm", ["run", "dist"]);

assert(fs.existsSync(executablePath), `packaged executable missing: ${executablePath}`);
run("npm", ["run", "test:packaged"]);
run("codesign", ["--verify", "--deep", "--strict", "--verbose=2", appPath]);

const bundleVersion = run(
  "/usr/libexec/PlistBuddy",
  ["-c", "Print :CFBundleShortVersionString", infoPlist],
  { capture: true },
);
assert(bundleVersion === version, `bundle version ${bundleVersion} != ${version}`);

const archs = run("lipo", ["-archs", executablePath], { capture: true })
  .split(/\s+/)
  .filter(Boolean);
assert(archs.includes("arm64"), `packaged executable is not arm64: ${archs.join(" ")}`);

assert(fs.existsSync(dmgPath), `DMG missing: ${dmgPath}`);
assert(fs.statSync(dmgPath).size > 10 * 1024 * 1024, "DMG is unexpectedly small");
run("hdiutil", ["verify", dmgPath]);

const updateMetadataPath = path.join(ROOT, "release", "latest-mac.yml");
assert(fs.existsSync(updateMetadataPath), "latest-mac.yml is missing");
const updateMetadata = fs.readFileSync(updateMetadataPath, "utf8");
assert(
  updateMetadata.includes(`version: ${version}`) &&
    updateMetadata.includes(expectedDmgName),
  "latest-mac.yml does not match the release version",
);

const checksum = run("shasum", ["-a", "256", dmgPath], { capture: true });
console.log(`\nrelease preflight passed\n${checksum}`);
