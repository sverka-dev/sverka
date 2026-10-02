/**
 * ArenaResult → one sverka report for the whole run matrix.
 *
 * The per-run trace report ({@link ./trace-report.js}) renders a single
 * agent run; this renders the benchmark itself as a pipeline: each task
 * is a pipeline, each run (task × model × plugin combo × repetition) is
 * a step. Durations are the real `executionTimeMs`, so the Gantt view is
 * an honest wall-clock comparison and the DAG shows the run matrix.
 */
import type { RunEvent } from "@sverka/runtime";
import type { DefinitionGraph } from "@sverka/workflow";
import type { ReportContext } from "@sverka/reporter";
import { createHtmlRenderer } from "@sverka/reporter";
import type { ArenaResult, RunResult } from "./types.js";

function comboLabel(result: RunResult): string {
  return result.pluginIds.length ? result.pluginIds.join("+") : "no-plugins";
}

/** Stable per-run step id — readable in the DAG, Gantt and step list. */
export function runStepId(result: RunResult, index: number): string {
  return `${result.taskId}/${result.modelId}/${comboLabel(result)}/r${index + 1}`;
}

function kfmt(n: number): string {
  return n >= 1000 ? `${(n / 1000).toFixed(1)}k` : String(n);
}

function metricsLine(result: RunResult): string {
  const m = result.metrics;
  const judge = result.verdicts?.length
    ? `, judge ${Math.round(
        result.verdicts.reduce((a, v) => a + v.score, 0) /
          result.verdicts.length,
      )}`
    : "";
  return `${kfmt(m.totalTokens)} tokens, ${m.toolCallCount} tool calls, ${m.llmCallCount} llm calls${judge}`;
}

function failureReason(result: RunResult): string {
  const failed = (result.checkResults ?? []).filter((c) => !c.passed);
  if (failed.length > 0) {
    return failed
      .map((c) => `${c.checkId}: ${c.output || `exit ${c.exitCode}`}`)
      .join("; ");
  }
  return "run reported success=false";
}

/**
 * One pipeline per task, one step per run — no edges, so the DAG renders
 * the matrix as a fan-out per task.
 */
export function arenaResultGraph(result: ArenaResult): DefinitionGraph {
  const byTask = new Map<string, { id: string; dependencies: never[] }[]>();
  result.results.forEach((r, i) => {
    const steps = byTask.get(r.taskId) ?? [];
    steps.push({ id: runStepId(r, i), dependencies: [] });
    byTask.set(r.taskId, steps);
  });
  return {
    project: {
      id: "arena",
      pipelines: [...byTask].map(([taskId, steps]) => ({
        id: taskId,
        inputs: {},
        entries: [],
        steps,
        outputs: [],
      })),
    },
  } as unknown as DefinitionGraph;
}

/**
 * Convert the whole matrix into a RunEvent stream. Steps run at their
 * own offsets (staggered by index so the Gantt rows don't collapse) —
 * each step's durationMs is the run's real executionTimeMs.
 */
export function arenaResultToEvents(result: ArenaResult): RunEvent[] {
  const events: RunEvent[] = [
    { type: "run-started", runId: "arena", planId: "arena", at: 0 },
  ];
  let maxEnd = 0;
  result.results.forEach((r, i) => {
    const stepId = runStepId(r, i);
    const dur = Math.max(r.metrics?.executionTimeMs ?? 0, 1);
    const events_ = Math.min(i * 1000, 60_000);
    maxEnd = Math.max(maxEnd, events_ + dur);
    events.push({ type: "step-started", stepId, at: events_ });
    if (r.success) {
      events.push({
        type: "step-succeeded",
        stepId,
        durationMs: dur,
        stdout: metricsLine(r),
        at: events_ + dur,
      });
    } else {
      events.push({
        type: "step-failed",
        stepId,
        error: failureReason(r),
        durationMs: dur,
        stdout: metricsLine(r),
        at: events_ + dur,
      });
    }
    for (const v of r.verdicts ?? []) {
      events.push({
        type: "diagnostic",
        stepId,
        severity: v.passed ? "info" : "warn",
        message: `judge score ${v.score}${v.passed ? "" : " (failed)"}: ${v.reasoning}`,
        at: events_ + dur,
      });
    }
  });
  const anyFail = result.results.some((r) => !r.success);
  events.push({
    type: "run-completed",
    runId: "arena",
    status: anyFail ? "failure" : "success",
    durationMs: maxEnd,
    at: maxEnd,
  });
  return events;
}

/** Render the whole arena matrix as a standalone sverka HTML report. */
export function writeAggregateReport(
  result: ArenaResult,
  outputPath: string,
  context?: ReportContext,
): void {
  const meta = [
    { label: "models", value: result.config.models.join(", ") },
    { label: "plugins", value: result.config.plugins.join(", ") },
    { label: "tasks", value: result.config.tasks.join(", ") },
    { label: "repetitions", value: String(result.config.repetitions) },
    { label: "runs", value: String(result.results.length) },
    ...(result.config.judgeModel
      ? [{ label: "judge", value: result.config.judgeModel }]
      : []),
    ...(context?.meta ?? []),
  ];
  const renderer = createHtmlRenderer({
    outputPath,
    graph: arenaResultGraph(result),
    context: {
      title: "arena aggregate",
      generatedAt: result.timestamp,
      command: "sverka-arena report --format html",
      ...context,
      meta,
    },
  });
  for (const e of arenaResultToEvents(result)) renderer.onEvent(e);
  renderer.flush();
}
