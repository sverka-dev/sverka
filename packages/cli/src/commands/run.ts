// run command — execute Run Plan through native engine.
// Spec 17 — §30.

import process from "node:process";
import { join, dirname, resolve, sep } from "node:path";
import { writeFileSync, mkdirSync, realpathSync, existsSync } from "node:fs";
import type { DefinitionGraph } from "@sverka/workflow";
import type { RuntimeDriver } from "@sverka/runtime";
import { createEngine } from "@sverka/runtime";
import type { RunEvent } from "@sverka/runtime";
import { createHostDriver } from "@sverka/runtime";
import type { CommandAllowlist } from "@sverka/runtime";
import { createDockerDriver } from "@sverka/runtime";
import { bindRunPlan } from "@sverka/sdk";
import type { Renderer, FindingRow } from "@sverka/reporter";
import type { Finding } from "@sverka/verification";
import { serializeSarif } from "@sverka/verification";
import type { GlobalFlags, OutputWriter } from "../types.js";
import { CliError, ExitCode } from "../types.js";
import { loadRunGraph } from "../internal/implicit.js";
import { resolveUnderRoot } from "../internal/paths.js";
import { resolveDefaultEntryId, entryExists } from "../internal/graph.js";
import { isBinaryAvailable } from "../internal/runtime-check.js";
import { collectReportContext } from "../internal/report-context.js";
import { watchLoop } from "../internal/watch.js";

export interface RunArgs {
  entryId?: string;
  executor?: "host" | "docker";
  evaluate?: boolean;
  output?: string;
  /** Enable the interactive TUI (opt-in; default output is plain text). */
  tui?: boolean;
  /** Re-run on file changes (Spec 53: debounced, keeps watching on failure). */
  watch?: boolean;
  /** Max steps running concurrently (--jobs). */
  jobs?: number;
  /** Captured stdout/stderr tail lines printed per step (0 disables). */
  stepOutputLines?: number;
  /** Relocate the per-run HTML report (Spec 53; report.json stays put). */
  report?: string;
}

/** Pure-argument guards — an invalid flag fails fast instead of surfacing
 *  as a recurring run failure inside the watch supervisor. */
