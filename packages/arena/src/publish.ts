/**
 * Publish matrix `ArenaResult`s to a registry — explodes one matrix
 * results.json into one `arena.result/v1` document per
 * (model, plugin-set) cell, then writes result + trace files via the
 * registry backend. Spec: specs/56-arena-eval-service.
 */
import { randomBytes } from "node:crypto";
import { readFile } from "node:fs/promises";

import { ArenaError } from "./config.js";
import type { ArenaResult, RunResult } from "./types.js";
import type {
  ArenaRegistry,
  ArenaResultV1,
  TaskResult,
  TraceInput,
} from "./registry.js";
import { parseArenaResultV1, promptHash, publishBatch } from "./registry.js";

export interface PublishContext {
  /** Task-pack name — the leaderboard's first-level grouping. */
  pack: string;
  /** The run's AgentAdapter.id (matrix results carry no agent field). */
  agent: string;
  /** sverka version stamp — part of the comparability cohort. */
  sverkaVersion: string;
  /** startedAt override (default: result.timestamp). */
  startedAt?: string;
  /** taskId → prompt supplement — used when the file's analysis section
   * does not carry the prompt (e.g. hand-shaped results). */
  prompts?: Record<string, string>;
  /** Trace file paths attached to v1-document publishes (--trace). */
  traces?: readonly string[];
  /** Deterministic runId generator for tests: called per cell. */
  runId?: (cell: { model: string; plugins: string[] }, index: number) => string;
}

/** Unique per-document run id — readable, sortable, collision-free. */
export function newRunId(): string {
  return `run-${Date.now().toString(36)}-${randomBytes(3).toString("hex")}`;
}

/** Registry-safe file stem for a task id. */
function taskStem(taskId: string): string {
  return taskId.replace(/[^a-zA-Z0-9._-]+/g, "-");
}

/**
 * Trace file name for one run — the run's index inside its cell keeps
 * repetitions of the same task apart and disambiguates task ids whose
 * stems collide (`a/b` and `a-b` both stem to `a-b`).
 */
function traceName(runIndex: number, taskId: string): string {
  return `${taskStem(taskId)}.${runIndex}.trace.jsonl`;
}

interface Cell {
  model: string;
  plugins: string[];
  runs: RunResult[];
}

function cellsOf(result: ArenaResult): Cell[] {
  const seen = new Map<string, Cell>();
  const cells: Cell[] = [];
  for (const run of result.results) {
    // JSON tuple key — string concat collides (model "m"+plugin "ab"
    // vs model "ma"+plugin "b" both produced "mab"). localeCompare —
    // default sort order is code-unit order, locale dependent per S2871.
    const plugins = [...run.pluginIds].sort((a, b) => a.localeCompare(b));
    const key = JSON.stringify([run.modelId, plugins]);
    let cell = seen.get(key);
    if (cell === undefined) {
      cell = {
        model: run.modelId,
        plugins,
        runs: [],
      };
      seen.set(key, cell);
      cells.push(cell);
    }
    cell.runs.push(run);
  }
  return cells;
}

function promptFor(
  result: ArenaResult,
  ctx: PublishContext,
  taskId: string,
): string {
  const prompt =
    ctx.prompts?.[taskId] ??
    // `analysis` is required on ArenaResult but publishFile accepts
    // unvalidated JSON — a hand-shaped matrix file may omit it.
    result.analysis?.find((a) => a.taskId === taskId)?.prompt;
  if (prompt === undefined) {
    throw new ArenaError(
      `cannot compute promptHash for task '${taskId}' — the prompt is not in ` +
        `results.analysis and no prompts map was supplied`,
      "SCHEMA_INVALID",
    );
  }
  return prompt;
}

