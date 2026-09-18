#!/usr/bin/env node
import process from "node:process";
import { missingBuildHint } from "./internal/errors.js";

// Set process.exitCode and let the event loop drain instead of calling
// process.exit() immediately — a forced exit can truncate buffered stdout/stderr
// writes when output is piped or large.
async function start(): Promise<void> {
  try {
    // Dynamic import so a missing @sverka/* dist (partial build) lands here
    // as a readable hint instead of Node's raw ERR_MODULE_NOT_FOUND.
    const { main } = await import("./index.js");
    process.exitCode = await main(process.argv.slice(2));
  } catch (e: unknown) {
    const hint = missingBuildHint(e);
    if (hint !== null) {
      process.stderr.write(`error: ${hint}\n`);
    } else {
      const msg = e instanceof Error ? (e.stack ?? e.message) : String(e);
      process.stderr.write(`fatal: ${msg}\n`);
    }
    process.exitCode = 3;
  }
}

void start();