function validateRunFlags(args: RunArgs): void {
  if (
    args.jobs !== undefined &&
    (!Number.isInteger(args.jobs) || args.jobs < 1 || args.jobs > 64)
  ) {
    throw new CliError(
      "--jobs must be an integer in [1, 64]",
      "INVALID_FLAG",
      ExitCode.UsageError,
    );
  }
  if (
    args.stepOutputLines !== undefined &&
    (!Number.isInteger(args.stepOutputLines) || args.stepOutputLines < 0)
  ) {
    throw new CliError(
      "--step-output-lines must be a non-negative integer",
      "INVALID_FLAG",
      ExitCode.UsageError,
    );
  }
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
  validateRunFlags(args);
  if (args.watch === true) {
    // Dispatch before any graph load: an invalid config is a run result,
    // not a reason to kill the watcher.
    return runWatch(args, global, output);
  }
  const executor = args.executor ?? "host";
  const fmt = resolveFormats(args, global);
  output.debug(
    `run: root=${global.root} executor=${executor} entry=${args.entryId ?? "(first)"} format=${global.format}`,
  );

  assertExecutorAvailable(executor);

  const { graph, warnings, detected } = await loadRunGraph(global);
  if (detected !== undefined) {
    // stderr keeps stdout clean for --format json consumers.
    output.errorLine(
      `no sverka.config — running ${detected.length} detected checks (${detected.join(", ")})`,
    );
  }
  for (const warning of warnings) {
    output.errorLine(`warning: ${warning}`);
  }
  const entryId = resolveEntryId(graph, args.entryId);

  const plan = bindRunPlan({ graph, entryId });

  // Use the project root as the engine workspace so executed commands run
  // against the checked-out project. The engine places per-step scratch
  // directories under .sverka/workspace inside the root.
  const artifactDir = join(global.root, ".sverka", "artifacts");

  const engine = createEngine({
    drivers: buildDrivers(executor),
    maxConcurrent: args.jobs ?? 4,
  });

  const { events, runStatus, renderer } = await consumeEvents(
    engine,
    plan,
    { workspace: global.root, artifactDir },
    global,
    output,
    graph,
    args,
  );

  const durationMs = Date.now() - start;

  // If --evaluate (or --format html), collect findings and run policy gate
  const evaluation = await evaluateRun(
    fmt.evaluate,
    artifactDir,
    global,
    output,
    events,
    renderer,
    args,
    start,
  );

  // Flush the renderer (HtmlRenderer writes the file on flush)
  renderer?.flush();

  // Per-run report artifacts (Spec 53): .sverka/runs/<runId>/report.{json,html}
  const report = await writeReportSafe(
    {
      root: global.root,
      planId: plan.id,
      runStatus,
      durationMs,
      evalResult: evaluation.summary,
      artifactDir,
      sinceMs: start,
      ...(detected !== undefined ? { detected } : {}),
      ...(args.report !== undefined ? { report: args.report } : {}),
    },
    events,
    output,
  );

  // Tell the user where the HTML report went (sarif/web print their own).
  if (fmt.isHtml && renderer) {
    const reportPath =
      args.output ?? join(global.root, ".sverka", "report.html");
    output.writeLine(`Wrote HTML report to ${reportPath}`);
  }

  // Interactive renderers stay mounted until the user quits (q / Ctrl+C).
  if (renderer && "waitUntilExit" in renderer) {
    await (renderer as { waitUntilExit(): Promise<void> }).waitUntilExit();
  }

  // When --evaluate fails with a collection error, the error was already
  // written in the requested format — skip normal output and return.
  if (evaluation.collectionFailed) {
    return evaluation.exitCode;
  }

  writeRunOutput({
    planId: plan.id,
    runStatus,
    events,
    durationMs,
    global,
    output,
    evalResult: evaluation.summary,
    report,
    ...(detected !== undefined ? { detected } : {}),
  });

  // Human-mode tail (Spec 53): findings summary, then the report location —
  // the report is discoverable, not hidden. The `sverka view` hint applies
  // only when report.html sits at the default path — view resolves
  // .sverka/runs/<latest>/report.html, not a --report relocation.
  if (report !== undefined && global.format === "text") {
    output.writeLine(`  findings: ${report.findings}`);
    output.writeLine(
      report.html !== null
        ? args.report !== undefined
          ? `  report: ${report.html}  (open in a browser)`
          : `  report: ${report.html}  (sverka view to open)`
        : `  report: ${report.json}`,
    );
  }

  // When --evaluate is set, policy exit code takes precedence
  if (evaluation.exitCode !== 0) {
    return evaluation.exitCode;
  }

  return exitCodeForStatus(runStatus);
}

interface RunFormats {
  isSarif: boolean;
  isWeb: boolean;
  isHtml: boolean;
  evaluate: boolean;
}

/** Derive output modes — `--format html`, or `--output` without
 *  sarif/web, implies HTML; evaluation runs for any structured format. */
function resolveFormats(args: RunArgs, global: GlobalFlags): RunFormats {
  const isSarif = global.format === "sarif";
  const isWeb = global.format === "web";
  const isHtml =
    global.format === "html" ||
    (args.output !== undefined && !isSarif && !isWeb);
  return {
    isSarif,
    isWeb,
    isHtml,
    evaluate: args.evaluate || isHtml || isSarif || isWeb,
  };
}

interface EvaluationOutcome {
  exitCode: number;
  summary: {
    findings: readonly Finding[];
    verdict: string;
    summary: string;
  } | null;
  collectionFailed: boolean;
}

/** Run findings collection + policy gate when requested; a no-op
 *  success outcome otherwise. */
