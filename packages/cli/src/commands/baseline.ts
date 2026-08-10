import { mkdir, unlink } from "node:fs/promises";
import { dirname } from "node:path";
import {
  createSverka,
  createBaseline,
  updateBaseline,
  loadBaseline,
  saveBaseline,
} from "@sverka/sdk";
import type { GlobalFlags, OutputWriter } from "../types.js";
import { CliError, ExitCode } from "../types.js";
import { resolveUnderRoot } from "../internal/paths.js";

/** Args parsed for the baseline command. */
export interface BaselineArgs {
  subcommand: string;
  baselinePath?: string | undefined;
}

const DEFAULT_BASELINE_PATH = ".sverka/baseline.json";

function resolveBaselinePath(global: GlobalFlags, override?: string): string {
  const rel = override ?? DEFAULT_BASELINE_PATH;
  return resolveUnderRoot(global.root, rel);
}

/** Ensure the parent directory of a file path exists. */
async function ensureParentDir(path: string): Promise<void> {
  await mkdir(dirname(path), { recursive: true });
}

/**
 * Load a baseline and wrap any failure as a CliError(SDK_ERROR) so the
 * CLI's documented error-wrapping contract is honored (loadBaseline throws
 * BaselineError from @sverka/findings, which handleError would otherwise
 * only route through the generic branch).
 */
async function loadBaselineChecked(path: string) {
  try {
    return await loadBaseline(path);
  } catch (e) {
    throw new CliError(
      e instanceof Error ? e.message : "failed to load baseline",
      "SDK_ERROR",
      ExitCode.RuntimeError,
      e,
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
    ...(global.config
      ? { configPath: resolveUnderRoot(global.root, global.config) }
      : {}),
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
  const existing = await loadBaselineChecked(path);
  const sverka = createSverka({
    root: global.root,
    ...(global.config
      ? { configPath: resolveUnderRoot(global.root, global.config) }
      : {}),
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
  const baseline = await loadBaselineChecked(path);
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
  // Idempotent: always call unlink and tolerate only ENOENT. This closes
  // the TOCTOU race where a file appears between an existsSync check and
  // the unlink call. All other errors (EACCES, EISDIR, …) propagate.
  await unlink(path).catch((err: NodeJS.ErrnoException) => {
    if (err.code !== "ENOENT") throw err;
  });
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