function toTaskResult(
  run: RunResult,
  result: ArenaResult,
  ctx: PublishContext,
  runId: string,
  runIndex: number,
): TaskResult {
  const failedChecks = (run.checkResults ?? []).filter((c) => !c.passed);
  const hasTrace = (run.trace?.steps?.length ?? 0) > 0;
  return {
    task: run.taskId,
    promptHash: promptHash(promptFor(result, ctx, run.taskId)),
    score: { passed: run.success, findings: failedChecks.length },
    metrics: {
      tokens: run.metrics.totalTokens,
      toolCalls: run.metrics.toolCallCount,
      durationMs: run.metrics.executionTimeMs,
      ...(run.metrics.stopReason !== undefined
        ? { stopReason: run.metrics.stopReason }
        : {}),
    },
    ...(hasTrace
      ? { traceRef: `traces/${runId}/${traceName(runIndex, run.taskId)}` }
      : {}),
  };
}

/**
 * Explode a matrix {@link ArenaResult} into one `arena.result/v1`
 * document per (model, plugin-set) cell.
 */
export function explodeResult(
  result: ArenaResult,
  ctx: PublishContext,
): ArenaResultV1[] {
  return cellsOf(result).map((cell, i) => {
    const runId =
      ctx.runId?.({ model: cell.model, plugins: cell.plugins }, i) ??
      newRunId();
    return {
      schema: "arena.result/v1",
      runId,
      pack: ctx.pack,
      agent: ctx.agent,
      model: cell.model,
      plugins: cell.plugins,
      sverkaVersion: ctx.sverkaVersion,
      startedAt: ctx.startedAt ?? result.timestamp,
      tasks: cell.runs.map((r, k) => toTaskResult(r, result, ctx, runId, k)),
    };
  });
}

/**
 * Trace payloads for one cell — `runs[i]` produced `doc.tasks[i]`, so the
 * run index keeps each repetition's trace under its own file (a
 * taskId-keyed Map would collapse repeats to the last run's trace).
 */
function tracePayloads(runs: readonly RunResult[]): TraceInput[] {
  const out: TraceInput[] = [];
  runs.forEach((run, i) => {
    if ((run.trace?.steps?.length ?? 0) > 0) {
      out.push({ name: traceName(i, run.taskId), data: run.trace });
    }
  });
  return out;
}

/**
 * Explode a matrix result and publish every cell document (with its
 * traces) to the registry. Returns the registry-relative result paths.
 */
export async function publishResult(
  result: ArenaResult,
  registry: ArenaRegistry,
  ctx: PublishContext,
): Promise<string[]> {
  const docs = explodeResult(result, ctx);
  const cells = cellsOf(result);
  return publishBatch(
    registry,
    docs.map((doc, i) => ({
      doc,
      opts: { traces: tracePayloads(cells[i]!.runs) },
    })),
    `arena: publish ${ctx.pack}/${ctx.agent} (${docs.length} run${docs.length === 1 ? "" : "s"})`,
  );
}

/**
 * Publish a results file — accepts either an `arena.result/v1` document
 * (or an array of them, published as-is) or a matrix `results.json`
 * (exploded per cell). Returns the registry-relative result paths.
 */
export async function publishFile(
  file: string,
  registry: ArenaRegistry,
  ctx: PublishContext,
): Promise<string[]> {
  let parsed: unknown;
  try {
    parsed = JSON.parse(await readFile(file, "utf8"));
  } catch (err) {
    throw new ArenaError(
      `cannot parse '${file}': ${err instanceof Error ? err.message : String(err)}`,
      "SCHEMA_INVALID",
      err,
    );
  }

  const docs: ArenaResultV1[] = [];
  if (Array.isArray(parsed)) {
    for (const doc of parsed) docs.push(parseArenaResultV1(doc));
  } else if (
    typeof parsed === "object" &&
    parsed !== null &&
    (parsed as { schema?: string }).schema === "arena.result/v1"
  ) {
    docs.push(parseArenaResultV1(parsed));
  } else if (
    typeof parsed === "object" &&
    parsed !== null &&
    Array.isArray((parsed as { results?: unknown }).results)
  ) {
    return publishResult(parsed as ArenaResult, registry, ctx);
  } else {
    throw new ArenaError(
      `'${file}' is neither an arena.result/v1 document nor a matrix results.json`,
      "SCHEMA_INVALID",
    );
  }

  const paths: string[] = [];
  for (const doc of docs) {
    paths.push(
      await registry.publish(doc, {
        ...(ctx.traces !== undefined ? { traces: ctx.traces } : {}),
      }),
    );
  }
  return paths;
}
