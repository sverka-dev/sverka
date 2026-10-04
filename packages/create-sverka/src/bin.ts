#!/usr/bin/env node
import process from "node:process";
import { createSverka } from "./index.js";

try {
  // Set process.exitCode and let the event loop drain instead of calling
  // process.exit() immediately — a forced exit can truncate buffered
  // stdout/stderr writes when output is piped or large.
  process.exitCode = await createSverka(process.argv.slice(2));
} catch (e: unknown) {
  const msg = e instanceof Error ? (e.stack ?? e.message) : String(e);
  process.stderr.write(`fatal: ${msg}\n`);
  process.exitCode = 3;
}
