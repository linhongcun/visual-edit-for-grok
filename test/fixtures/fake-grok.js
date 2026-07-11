#!/usr/bin/env node

process.stdout.write(`FAKE_GROK_RUNNING cwd=${process.cwd()}\n`);
process.stdin.resume();
const keepAlive = setInterval(() => {}, 1_000);

function stop() {
  clearInterval(keepAlive);
  process.exit(0);
}

process.on("SIGTERM", stop);
process.on("SIGINT", stop);

