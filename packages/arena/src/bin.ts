#!/usr/bin/env node
/**
 * sverka-arena — CLI for the agent arena: run the benchmark matrix, render
 * saved results, check the environment. Spec: specs/49-arena-cli.
 */

import process from "node:process";
import { readFile } from "node:fs/promises";
import { existsSync } from "node:fs";
import { delimiter, join, resolve } from "node:path";

import type { ArenaResult } from "./types.js";
import { ArenaError, loadArenaConfig } from "./config.js";
import { renderReport } from "./report.js";
import { writeAggregateReport } from "./aggregate-report.js";
import { runArena } from "./runner.js";

interface Io {
  out(s: string): void;
  err(s: string): void;
}

type Format = "text" | "json" | "html";

interface ParsedArgs {
  command: string | undefined;
  positional: string[];
  config: string;
  out: string | undefined;
  format: Format;
}

const USAGE = `usage: sverka-arena <command> [options]

commands:
  run      [--config <path>] [--out <dir>] [--format json|text]
  report   <results.json>               [--format json|text|html] [--out <file.html>]
  doctor   [--config <path>]            [--format json|text]
`;

function flagValue(argv: readonly string[], i: number): string {
  const val = argv[i + 1];
  if (val === undefined || val.startsWith("--")) {
    throw new ArenaError(`${argv[i]} requires a value`, "CONFIG_INVALID");
  }
  return val;
}

function parseFormat(val: string): Format {
  if (val !== "json" && val !== "text" && val !== "html") {
    throw new ArenaError(`invalid --format '${val}'`, "CONFIG_INVALID");
  }
  return val;
}

function parseArgs(argv: readonly string[]): ParsedArgs {
  const positional: string[] = [];
  let config = "arena.config.ts";
  let out: string | undefined;
  let format: "text" | "json" | "html" = "text";
  let command: string | undefined;
  for (let i = 0; i < argv.length; i++) {
    const arg = argv[i]!;
    switch (arg) {
      case "--config":
        config = flagValue(argv, i);
        i += 1;
        break;
      case "--out":
        out = flagValue(argv, i);
        i += 1;
        break;
      case "--format":
        format = parseFormat(flagValue(argv, i));
        i += 1;
        break;
      default:
        if (arg.startsWith("--")) {
          throw new ArenaError(`unknown option '${arg}'`, "CONFIG_INVALID");
        }
        if (command === undefined) command = arg;
        else positional.push(arg);
    }
  }
  return { command, positional, config, out, format };
}

function which(bin: string): boolean {
  const exts =
    process.platform === "win32"
      ? ["", ...(process.env.PATHEXT ?? ".EXE;.CMD;.BAT").split(";")]
      : [""];
  for (const dir of (process.env.PATH ?? "").split(delimiter)) {
    if (exts.some((ext) => existsSync(join(dir, bin + ext)))) return true;
  }
  return false;
}

async function cmdReport(args: ParsedArgs, io: Io): Promise<number> {
  const file = args.positional[0];
  if (file === undefined) {
    io.err("report: missing <results.json> path");
    return 2;
  }
  let result: ArenaResult;
  try {
    result = JSON.parse(await readFile(file, "utf8")) as ArenaResult;
  } catch (err) {
    io.err(
      `report: cannot read '${file}': ${err instanceof Error ? err.message : String(err)}`,
    );
    return 2;
  }
  if (
    !Array.isArray(result.aggregates) ||
    !Array.isArray(result.analysis) ||
    !Array.isArray(result.results) ||
    result.config === undefined ||
    !Array.isArray(result.config.models)
  ) {
    io.err(`report: '${file}' is not a sverka-arena results file\n`);
    return 2;
  }
  if (args.format === "json") {
    io.out(JSON.stringify(result, null, 2) + "\n");
  } else if (args.format === "html") {
    const out = args.out ?? "arena-report.html";
    writeAggregateReport(result, resolve(out), {
      command: `sverka-arena report ${file} --format html`,
    });
    io.out(`report written to ${out}\n`);
  } else {
    io.out(renderReport(result) + "\n");
  }
  return 0;
}

async function cmdRun(args: ParsedArgs, io: Io): Promise<number> {
  if (args.format === "html") {
    io.err("run: --format html is only supported by 'report'\n");
    return 2;
  }
  const config = await loadArenaConfig(args.config);
  if (args.out !== undefined) config.outputDir = resolve(args.out);
  const result = await runArena(config);
  if (args.format === "json") {
    io.out(JSON.stringify(result, null, 2) + "\n");
  } else {
    io.out(renderReport(result) + "\n");
  }
  return 0;
}

interface DoctorCheck {
  name: string;
  ok: boolean;
  detail: string;
}

function doctorChecks(
  config: Awaited<ReturnType<typeof loadArenaConfig>>,
): DoctorCheck[] {
  const agentOnPath = which(config.agent.id);
  const checks: DoctorCheck[] = [
    {
      name: `agent binary: ${config.agent.id}`,
      ok: agentOnPath,
      detail: agentOnPath ? "on PATH" : "not found on PATH",
    },
  ];
  const models = config.judge
    ? [...config.models, config.judge.model]
    : config.models;
  for (const m of models) {
    if (m.envVar === undefined) continue;
    checks.push({
      name: `env: ${m.envVar} (model ${m.id})`,
      ok: process.env[m.envVar] !== undefined,
      detail: process.env[m.envVar] !== undefined ? "set" : "not set",
    });
  }
  return checks;
}

async function cmdDoctor(args: ParsedArgs, io: Io): Promise<number> {
  if (args.format === "html") {
    io.err("doctor: --format html is only supported by 'report'\n");
    return 2;
  }
  const checks = doctorChecks(await loadArenaConfig(args.config));

  if (args.format === "json") {
    io.out(JSON.stringify({ checks }, null, 2) + "\n");
  } else {
    for (const chk of checks) {
      io.out(`${chk.ok ? "ok" : "FAIL"}  ${chk.name} — ${chk.detail}\n`);
    }
  }
  return checks.every((chk) => chk.ok) ? 0 : 1;
}

const defaultIo: Io = {
  out: (s) => process.stdout.write(s),
  err: (s) => process.stderr.write(s),
};

/** Entry point — exported for tests; bin calls it with process.argv. */
export async function main(
  argv: readonly string[],
  io: Io = defaultIo,
): Promise<number> {
  let args: ParsedArgs;
  try {
    args = parseArgs(argv);
  } catch (err) {
    io.err((err instanceof Error ? err.message : String(err)) + "\n");
    io.err(USAGE);
    return 2;
  }

  if (args.command === undefined) {
    io.err(USAGE);
    return 2;
  }

  try {
    switch (args.command) {
      case "run":
        return await cmdRun(args, io);
      case "report":
        return await cmdReport(args, io);
      case "doctor":
        return await cmdDoctor(args, io);
      default:
        io.err(`unknown command '${args.command}'\n`);
        io.err(USAGE);
        return 2;
    }
  } catch (err) {
    if (err instanceof ArenaError) {
      io.err(`error: ${err.message}\n`);
      return 2;
    }
    io.err(`error: ${err instanceof Error ? err.message : String(err)}\n`);
    return 3;
  }
}

// Run when invoked directly (not imported by tests).
if (import.meta.url === `file://${process.argv[1]}`) {
  const code = await main(process.argv.slice(2));
  process.exit(code);
}
