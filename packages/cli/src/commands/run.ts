// run command — execute Run Plan through native engine.
// Spec 17 — §30.

import { join } from "node:path";
import { synthesize } from "@sverka/core";
import { bindRunPlan } from "@sverka/planner";
import { createEngine, type RunEvent } from "@sverka/engine-native";
import { createHostDriver, type CommandAllowlist } from "@sverka/runtime-host";
import type { GlobalFlags, OutputWriter } from "../types.js";
import { CliError, ExitCode } from "../types.js";
import { resolveUnderRoot } from "../internal/paths.js";
import { findConfig, loadConfig } from "../internal/config.js";
import { isBinaryAvailable } from "../internal/runtime-check.js";

export interface RunArgs {
  entryId?: string;
  executor?: "host" | "docker";
}

/**
 * Execute a Run Plan through the native engine and print events.
 */
export async function runCommand(
  args: RunArgs,
  global: GlobalFlags,
  output: OutputWriter,
  start: number,
): Promise<number> {
  const executor = args.executor ?? "host";
  output.debug(`run: root=${global.root} executor=${executor} entry=${args.entryId ?? "(first)"}`);

  if (executor === "docker" && !isBinaryAvailable("docker")) {
    throw new CliError(
      "docker executor not available (docker not found on PATH)",
      "RUNTIME_NOT_AVAILABLE",
      ExitCode.RuntimeError,
    );
  }

  let configPath: string | null = global.config
    ? resolveUnderRoot(global.root, global.config)
    : null;
  if (!configPath) {
    configPath = await findConfig(global.root);
  }
  if (!configPath) {
    throw new CliError(
      "no config found (use --config to specify a path)",
      "MISSING_ARG",
      ExitCode.UsageError,
    );
  }

  const project = await loadConfig(configPath);
  const graph = synthesize(project);

  const pipeline = graph.project.pipelines[0];
  if (!pipeline) {
    throw new CliError("no pipelines in config", "SDK_ERROR", ExitCode.RuntimeError);
  }

  const entryId = args.entryId ?? pipeline.entries[0]?.id;
  if (!entryId) {
    throw new CliError("no entries in pipeline", "MISSING_ARG", ExitCode.UsageError);
  }

  const plan = bindRunPlan({ graph, entryId });

  const workspace = join(global.root, ".sverka", "workspace");
  const artifactDir = join(global.root, ".sverka", "artifacts");

  // Permissive allowlist: the CLI trusts the user's config.
  // The allowlist is a security boundary for untrusted input; the CLI
  // runs the user's own workflow definition.
  const permissiveAllowlist: CommandAllowlist = {
    entries: [],
    isAllowed: () => true,
  };

  const hostDriver = createHostDriver({
    enabled: true,
    allowlist: permissiveAllowlist,
    envAllowlist: [],
  });

  const engine = createEngine({
    drivers: [hostDriver],
    maxConcurrent: 4,
  });

  const events: RunEvent[] = [];
  let runStatus: string = "success";

  for await (const event of engine.run({
    plan,
    workspace,
    artifactDir,
  })) {
    events.push(event);
    if (global.format === "human") {
      printEvent(event, output);
    }
    if ((event as { type: string }).type === "run-completed") {
      runStatus = (event as { status: string }).status;
    }
  }

  const durationMs = Date.now() - start;
  if (global.format === "json") {
    output.writeLine(
      JSON.stringify({
        command: "run",
        data: { planId: plan.id, status: runStatus, events: events.length },
        durationMs,
      }),
    );
  } else {
    output.writeLine(`Run completed: ${runStatus} (${events.length} events, ${durationMs}ms)`);
  }

  if (runStatus === "failure") return ExitCode.PolicyFail;
  if (runStatus === "cancelled") return ExitCode.RuntimeError;
  return ExitCode.Success;
}

function printEvent(event: RunEvent, output: OutputWriter): void {
  const e = event as { type: string; stepId?: string; status?: string };
  switch (e.type) {
    case "run-started":
      output.writeLine("▶ run started");
      break;
    case "step-pending":
      output.writeLine(`  ○ ${e.stepId} pending`);
      break;
    case "step-ready":
      output.writeLine(`  ◇ ${e.stepId} ready`);
      break;
    case "step-started":
      output.writeLine(`  ▶ ${e.stepId} started`);
      break;
    case "step-succeeded":
      output.writeLine(`  ✓ ${e.stepId} succeeded`);
      break;
    case "step-failed":
      output.writeLine(`  ✗ ${e.stepId} failed`);
      break;
    case "step-skipped":
      output.writeLine(`  ⊘ ${e.stepId} skipped`);
      break;
    case "step-cancelled":
      output.writeLine(`  ⊘ ${e.stepId} cancelled`);
      break;
    case "run-completed":
      output.writeLine(`■ run completed: ${e.status}`);
      break;
    case "diagnostic":
      output.writeLine(`  ! diagnostic`);
      break;
    default:
      output.writeLine(`  ? ${e.type}`);
      break;
  }
}
