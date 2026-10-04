#!/usr/bin/env node
import process from "node:process";
import { spawnSync } from "node:child_process";

// `npm create sverka` / `bun create sverka` / `bunx create-sverka` resolve
// this package by the create-* convention. It is a thin shim that delegates
// to the latest published `sverka` CLI so project init logic lives in
// exactly one place (sverka init).
const args = ["--yes", "sverka@latest", "init", ...process.argv.slice(2)];
const result = spawnSync("npx", args, { stdio: "inherit" });

if (result.error) {
  console.error(
    `create-sverka: failed to launch npx — ${result.error.message}`,
  );
  process.exit(1);
}
process.exit(result.status ?? 1);