async function evaluateRun(
  evaluate: boolean,
  artifactDir: string,
  global: GlobalFlags,
  output: OutputWriter,
  events: readonly RunEvent[],
  renderer: Renderer | null,
  args: RunArgs,
  start: number,
): Promise<EvaluationOutcome> {
  if (!evaluate) {
    return { exitCode: 0, summary: null, collectionFailed: false };
  }
  const result = await runEvaluation(
    artifactDir,
    global,
    output,
    events,
    renderer,
    args,
    start,
  );
  return {
    exitCode: result.exitCode,
    summary: result.summary,
    collectionFailed:
      result.summary === null && result.exitCode === ExitCode.RuntimeError,
  };
}

interface ReportContext {
  root: string;
  planId: string;
  runStatus: string;
  durationMs: number;
  evalResult: EvaluationOutcome["summary"];
  artifactDir: string;
  sinceMs: number;
  detected?: readonly string[];
  report?: string;
}

/** Locate the run id — prefer the completion event, fall back to the
 *  start event (a run that failed mid-flight still reports). */
function findRunId(events: readonly RunEvent[]): string | undefined {
  return (
    events.find(
      (e): e is Extract<RunEvent, { type: "run-completed" }> =>
        e.type === "run-completed",
    )?.runId ??
    events.find(
      (e): e is Extract<RunEvent, { type: "run-started" }> =>
        e.type === "run-started",
    )?.runId
  );
}

/** Write .sverka/runs/<runId>/report.{json,html} — best-effort: ordinary
 *  FS failures degrade to a warning; REPORT_PATH_ESCAPE (a CliError)
 *  stays a hard failure. */
async function writeReportSafe(
  ctx: ReportContext,
  events: readonly RunEvent[],
  output: OutputWriter,
): Promise<
  { html: string | null; json: string; findings: number } | undefined
> {
  const runId = findRunId(events);
  if (runId === undefined) return undefined;
  try {
    const artifacts = await writeRunArtifacts({
      root: ctx.root,
      runId,
      planId: ctx.planId,
      runStatus: ctx.runStatus,
      events,
      durationMs: ctx.durationMs,
      evalResult: ctx.evalResult,
      artifactDir: ctx.artifactDir,
      sinceMs: ctx.sinceMs,
      ...(ctx.detected !== undefined ? { detected: ctx.detected } : {}),
      ...(ctx.report !== undefined ? { reportPath: ctx.report } : {}),
    });
    return {
      html: artifacts.htmlPath,
      json: join(artifacts.dir, "report.json"),
      findings: artifacts.findingsCount,
    };
  } catch (err) {
    // REPORT_PATH_ESCAPE is the deliberate security failure — propagate.
    // Anything else (ENOSPC, EACCES) must not turn a successful run into
    // a runtime error: report output is best-effort, warn and move on.
    if (err instanceof CliError) throw err;
    output.errorLine(
      `warning: run report not written: ${err instanceof Error ? err.message : String(err)}`,
    );
    return undefined;
  }
}

/**
 * Watch mode (Spec 53): delegate to the supervisor, which re-invokes
 * runCommand per change — each cycle re-plans, so sverka.config.ts edits
 * are picked up too. Ctrl+C aborts the watcher and exits cleanly.
 */
