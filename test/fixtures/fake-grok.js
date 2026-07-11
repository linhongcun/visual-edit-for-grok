#!/usr/bin/env node

const fs = require("fs");

const inputLog = process.env.VEFG_FAKE_GROK_INPUT_LOG || "";
// Match Grok's full-screen TUI: alternate buffer + SGR mouse reporting.
process.stdout.write("\x1b[?1049h\x1b[?1000h\x1b[?1002h\x1b[?1003h\x1b[?1006h");
process.stdout.write(`FAKE_GROK_RUNNING cwd=${process.cwd()}\n`);
if (inputLog) fs.writeFileSync(inputLog, "");
if (process.stdin.isTTY && typeof process.stdin.setRawMode === "function") {
  process.stdin.setRawMode(true);
}
process.stdin.on("data", (chunk) => {
  if (inputLog) fs.appendFileSync(inputLog, chunk);
});
process.stdin.resume();
const keepAlive = setInterval(() => {}, 1_000);

function stop() {
  clearInterval(keepAlive);
  process.exit(0);
}

process.on("SIGTERM", stop);
process.on("SIGINT", stop);
