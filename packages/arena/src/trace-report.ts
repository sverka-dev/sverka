/**
 * Arena trace → sverka report. Spec 52.
 *
 * The ACP collector stamps every trace step with the same timestamp
 * (session replay), so real per-step timing does not exist. We still
 * know the true wall-clock total (`metrics.executionTimeMs`), so the
 * report synthesizes per-step durations by allocating the real total
 * across steps weighted by kind — tool calls, LLM thinking, plain
 * messages. Honest totals, estimated breakdown — marked in context.
 */
import type { RunEvent } from "@sverka/runtime";
import type { DefinitionGraph } from "@sverka/workflow";
import type { ReportContext } from "@sverka/reporter";
import { createHtmlRenderer } from "@sverka/reporter";
import type { RunResult, TraceData, TraceStep, ToolCall } from "./types.js";

/** Relative duration weight per step kind — shares of the real total. */
type StepKind = "tool" | "think" | "message";

function weight(kind: StepKind): number {
  if (kind === "tool") return 4;
  if (kind === "think") return 2;
  return 1;
}

/** A trace step drives one Gantt bar. */
export interface ActionStep {
  stepId: string;
  kind: StepKind;
  label: string;
  detail: string;
  /** Set when this step should render as failed (run-level evidence). */
  failed?: string;
}

/** The argument that best summarizes a call (command line, path…). */
function keyArgument(call: ToolCall): string {
  const v =
    call.arguments["command"] ??
    call.arguments["file_path"] ??
    call.arguments["command_text"] ??
    "";
  return typeof v === "string" ? v.replace(/\s+/g, " ") : "";
}

/** Short, readable label for a tool call — function + key argument. */
function toolLabel(s: TraceStep): string {
  const calls = s.toolCalls ?? [];
  const names = calls.map((c) => c.functionName).join(", ");
  const arg = calls.length > 0 ? keyArgument(calls[0]!) : "";
  const base = arg ? `${names}: ${arg}` : names;
  return base.length > 60 ? `${base.slice(0, 59)}…` : base;
}

function classify(s: TraceStep): StepKind {
  if (s.toolCalls && s.toolCalls.length > 0) return "tool";
  if (s.isLlmCall) return "think";
  return "message";
}

function toLabel(s: TraceStep): string {
  if (s.toolCalls && s.toolCalls.length > 0) return toolLabel(s);
  const oneLine = s.message.replace(/\s+/g, " ").trim();
  return oneLine.length > 60 ? `${oneLine.slice(0, 59)}…` : oneLine;
}

/**
 * Extracts a trace into action steps: agent activity only (system/user
 * context is noise for the "what did the agent do" view), adjacent
 * duplicates collapsed (the collector replays each turn twice).
 */
export function traceToActions(trace: TraceData): ActionStep[] {
  const out: ActionStep[] = [];
  let prevKey: string | undefined;
  let n = 0;
  for (const s of trace.steps) {
    if (s.source !== "agent") continue;
    // Dedupe replayed steps — the collector re-emits a turn once per
    // tool call (same message) and again per observation, so identity
    // must include the call ids, not just the message text.
    const callIds = (s.toolCalls ?? [])
      .map((c) => c.toolCallId || c.functionName)
      .join(",");
    const key = `${s.isLlmCall}|${s.message}|${callIds}`;
    if (key === prevKey) continue;
    prevKey = key;
    const kind = classify(s);
    const label = toLabel(s);
    // For tool steps the observations are the tool's own output — pair
    // them under the step that made the call (the message is the
    // preceding reasoning, kept on top for context).
    const outputs = (s.observations ?? []).map((o) => o.content);
    const detail = [s.message, ...outputs].filter(Boolean).join("\n\n");
    out.push({
      stepId: `s${String(++n).padStart(2, "0")} ${kind}: ${label}`,
      kind,
      label,
      detail,
    });
  }
  return out;
}

/**
 * Evidence for a failed run: failing deterministic checks or the run
 * error become a synthetic tail step — never pinned on an arbitrary
 * agent action.
 */
