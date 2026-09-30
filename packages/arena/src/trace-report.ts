/**
 * Arena trace → sverka report. Spec 52.
 *
 * Timing: fresh traces carry real per-step timestamps — the collector
 * stamps each `session/update` with its arrival time (`ToolCall.
 * collectedAt`), and attached steps inherit it. Older snapshots only
 * have the DB's identical session-end stamps, so for them the report
 * falls back to allocating the real `executionTimeMs` total across
 * steps weighted by kind — tool calls, LLM thinking, plain messages.
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
  /** ISO timestamp from the trace — real when the collector stamped it. */
  at?: string | undefined;
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
    // Provenance: only a timestamp that came from a live collector stamp
    // counts as real — DB session-end stamps are identical across steps
    // and a single live stamp among them must not flip the whole run
    // into real-timing mode.
    const stamped = (s.toolCalls ?? []).some(
      (c) => c.collectedAt !== undefined && c.collectedAt === s.timestamp,
    );
    out.push({
      stepId: `s${String(++n).padStart(2, "0")} ${kind}: ${label}`,
      kind,
      label,
      detail,
      at: stamped ? s.timestamp : undefined,
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

/** Real start offsets (ms) per step, or `undefined` when stamps are unusable. */
function stepStarts(steps: readonly ActionStep[]): number[] | undefined {
  const stamps = steps.map((s) => (s.at ? Date.parse(s.at) : NaN));
  const usable = stamps.filter(Number.isFinite);
  if (usable.length === 0 || new Set(usable).size < 2) return undefined;
  const t0 = Math.min(...usable);
  const out: number[] = [];
  let last = 0;
  for (const s of stamps) {
    if (Number.isFinite(s)) last = Math.max(s - t0, 0);
    out.push(last);
  }
  // All stamps identical → no usable spread, fall back to weights.
  if (out[out.length - 1] === 0) return undefined;
  return out;
}

/** Whether per-step timings in this run come from live ACP events. */
export function hasRealTimings(result: RunResult): boolean {
  return stepStarts(traceToActions(result.trace)) !== undefined;
}

/**
 * Convert a run into a sverka `RunEvent` stream. When steps carry real
 * collector timestamps, `at`/`durationMs` are derived from them (gaps
 * before the first stamped step stay unrepresented; the tail absorbs
 * the remainder of `executionTimeMs`). Otherwise durations are the
 * weighted allocation of the real total.
 */
export function traceToRunEvents(
  result: RunResult,
  opts?: { runId?: string; planId?: string },
): RunEvent[] {
  const actions = traceToActions(result.trace);
  const failed = failureStep(result, actions.length);
  const steps = failed ? [...actions, failed] : actions;
  const totalMs = Math.max(result.metrics.executionTimeMs || 0, 1);
  const starts = stepStarts(steps);
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
    // The last step absorbs the rounding/remainder so durations always
    // sum to the real executionTimeMs.
    const dur =
      i === steps.length - 1
        ? Math.max(totalMs - t, 0)
        : starts
          ? Math.max(Math.min(starts[i + 1]!, totalMs) - t, 0)
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
      value: hasRealTimings(result)
        ? "durations from live ACP event times; total is real"
        : "durations estimated — trace has no per-step timestamps; total is real",
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
