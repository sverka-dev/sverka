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
const MIN_STEP_MS = 150;

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
    const key = `${s.isLlmCall}|${s.message}`;
    if (key === prevKey) continue;
    prevKey = key;
    const kind = classify(s);
    const label = toLabel(s);
    out.push({
      stepId: `s${String(++n).padStart(2, "0")} ${kind}: ${label}`,
      kind,
      label,
      detail: s.message,
    });
  }
  return out;
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
  const totalMs = Math.max(result.metrics.executionTimeMs || 0, 1);
  const totalWeight = actions.reduce((a, s) => a + weight(s.kind), 0) || 1;
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
  actions.forEach((a, i) => {
    const dur = Math.max(
      Math.round((totalMs * weight(a.kind)) / totalWeight),
      MIN_STEP_MS,
    );
    events.push({ type: "step-started", stepId: a.stepId, at: t });
    // A failed run's last action is the one that failed — earlier
    // steps still show green; the tail bar carries the error.
    const isLast = i === actions.length - 1;
    events.push(
      !result.success && isLast
        ? {
            type: "step-failed",
            stepId: a.stepId,
            error: result.error ?? "run failed",
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
  const renderer = createHtmlRenderer({
    outputPath,
    graph: traceGraph(actions),
    context: {
      title: `arena: ${result.taskId} — ${combo}`,
      generatedAt: new Date().toISOString(),
      command: "sverka-arena run",
      meta: [
        { label: "task", value: result.taskId },
        { label: "model", value: result.modelId },
        { label: "plugins", value: combo },
        { label: "success", value: String(result.success) },
        {
          label: "timing",
          value:
            "durations estimated — ACP traces have no per-step timestamps; total is real",
        },
      ],
      ...context,
    },
  });
  for (const e of traceToRunEvents(result)) renderer.onEvent(e);
  renderer.flush();
}
