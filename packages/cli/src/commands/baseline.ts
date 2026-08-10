import { existsSync } from "node:fs";
import { mkdir, unlink } from "node:fs/promises";
import { dirname, join } from "node:path";
import {
  createSverka,
  createBaseline,
  updateBaseline,
  loadBaseline,
  saveBaseline,
} from "@sverka/sdk";
import type { GlobalFlags, OutputWriter } from "../types.js";
import { CliError, ExitCode } from "../types.js";

/** Args parsed for the baseline command. */
export interface BaselineArgs {
  subcommand: string;
  baselinePath?: string | undefined;
}

const DEFAULT_BASELINE_PATH = ".sverka/baseline.json";

function resolveBaselinePath(global: GlobalFlags, override?: string): string {
  const rel = override ?? DEFAULT_BASELINE_PATH;
  return join(global.root, rel);
}

/** Ensure the parent directory of a file path exists. */
async function ensureParentDir(path: string): Promise<void> {
  await mkdir(dirname(path), { recursive: true });
}

/**
 * Manage the findings baseline.
 */
export async function baselineCommand(
  args: BaselineArgs,
  global: GlobalFlags,
  output: OutputWriter,
  start: number,
): Promise<number> {
  const path = resolveBaselinePath(global, args.baselinePath);
  output.debug(`baseline: subcommand=${args.subcommand} path=${path}`);

  switch (args.subcommand) {
    case "create":
      return baselineCreate(path, global, output, start);
    case "update":
      return baselineUpdate(path, global, output, start);
    case "show":
      return baselineShow(path, global, output, start);
    case "clear":
      return baselineClear(path, global, output, start);
    default:
      throw new CliError(
        `unknown baseline subcommand: ${args.subcommand}`,
        "UNKNOWN_COMMAND",
        ExitCode.UsageError,
      );
  }
}

async function baselineCreate(
  path: string,
  global: GlobalFlags,
  output: OutputWriter,
  start: number,
): Promise<number> {
  const sverka = createSverka({
    root: global.root,
    ...(global.config ? { configPath: global.config } : {}),
  });
  const result = await sverka.execute();
  const baseline = createBaseline([...result.findings]);
  await ensureParentDir(path);
  await saveBaseline(baseline, path);

  const durationMs = Date.now() - start;
  if (global.format === "json") {
    output.writeLine(
      JSON.stringify({
        command: "baseline",
        data: { action: "create", path, fingerprints: baseline.fingerprints.length },
        durationMs,
      }),
    );
  } else {
    output.writeLine(`Baseline created: ${path} (${baseline.fingerprints.length} fingerprints)`);
  }
  return ExitCode.Success;
}

async function baselineUpdate(
  path: string,
  global: GlobalFlags,
  output: OutputWriter,
  start: number,
): Promise<number> {
  const existing = await loadBaseline(path);
  const sverka = createSverka({
    root: global.root,
    ...(global.config ? { configPath: global.config } : {}),
  });
  const result = await sverka.execute();
  const updated = updateBaseline([...result.findings], existing);
  await ensureParentDir(path);
  await saveBaseline(updated, path);

  const durationMs = Date.now() - start;
  if (global.format === "json") {
    output.writeLine(
      JSON.stringify({
        command: "baseline",
        data: { action: "update", path, fingerprints: updated.fingerprints.length },
        durationMs,
      }),
    );
  } else {
    output.writeLine(`Baseline updated: ${path} (${updated.fingerprints.length} fingerprints)`);
  }
  return ExitCode.Success;
}

async function baselineShow(
  path: string,
  global: GlobalFlags,
  output: OutputWriter,
  start: number,
): Promise<number> {
  const baseline = await loadBaseline(path);
  const durationMs = Date.now() - start;
  if (global.format === "json") {
    output.writeLine(
      JSON.stringify({
        command: "baseline",
        data: baseline,
        durationMs,
      }),
    );
  } else {
    output.writeLine(`Baseline: ${path}`);
    output.writeLine(`  version: ${baseline.version}`);
    output.writeLine(`  fingerprints: ${baseline.fingerprints.length}`);
    output.writeLine(`  suppressions: ${baseline.suppressions.length}`);
    output.writeLine(`  created: ${baseline.createdAt}`);
    output.writeLine(`  updated: ${baseline.updatedAt}`);
  }
  return ExitCode.Success;
}

async function baselineClear(
  path: string,
  global: GlobalFlags,
  output: OutputWriter,
  start: number,
): Promise<number> {
  // Idempotent: silently succeed if the file does not exist.
  if (existsSync(path)) {
    await unlink(path).catch(() => {});
  }
  const durationMs = Date.now() - start;
  if (global.format === "json") {
    output.writeLine(
      JSON.stringify({
        command: "baseline",
        data: { action: "clear", path },
        durationMs,
      }),
    );
  } else {
    output.writeLine(`Baseline cleared: ${path}`);
  }
  return ExitCode.Success;
}
