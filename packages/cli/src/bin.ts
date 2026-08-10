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
  .catch(() => {
    process.exitCode = 3;
  });
