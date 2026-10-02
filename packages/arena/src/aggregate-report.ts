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
export function runStepId(result: RunResult, rep: number): string {
  return `${result.taskId}/${result.modelId}/${comboLabel(result)}/r${rep}`;
}

/**
 * Repetition number within (task, model, combo) — the global matrix
 * index would label task B's first run "r13" in a wide matrix.
 */
function repNumbers(results: readonly RunResult[]): Map<RunResult, number> {
  const counts = new Map<string, number>();
  const reps = new Map<RunResult, number>();
  for (const r of results) {
    const key = `${r.taskId} ${r.modelId} ${comboLabel(r)}`;
    const rep = (counts.get(key) ?? 0) + 1;
    counts.set(key, rep);
    reps.set(r, rep);
  }
  return reps;
}

const SENSITIVE_KEY = /TOKEN|KEY|SECRET|PASSWORD|PASSWD|CREDENTIAL/i;

/**
 * Best-effort secret scrub before run output lands in a public HTML.
 * Word-wise, no content regexes — a scanner-auditable shape.
 */
function redact(text: string): string {
  const words = text.split(" ");
  for (let i = 0; i < words.length; i++) {
    const w = words[i]!;
    const eqIdx = w.indexOf("=");
    const colonIdx = w.indexOf(":");
    const sepIdx = Math.min(
      eqIdx === -1 ? w.length : eqIdx,
      colonIdx === -1 ? w.length : colonIdx,
    );
    if (sepIdx === w.length || sepIdx === 0) continue;
    const key = w.slice(0, sepIdx);
    if (!SENSITIVE_KEY.test(key)) continue;
    if (sepIdx === w.length - 1 && i + 1 < words.length) {
      // "KEY=" or "KEY:" alone — the value is the next word.
      words[i + 1] = "<redacted>";
    } else {
      words[i] = `${key}=<redacted>`;
    }
  }
  return words.join(" ").replace(/Bearer\s+\S+/gi, "Bearer <redacted>");
}

function formatTokens(n: number): string {
  return n >= 1000 ? `${(n / 1000).toFixed(1)}k` : String(n);
}

function metricsLine(result: RunResult): string {
  const m = result.metrics;
  if (m === undefined) return "no metrics recorded";
  const judge = result.verdicts?.length
    ? `, judge ${Math.round(
        result.verdicts.reduce((a, v) => a + v.score, 0) /
          result.verdicts.length,
      )}`
    : "";
  return `${formatTokens(m.totalTokens)} tokens, ${m.toolCallCount} tool calls, ${m.llmCallCount} llm calls${judge}`;
}

function failureReason(result: RunResult): string {
  const failed = (result.checkResults ?? []).filter((c) => !c.passed);
  if (failed.length > 0) {
    return redact(
      failed
        .map((c) => `${c.checkId}: ${c.output || "exit " + c.exitCode}`)
        .join("; "),
    );
  }
  return redact(result.error ?? "run reported success=false");
}

/**
 * One pipeline per task, one step per run — no edges, so the DAG renders
 * the matrix as a fan-out per task.
 */
export function arenaResultGraph(result: ArenaResult): DefinitionGraph {
  const byTask = new Map<string, { id: string; dependencies: never[] }[]>();
  const reps = repNumbers(result.results);
  for (const r of result.results) {
    const steps = byTask.get(r.taskId) ?? [];
    steps.push({ id: runStepId(r, reps.get(r)!), dependencies: [] });
    byTask.set(r.taskId, steps);
  }
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
 * Convert the whole matrix into a RunEvent stream. Runs are laid out
 * serially — each starts when the previous ended — because arena
 * executes the matrix sequentially; the Gantt then reads as the real
 * wall-clock timeline and `run-completed` carries the honest total.
 */
export function arenaResultToEvents(result: ArenaResult): RunEvent[] {
  const events: RunEvent[] = [
    { type: "run-started", runId: "arena", planId: "arena", at: 0 },
  ];
  let t = 0;
  const reps = repNumbers(result.results);
  for (const r of result.results) {
    const stepId = runStepId(r, reps.get(r)!);
    const dur = Math.max(r.metrics?.executionTimeMs ?? 0, 0);
    const start = t;
    t += dur;
    events.push({ type: "step-started", stepId, at: start });
    if (r.metrics?.executionTimeMs === undefined || dur === 0) {
      events.push({
        type: "diagnostic",
        stepId,
        severity: "info",
        message: "no duration recorded — run failed before/without timing",
        at: start,
      });
    }
    if (r.success) {
      events.push({
        type: "step-succeeded",
        stepId,
        durationMs: dur,
        stdout: metricsLine(r),
        at: start + dur,
      });
    } else {
      events.push({
        type: "step-failed",
        stepId,
        error: failureReason(r),
        durationMs: dur,
        stdout: metricsLine(r),
        at: start + dur,
      });
    }
    for (const v of r.verdicts ?? []) {
      events.push({
        type: "diagnostic",
        stepId,
        severity: v.passed ? "info" : "warn",
        message: redact(
          `judge score ${v.score}${v.passed ? "" : " (failed)"}: ${v.reasoning}`,
        ),
        at: start + dur,
      });
    }
  }
  const anyFail = result.results.some((r) => !r.success);
  events.push({
    type: "run-completed",
    runId: "arena",
    status: anyFail ? "failure" : "success",
    durationMs: t,
    at: t,
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
      generatedAt: result.timestamp ?? new Date().toISOString(),
      command: "sverka-arena report --format html",
      ...context,
      meta,
    },
  });
  for (const e of arenaResultToEvents(result)) renderer.onEvent(e);
  renderer.flush();
}