function failureStep(result: RunResult, n: number): ActionStep | undefined {
  if (result.success) return undefined;
  const failedChecks = result.checkResults.filter((c) => !c.passed);
  if (failedChecks.length === 0 && !result.error) return undefined;
  const detail = [
    ...failedChecks.map((c) => `${c.checkId}: ${c.output}`),
    result.error ?? "",
  ]
    .filter(Boolean)
    .join("\n");
  return {
    stepId: `s${String(n + 1).padStart(2, "0")} checks: deterministic`,
    kind: "tool",
    label: "deterministic checks",
    detail,
    failed: result.error ?? `${failedChecks.length} check(s) failed`,
  };
}

/**
 * Convert a run into a sverka `RunEvent` stream. Per-step `at`/`durationMs`
 * are synthetic — allocated from the real `executionTimeMs` total.
 */
export function traceToRunEvents(
  result: RunResult,
  opts?: { runId?: string; planId?: string },
): RunEvent[] {
  const actions = traceToActions(result.trace);
  const failed = failureStep(result, actions.length);
  const steps = failed ? [...actions, failed] : actions;
  const totalMs = Math.max(result.metrics.executionTimeMs || 0, 1);
  const totalWeight = steps.reduce((a, s) => a + weight(s.kind), 0) || 1;
  const runId = opts?.runId ?? `arena-${result.taskId}`;

  const events: RunEvent[] = [
    {
      type: "run-started",
      runId,
      planId: opts?.planId ?? result.taskId,
      at: 0,
    },
  ];

  let t = 0;
  steps.forEach((a, i) => {
    // Weighted share of the REAL total — the last step absorbs the
    // rounding remainder so durations always sum to executionTimeMs.
    const dur =
      i === steps.length - 1
        ? Math.max(totalMs - t, 0)
        : Math.round((totalMs * weight(a.kind)) / totalWeight);
    events.push({ type: "step-started", stepId: a.stepId, at: t });
    events.push(
      a.failed
        ? {
            type: "step-failed",
            stepId: a.stepId,
            error: a.failed,
            durationMs: dur,
            stdout: a.detail,
            at: t + dur,
          }
        : {
            type: "step-succeeded",
            stepId: a.stepId,
            durationMs: dur,
            stdout: a.detail,
            at: t + dur,
          },
    );
    t += dur;
  });

  events.push({
    type: "run-completed",
    runId,
    status: result.success ? "success" : "failure",
    durationMs: t,
    at: t,
  });
  return events;
}

/**
 * Linear-chain graph so the report's DAG view shows the action
 * sequence. Only the fields layoutDag reads are populated.
 */
export function traceGraph(actions: readonly ActionStep[]): DefinitionGraph {
  let prev = "";
  const steps = actions.map((a) => {
    const dependencies = prev
      ? [{ kind: "control" as const, producer: prev }]
      : [];
    prev = a.stepId;
    return { id: a.stepId, dependencies };
  });
  // Minimal graph — layoutDag only reads project.pipelines[].steps
  // ({id, dependencies}).
  return {
    project: {
      id: "arena-trace",
      pipelines: [
        { id: "agent-run", inputs: {}, entries: [], steps, outputs: [] },
      ],
    },
  } as unknown as DefinitionGraph;
}

/** Render a run's trace as a standalone sverka HTML report. */
export function writeTraceReport(
  result: RunResult,
  outputPath: string,
  context?: ReportContext,
): void {
  const actions = traceToActions(result.trace);
  const combo = result.pluginIds.length
    ? result.pluginIds.join("+")
    : "no-plugins";
  // Caller meta extends the defaults — the synthetic-timing row must
  // survive a custom context.
  const meta = [
    { label: "task", value: result.taskId },
    { label: "model", value: result.modelId },
    { label: "plugins", value: combo },
    { label: "success", value: String(result.success) },
    {
      label: "timing",
      value:
        "durations estimated — ACP traces have no per-step timestamps; total is real",
    },
    ...(context?.meta ?? []),
  ];
  const renderer = createHtmlRenderer({
    outputPath,
    graph: traceGraph(actions),
    context: {
      title: `arena: ${result.taskId} — ${combo}`,
      generatedAt: new Date().toISOString(),
      command: "sverka-arena run",
      ...context,
      meta,
    },
  });
  for (const e of traceToRunEvents(result)) renderer.onEvent(e);
  renderer.flush();
}
