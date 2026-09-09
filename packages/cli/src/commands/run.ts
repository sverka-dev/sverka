// run command — execute Run Plan through native engine.
// Spec 17 — §30.

import process from "node:process";
import { join } from "node:path";
import type { DefinitionGraph } from "@sverka/workflow";
import type { RuntimeDriver } from "@sverka/runtime";
import { createEngine } from "@sverka/runtime";
import type { RunEvent } from "@sverka/runtime";
import { createHostDriver } from "@sverka/runtime";
import type { CommandAllowlist } from "@sverka/runtime";
import { createDockerDriver } from "@sverka/runtime";
import { bindRunPlan } from "@sverka/sdk";
import { createTextRenderer, createHtmlRenderer, createInkRenderer, collectFindings, evaluateGate, ReporterError } from "@sverka/reporter";
import type { Renderer, FindingRow } from "@sverka/reporter";
import type { Finding } from "@sverka/verification";
import type { GlobalFlags, OutputWriter } from "../types.js";
import { CliError, ExitCode } from "../types.js";
import { loadProjectGraph } from "../internal/config.js";
import { resolveDefaultEntryId, entryExists } from "../internal/graph.js";
import { isBinaryAvailable } from "../internal/runtime-check.js";

export interface RunArgs {
  entryId?: string;
  executor?: "host" | "docker";
  evaluate?: boolean;
  output?: string;
  /** Force TUI on (true) or off (false); undefined = auto-detect TTY. */
  tui?: boolean;
  /** Whether --format was passed explicitly (disables TUI auto-detect). */
  formatExplicit?: boolean;
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
  // --format html or --output implies --evaluate
  const isHtml = global.format === "html" || args.output !== undefined;
  const evaluate = args.evaluate || isHtml;
  output.debug(`run: root=${global.root} executor=${executor} entry=${args.entryId ?? "(first)"} format=${global.format}`);

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

  const { events, runStatus, renderer } = await consumeEvents(
    engine, plan, { workspace, artifactDir }, global, output, graph, args,
  );

  const durationMs = Date.now() - start;

  // If --evaluate (or --format html), collect findings and run policy gate
  let policyExitCode = 0;
  let evalResult: { findings: readonly Finding[]; verdict: string; summary: string } | null = null;
  let collectionFailed = false;
  if (evaluate) {
    const result = await runEvaluation(artifactDir, global, output, events, renderer);
    policyExitCode = result.exitCode;
    evalResult = result.summary;
    collectionFailed = result.summary === null && result.exitCode === ExitCode.RuntimeError;
  }

  // Flush the renderer (HtmlRenderer writes the file on flush)
  renderer?.flush();

  // Interactive renderers stay mounted until the user quits (q / Ctrl+C).
  if (renderer && "waitUntilExit" in renderer) {
    await (renderer as { waitUntilExit(): Promise<void> }).waitUntilExit();
  }

  // When --evaluate fails with a collection error, the error was already
  // written in the requested format — skip normal output and return.
  if (collectionFailed) {
    return policyExitCode;
  }

  writeRunOutput(plan.id, runStatus, events.length, durationMs, global, output, evalResult);

  // When --evaluate is set, policy exit code takes precedence
  if (evaluate && policyExitCode !== 0) {
    return policyExitCode;
  }

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

interface RunContext {
  workspace: string;
  artifactDir: string;
}

async function consumeEvents(
  engine: ReturnType<typeof createEngine>,
  plan: ReturnType<typeof bindRunPlan>,
  ctx: RunContext,
  global: GlobalFlags,
  output: OutputWriter,
  graph: DefinitionGraph,
  args: RunArgs,
): Promise<{ events: RunEvent[]; runStatus: string; renderer: Renderer | null }> {
  const events: RunEvent[] = [];
  let runStatus = "failure";

  let renderer: Renderer | null = null;

  // --output flag implies HTML format
  const isHtml = global.format === "html" || args.output !== undefined;

  // TUI auto-detect: stdout TTY + no explicit --format, unless --no-tui.
  // --tui forces it on; any explicit --format forces it off.
  const tuiDenied = args.tui === false || args.formatExplicit === true;
  const tuiWanted =
    !isHtml &&
    global.format === "text" &&
    !tuiDenied &&
    (args.tui === true || process.stdout.isTTY === true);

  if (tuiWanted) {
    try {
      renderer = createInkRenderer({ graph });
    } catch {
      renderer = createTextRenderer({ writer: output });
    }
  } else if (global.format === "text" && !isHtml) {
    renderer = createTextRenderer({ writer: output });
  } else if (isHtml) {
    const outputPath = args.output ?? join(global.root, ".sverka", "report.html");
    renderer = createHtmlRenderer({ outputPath, graph });
  }

  for await (const event of engine.run({ plan, workspace: ctx.workspace, artifactDir: ctx.artifactDir })) {
    events.push(event);
    renderer?.onEvent(event);
    if ((event as { type: string }).type === "run-completed") {
      runStatus = (event as { status: string }).status;
    }
  }

  return { events, runStatus, renderer };
}

async function runEvaluation(
  artifactDir: string,
  global: GlobalFlags,
  output: OutputWriter,
  _events: readonly RunEvent[],
  renderer: Renderer | null,
): Promise<{ exitCode: number; summary: { findings: readonly Finding[]; verdict: string; summary: string } | null }> {
  let rows: readonly FindingRow[];
  try {
    rows = await collectFindings({ artifactDir });
  } catch (e) {
    if (e instanceof ReporterError) {
      if (global.format === "json") {
        output.writeLine(JSON.stringify({
          command: "run",
          error: "COLLECTION_FAILED",
          message: e.message,
        }));
      } else {
        output.writeLine(`Collection failed: ${e.message}`);
      }
      return {
        exitCode: ExitCode.RuntimeError,
        summary: null,
      };
    }
    throw e;
  }
  const findings = rows.map((r) => r.finding);

  const { result, exitCode } = evaluateGate({ findings });

  // Pass findings and verdict to the existing renderer (no replay)
  if (renderer) {
    renderer.onFindings(findings);
    renderer.onVerdict(result);
    renderer.flush();
  }

  return {
    exitCode,
    summary: { findings, verdict: result.verdict, summary: result.summary },
  };
}

function writeRunOutput(
  planId: string,
  runStatus: string,
  eventCount: number,
  durationMs: number,
  global: GlobalFlags,
  output: OutputWriter,
  evalResult: { findings: readonly Finding[]; verdict: string; summary: string } | null,
): void {
  if (global.format === "json") {
    output.writeLine(
      JSON.stringify({
        command: "run",
        data: {
          planId,
          status: runStatus,
          events: eventCount,
          ...(evalResult ? {
            findings: evalResult.findings.length,
            verdict: evalResult.verdict,
            summary: evalResult.summary,
          } : {}),
        },
        durationMs,
      }),
    );
  }
  // Text format: renderer already printed all output including run-completed line.
  // No additional summary needed.
}

function exitCodeForStatus(runStatus: string): ExitCode {
  if (runStatus === "success") return ExitCode.Success;
  if (runStatus === "failure") return ExitCode.PolicyFail;
  return ExitCode.RuntimeError;
}