async function runWatch(
  args: RunArgs,
  global: GlobalFlags,
  output: OutputWriter,
): Promise<number> {
  if (args.tui === true) {
    throw new CliError(
      "--watch is incompatible with --tui (the TUI owns the terminal until exit)",
      "INVALID_FLAG",
      ExitCode.UsageError,
    );
  }
  const ac = new AbortController();
  let forced = false;
  const onSigint = () => {
    // First Ctrl+C asks the watcher to stop gracefully — the in-flight
    // run settles and its code wins. A second Ctrl+C means the user wants
    // out now: a hung run must not pin the terminal.
    if (forced) process.exit(130);
    forced = true;
    ac.abort();
  };
  process.on("SIGINT", onSigint);
  try {
    // An explicit --config outside the watched root would otherwise never
    // retrigger a re-plan. Resolve against the root, same as the loader.
    const configPath =
      global.config === null ? null : resolve(global.root, global.config);
    const extraPaths =
      configPath !== null && !configPath.startsWith(`${resolve(global.root)}/`)
        ? [configPath]
        : [];
    // An in-root --output/--report file is rewritten by every run —
    // watching it would make the run's own artifact retrigger the loop
    // forever. (.sverka/runs/ is ignored by default.)
    const ignored: string[] = [];
    for (const file of [args.output, args.report]) {
      if (file === undefined) continue;
      const abs = resolve(global.root, file);
      if (abs.startsWith(`${resolve(global.root)}/`)) ignored.push(abs);
    }
    const watcher = watchLoop({
      root: global.root,
      extraPaths,
      ignored,
      output,
      signal: ac.signal,
      run: () =>
        runCommand({ ...args, watch: false }, global, output, Date.now()),
    });
    return await watcher.done;
  } finally {
    process.removeListener("SIGINT", onSigint);
  }
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
    throw new CliError(
      "no entries in graph",
      "MISSING_ARG",
      ExitCode.UsageError,
    );
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
): Promise<{
  events: RunEvent[];
  runStatus: string;
  renderer: Renderer | null;
}> {
  const events: RunEvent[] = [];
  let runStatus = "failure";

  // Lazy-import the reporter (~700ms via ink/react) — only paid on `run`.
  const { createTextRenderer, createHtmlRenderer, createInkRenderer } =
    await import("@sverka/reporter");
  let renderer: Renderer | null = null;

  // --output flag implies HTML format (unless sarif/web format is explicit)
  const isSarif = global.format === "sarif";
  const isWeb = global.format === "web";
  const isHtml =
    global.format === "html" ||
    (args.output !== undefined && !isSarif && !isWeb);

  // TUI is strictly opt-in via --tui: `sverka run` prints plain text on
  // every stream, TTY included. Any non-text --format wins over --tui,
  // and --quiet suppresses the TUI (Ink writes to stdout, bypassing the
  // quiet-filtered writer).
  const tuiWanted =
    args.tui === true &&
    !global.quiet &&
    !isHtml &&
    !isSarif &&
    !isWeb &&
    global.format === "text";

  // ANSI colors only on a real terminal that hasn't opted out.
  const color =
    process.stdout.isTTY === true &&
    process.env.NO_COLOR === undefined &&
    process.env.TERM !== "dumb";
  const textRenderer = () =>
    createTextRenderer({
      writer: output,
      color,
      ...(args.stepOutputLines !== undefined
        ? { stepOutputLines: args.stepOutputLines }
        : {}),
    });

  if (tuiWanted) {
    try {
      renderer = createInkRenderer({ graph });
    } catch {
      renderer = textRenderer();
    }
  } else if (global.format === "text" && !isHtml) {
    renderer = textRenderer();
  } else if (isHtml) {
    const outputPath =
      args.output ?? join(global.root, ".sverka", "report.html");
    renderer = createHtmlRenderer({
      outputPath,
      graph,
      context: collectReportContext(
        global.root,
        `sverka ${process.argv.slice(2).join(" ")}`,
      ),
    });
  }

  for await (const event of engine.run({
    plan,
    workspace: ctx.workspace,
    artifactDir: ctx.artifactDir,
  })) {
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
  args: RunArgs,
  /** Run start — scopes collection so stale SARIF from earlier runs
   *  (same shared artifactDir) can't leak into this run's gate. */
  sinceMs: number,
): Promise<{
  exitCode: number;
  summary: {
    findings: readonly Finding[];
    verdict: string;
    summary: string;
  } | null;
}> {
  const { collectFindings, evaluateGate, ReporterError } =
    await import("@sverka/reporter");
  let rows: readonly FindingRow[];
  try {
    rows = await collectFindings({ artifactDir, sinceMs });
  } catch (e) {
    if (e instanceof ReporterError) {
      if (global.format === "json") {
        output.writeLine(
          JSON.stringify({
            command: "run",
            error: "COLLECTION_FAILED",
            message: e.message,
          }),
        );
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

  // --format sarif: serialize findings to SARIF and write to file
  if (global.format === "sarif") {
    const sarifPath =
      args.output ?? join(global.root, ".sverka", "findings.sarif");
    const sarifLog = serializeSarif(findings);
    mkdirSync(dirname(sarifPath), { recursive: true });
    writeFileSync(sarifPath, JSON.stringify(sarifLog, null, 2), "utf-8");
    output.writeLine(`Wrote SARIF to ${sarifPath}`);
  }

  // --format web: generate HTML report using @sverka/sarif-viewer-web
  if (global.format === "web") {
    const webPath = args.output ?? join(global.root, ".sverka", "report.html");
    try {
      const { generateSarifHtml } = await import("@sverka/sarif-viewer-web");
      const html = generateSarifHtml(findings);
      mkdirSync(dirname(webPath), { recursive: true });
      writeFileSync(webPath, html, "utf-8");
      output.writeLine(`Wrote HTML report to ${webPath}`);
    } catch (e) {
      output.errorLine(
        `sverka run: failed to generate web report: ${e instanceof Error ? e.message : String(e)}`,
      );
      return {
        exitCode: 1,
        summary: { findings, verdict: result.verdict, summary: result.summary },
      };
    }
  }

  return {
    exitCode,
    summary: { findings, verdict: result.verdict, summary: result.summary },
  };
}

const SIMPLE_STEP_STATUSES: Readonly<Record<string, StepSummary["status"]>> = {
  "step-skipped": "skipped",
  "step-cancelled": "cancelled",
  "step-suspended": "suspended",
};

/** Extract per-step results from the event stream for JSON output. */
function summarizeSteps(events: readonly RunEvent[]): readonly StepSummary[] {
  const steps: StepSummary[] = [];
  for (const event of events) {
    const step = summarizeStep(event);
    if (step !== undefined) steps.push(step);
  }
  return steps;
}

function summarizeStep(event: RunEvent): StepSummary | undefined {
  if (event.type === "step-succeeded" || event.type === "step-failed") {
    return {
      stepId: event.stepId,
      status: event.type === "step-succeeded" ? "succeeded" : "failed",
      durationMs: event.durationMs,
      ...(event.type === "step-failed" ? { error: event.error } : {}),
      ...capturedOutputFields(event),
    };
  }
  if (event.type === "step-cache-hit") {
    return { stepId: event.stepId, status: "cache-hit", cacheKey: event.key };
  }
  const status = SIMPLE_STEP_STATUSES[event.type];
  if (status === undefined || !("stepId" in event)) return undefined;
  return { stepId: event.stepId, status };
}

function capturedOutputFields(event: {
  stdout?: string;
  stderr?: string;
  exitCode?: number;
}): Pick<StepSummary, "stdout" | "stderr" | "exitCode"> {
  return {
    ...(event.stdout !== undefined ? { stdout: event.stdout } : {}),
    ...(event.stderr !== undefined ? { stderr: event.stderr } : {}),
    ...(event.exitCode !== undefined ? { exitCode: event.exitCode } : {}),
  };
}

interface StepSummary {
  readonly stepId: string;
  readonly status:
    | "succeeded"
    | "failed"
    | "skipped"
    | "cancelled"
    | "suspended"
    | "cache-hit";
  readonly durationMs?: number;
  readonly error?: string;
  readonly cacheKey?: string;
  readonly stdout?: string;
  readonly stderr?: string;
  readonly exitCode?: number;
  readonly truncated?: boolean;
}

interface WriteRunOutputArgs {
  planId: string;
  runStatus: string;
  events: readonly RunEvent[];
  durationMs: number;
  global: GlobalFlags;
  output: OutputWriter;
  evalResult: {
    findings: readonly Finding[];
    verdict: string;
    summary: string;
  } | null;
  report: { html: string | null; json: string; findings: number } | undefined;
  detected?: readonly string[];
}

function writeRunOutput(opts: WriteRunOutputArgs): void {
  const { planId, runStatus, events, durationMs, global, output } = opts;
  const { evalResult, report } = opts;
  if (global.format === "json") {
    const steps = summarizeSteps(events);
    output.writeLine(
      JSON.stringify({
        command: "run",
        data: {
          planId,
          status: runStatus,
          steps,
          ...(opts.detected !== undefined ? { detected: opts.detected } : {}),
          ...(evalResult
            ? {
                findings: evalResult.findings.length,
                verdict: evalResult.verdict,
                summary: evalResult.summary,
              }
            : {}),
          // sverka.run/v1 is append-only — new fields land, never rename.
          // html is exposed only when the file was actually written.
          ...(report !== undefined
            ? {
                report: {
                  json: report.json,
                  ...(report.html !== null ? { html: report.html } : {}),
                  findings: report.findings,
                },
              }
            : {}),
        },
        durationMs,
      }),
    );
  }
  // Text format: renderer already printed all output including run-completed line.
  // No additional summary needed.
}

/** Cap captured step output in the durable report — verbatim stdout/stderr
 *  persists whatever scrolled by, including secrets. The live payload keeps
 *  full output; the on-disk report keeps the last 4 KiB per stream, counted
 *  in UTF-8 bytes so a multibyte stream can't overrun the stated limit. */
const REPORT_OUTPUT_CAP = 4096;

function boundStepOutput(steps: readonly StepSummary[]): StepSummary[] {
  return steps.map((step) => {
    const bound = (text: string | undefined): string | undefined => {
      if (text === undefined) return undefined;
      const buf = Buffer.from(text, "utf8");
      if (buf.length <= REPORT_OUTPUT_CAP) return text;
      // Tail cut in bytes — advance past a split UTF-8 continuation so
      // the kept text never starts mid-character and never exceeds the
      // stated byte limit once re-encoded.
      let cut = buf.length - REPORT_OUTPUT_CAP;
      // .at() not buf[cut] — a JSON.stringify source anywhere in this file
      // plus a bracket-index sink trips semgrep's no-stringify-keys taint.
      while (cut < buf.length && (buf.at(cut)! & 0xc0) === 0x80) cut++;
      return buf.subarray(cut).toString("utf8");
    };
    const stdout = bound(step.stdout);
    const stderr = bound(step.stderr);
    if (stdout === step.stdout && stderr === step.stderr) return step;
    return {
      ...step,
      ...(stdout !== undefined ? { stdout } : {}),
      ...(stderr !== undefined ? { stderr } : {}),
      truncated: true,
    };
  });
}

/** Refuse to write through a path whose real location escapes the project
 *  root — a symlinked `.sverka/…` component is exactly that escape. */
function assertWithinRoot(real: string, realRoot: string, dir: string): void {
  // `--root /` already ends in the separator — a naive `${root}${sep}`
  // prefix would be `//` and reject every in-root path.
  const prefix = realRoot.endsWith(sep) ? realRoot : `${realRoot}${sep}`;
  if (real === realRoot || real.startsWith(prefix)) return;
  throw new CliError(
    `refusing to write run report through symlinked path: ${dir}`,
    "REPORT_PATH_ESCAPE",
    ExitCode.RuntimeError,
  );
}

/** Resolve the per-run report dir, checking the nearest existing ancestor
 *  BEFORE mkdir — mkdir through a symlink is itself the escape. */
function reportDir(root: string, runId: string): string {
  const dir = join(root, ".sverka", "runs", runId);
  const realRoot = realpathSync(root);
  let ancestor = dir;
  while (!existsSync(ancestor)) {
    const parent = dirname(ancestor);
    if (parent === ancestor) break; // reached fs root
    ancestor = parent;
  }
  assertWithinRoot(realpathSync(ancestor), realRoot, dir);
  mkdirSync(dir, { recursive: true });
  assertWithinRoot(realpathSync(dir), realRoot, dir);
  return dir;
}

/** Findings for the report — the eval result when present, else a
 *  collection pass over the artifact dir scoped to this run so a
 *  zero-finding run does not pick up stale SARIF from prior runs. */
async function collectRunFindings(
  opts: {
    evalResult: { findings: readonly Finding[] } | null;
    artifactDir: string;
    sinceMs: number;
  },
  warnings: string[],
): Promise<readonly Finding[]> {
  const fromEval = opts.evalResult?.findings ?? [];
  if (fromEval.length > 0) return fromEval;
  try {
    const { collectFindings } = await import("@sverka/reporter");
    return (
      await collectFindings({
        artifactDir: opts.artifactDir,
        sinceMs: opts.sinceMs,
      })
    ).map((r) => r.finding);
  } catch (e) {
    warnings.push(
      `findings collection failed: ${e instanceof Error ? e.message : String(e)}`,
    );
    return [];
  }
}

/** Best-effort report.html — a render failure never fails the run; it is
 *  recorded in the report's `warnings` instead of being dropped silently. */
async function writeReportHtml(
  htmlPath: string,
  findings: readonly Finding[],
  warnings: string[],
): Promise<string | null> {
  try {
    const { generateSarifHtml } = await import("@sverka/sarif-viewer-web");
    mkdirSync(dirname(htmlPath), { recursive: true });
    writeFileSync(htmlPath, generateSarifHtml(findings), "utf-8");
    return htmlPath;
  } catch (e) {
    warnings.push(
      `report.html generation failed: ${e instanceof Error ? e.message : String(e)}`,
    );
    return null;
  }
}

interface WriteArtifactsOpts {
  root: string;
  runId: string;
  planId: string;
  runStatus: string;
  events: readonly RunEvent[];
  durationMs: number;
  evalResult: {
    findings: readonly Finding[];
    verdict: string;
    summary: string;
  } | null;
  artifactDir: string;
  /** Run start timestamp — scopes artifact collection to this run so a
   *  zero-finding run does not pick up stale SARIF from prior runs. */
  sinceMs: number;
  /** Detected check ids when the run used the implicit zero-config pipeline. */
  detected?: readonly string[];
  /** Explicit --report path — relocates report.html (report.json stays put). */
  reportPath?: string;
}

function runReportPayload(
  opts: WriteArtifactsOpts,
  findingsCount: number,
  warnings: readonly string[],
): Record<string, unknown> {
  return {
    schema: "sverka.run/v1",
    data: {
      planId: opts.planId,
      status: opts.runStatus,
      steps: boundStepOutput(summarizeSteps(opts.events)),
      ...(opts.detected !== undefined ? { detected: opts.detected } : {}),
      // Always present — the count data.report.findings advertises, taken
      // from the same collection report.html rendered (eval findings when
      // the gate ran). verdict/summary stay evaluation-only.
      findings: findingsCount,
      ...(opts.evalResult
        ? {
            verdict: opts.evalResult.verdict,
            summary: opts.evalResult.summary,
          }
        : {}),
      ...(warnings.length > 0 ? { warnings } : {}),
    },
    durationMs: opts.durationMs,
  };
}

/** Write the per-run report artifacts (Spec 53): report.json carries the
 *  sverka.run/v1 payload; report.html renders whatever findings the run
 *  produced (an empty-findings report is still a report). */
async function writeRunArtifacts(
  opts: WriteArtifactsOpts,
): Promise<{ dir: string; htmlPath: string | null; findingsCount: number }> {
  const dir = reportDir(opts.root, opts.runId);
  const warnings: string[] = [];
  const findings = await collectRunFindings(opts, warnings);
  const htmlPath = await writeReportHtml(
    opts.reportPath !== undefined
      ? resolveUnderRoot(opts.root, opts.reportPath)
      : join(dir, "report.html"),
    findings,
    warnings,
  );
  writeFileSync(
    join(dir, "report.json"),
    JSON.stringify(
      runReportPayload(opts, findings.length, warnings),
      null,
      2,
    ),
    "utf-8",
  );
  return { dir, htmlPath, findingsCount: findings.length };
}

function exitCodeForStatus(runStatus: string): ExitCode {
  if (runStatus === "success") return ExitCode.Success;
  if (runStatus === "failure") return ExitCode.PolicyFail;
  return ExitCode.RuntimeError;
}
