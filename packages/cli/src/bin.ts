#!/usr/bin/env node
import process from "node:process";
import { main } from "./main.js";

// Set process.exitCode and let the event loop drain instead of calling
// process.exit() immediately — a forced exit can truncate buffered stdout/stderr
// writes when output is piped or large.
main(process.argv.slice(2))
  .then((code) => {
    process.exitCode = code;
  })
  .catch((e: unknown) => {
    const msg = e instanceof Error ? (e.stack ?? e.message) : String(e);
    process.stderr.write(`fatal: ${msg}\n`);
    process.exitCode = 3;
  });
