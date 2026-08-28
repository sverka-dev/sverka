// run command — execute Run Plan through native engine.
// Spec 17 — §30.

import { join } from "node:path";
import type { DefinitionGraph } from "@sverka/workflow";
import type { RuntimeDriver } from "@sverka/runtime";
import { createEngine } from "@sverka/runtime";
import type { RunEvent } from "@sverka/runtime";
import { createHostDriver } from "@sverka/runtime";
import type { CommandAllowlist } from "@sverka/runtime";
import { createDockerDriver } from "@sverka/runtime";
import { bindRunPlan } from "@sverka/sdk";
import type { GlobalFlags, OutputWriter } from "../types.js";
import { CliError, ExitCode } from "../types.js";
import { loadProjectGraph } from "../internal/config.js";
import { resolveDefaultEntryId, entryExists } from "../internal/graph.js";
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

  assertExecutorAvailable(executor);

  const { graph } = await loadProjectGraph(global);
  const entryId = resolveEntryId(graph, args.entryId);

  const plan = bindRunPlan({ graph, entryId });

  // Use the project root as the engine workspace so executed commands run
  // against the checked-out project. The engine places per-step scratch
  // directories under .sverka/workspace inside the root.
  const workspace = global.root;
  const artifactDir = join(global.root, ".sverka", "artifacts");

  const engine = createEngine({
    drivers: buildDrivers(executor),
    maxConcurrent: 4,
  });

  const { events, runStatus } = await consumeEvents(engine, plan, workspace, artifactDir, global, output);

  const durationMs = Date.now() - start;
  writeRunOutput(plan.id, runStatus, events.length, durationMs, global, output);

  return exitCodeForStatus(runStatus);
}

function assertExecutorAvailable(executor: "host" | "docker"): void {
  if (executor === "docker" && !isBinaryAvailable("docker")) {
    throw new CliError(
      "docker executor not available (docker not found on PATH)",
      "RUNTIME_NOT_AVAILABLE",
      ExitCode.RuntimeError,
    );
  }
}

function resolveEntryId(graph: DefinitionGraph, entryId?: string): string {
  const resolved = entryId ?? resolveDefaultEntryId(graph);
  if (!resolved) {
    throw new CliError("no entries in graph", "MISSING_ARG", ExitCode.UsageError);
  }
  if (!entryExists(graph, resolved)) {
    throw new CliError(
      `entry "${resolved}" not found in graph`,
      "MISSING_ARG",
      ExitCode.UsageError,
    );
  }
  return resolved;
}

function buildDrivers(executor: "host" | "docker"): RuntimeDriver[] {
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
    envAllowlist: [
      "PATH",
      "HOME",
      "USER",
      "SHELL",
      "TMPDIR",
      "XDG_CONFIG_HOME",
      "XDG_CACHE_HOME",
      "XDG_DATA_HOME",
      "XDG_STATE_HOME",
      "XDG_RUNTIME_DIR",
    ],
  });

  const drivers: RuntimeDriver[] = [hostDriver];
  if (executor === "docker") {
    drivers.push(createDockerDriver({}));
  }
  return drivers;
}

async function consumeEvents(
  engine: ReturnType<typeof createEngine>,
  plan: ReturnType<typeof bindRunPlan>,
  workspace: string,
  artifactDir: string,
  global: GlobalFlags,
  output: OutputWriter,
): Promise<{ events: RunEvent[]; runStatus: string }> {
  const events: RunEvent[] = [];
  let runStatus = "failure";

  for await (const event of engine.run({ plan, workspace, artifactDir })) {
    events.push(event);
    if (global.format === "human") {
      printEvent(event, output);
    }
    if ((event as { type: string }).type === "run-completed") {
      runStatus = (event as { status: string }).status;
    }
  }

  return { events, runStatus };
}

function writeRunOutput(
  planId: string,
  runStatus: string,
  eventCount: number,
  durationMs: number,
  global: GlobalFlags,
  output: OutputWriter,
): void {
  if (global.format === "json") {
    output.writeLine(
      JSON.stringify({
        command: "run",
        data: { planId, status: runStatus, events: eventCount },
        durationMs,
      }),
    );
  } else {
    output.writeLine(`Run completed: ${runStatus} (${eventCount} events, ${durationMs}ms)`);
  }
}

function exitCodeForStatus(runStatus: string): ExitCode {
  if (runStatus === "success") return ExitCode.Success;
  if (runStatus === "failure") return ExitCode.PolicyFail;
  return ExitCode.RuntimeError;
}

const EVENT_LABELS: Readonly<Record<string, string>> = {
  "run-started": "▶ run started",
  "step-pending": "  ○ {step} pending",
  "step-ready": "  ◇ {step} ready",
  "step-started": "  ▶ {step} started",
  "step-succeeded": "  ✓ {step} succeeded",
  "step-failed": "  ✗ {step} failed",
  "step-skipped": "  ⊘ {step} skipped",
  "step-cancelled": "  ⊘ {step} cancelled",
  "run-completed": "■ run completed: {status}",
  "diagnostic": "  ! diagnostic",
};

function printEvent(event: RunEvent, output: OutputWriter): void {
  const e = event as { type: string; stepId?: string; status?: string };
  const template = EVENT_LABELS[e.type];
  if (template === undefined) {
    output.writeLine(`  ? ${e.type}`);
    return;
  }
  const line = template
    .replace("{step}", e.stepId ?? "")
    .replace("{status}", e.status ?? "");
  output.writeLine(line);
}
