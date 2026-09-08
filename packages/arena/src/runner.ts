/**
 * Matrix runner — executes the full arena matrix:
 *
 *   task × model × plugin combination × repetition
 *
 * For each cell it spawns the agent, runs the prompt, collects the result,
 * and kills the agent. Results are aggregated into {@link ArenaResult}.
 */

import { writeFile, mkdir, cp, rm } from "node:fs/promises";
import { join, resolve } from "node:path";
import { tmpdir } from "node:os";
import { spawn } from "node:child_process";
import { fileURLToPath } from "node:url";

import type {
  ArenaConfig,
  ArenaResult,
  RunResult,
  AggregateMetrics,
  PluginConfig,
  ModelConfig,
  Task,
  CaseAnalysis,
  ComboComparison,
  CheckResult,
} from "./types.js";
import { judgeAllRuns, compareCombos } from "./judge.js";
import { installPlugins } from "./adapters/devin.js";

/** Resolve the arena package root (for fixture paths). */
const PKG_ROOT = resolve(
  typeof __dirname !== "undefined"
    ? __dirname
    : fileURLToPath(new URL(".", import.meta.url)),
  "..",
);

/**
 * Generate all plugin on/off combinations.
 *
 * For N plugins this produces 2^N combinations, each a full copy of the
 * plugins array with `enabled` set appropriately.
 *
 * - 0 plugins → `[[]]` (one empty combination)
 * - 1 plugin  → `[[off], [on]]`
 * - 2 plugins → `[[off,off], [on,off], [off,on], [on,on]]`
 */
export function pluginCombinations(plugins: PluginConfig[]): PluginConfig[][] {
  if (plugins.length === 0) return [[]];

  const combos: PluginConfig[][] = [[]];
  for (const plugin of plugins) {
    const next: PluginConfig[][] = [];
    for (const combo of combos) {
      // Disabled variant
      next.push([
        ...combo,
        { ...plugin, enabled: false },
      ]);
      // Enabled variant
      next.push([
        ...combo,
        { ...plugin, enabled: true },
      ]);
    }
    combos.length = 0;
    combos.push(...next);
  }
  return combos;
}

/**
 * Run the full arena matrix: task × model × plugin combo × repetitions.
 *
 * Each cell spawns the configured agent adapter, installs the plugin
 * combination, runs the prompt, collects trace + metrics, and kills the
 * agent. Results are written to `config.outputDir/results.json` and the
 * full {@link ArenaResult} is returned.
 */
export async function runArena(config: ArenaConfig): Promise<ArenaResult> {
  const repetitions = config.repetitions ?? 1;
  const combos = pluginCombinations(config.plugins);
  const results = await runMatrix(config, combos);
  const aggregates = buildAggregates(results, config.models, combos);

  // Run the judge on all results if configured.
  if (config.judge) {
    const verdicts = await judgeAllRuns(results, config.tasks, config.judge);
    for (const verdict of verdicts) {
      const run = results[verdict.runIndex];
      if (run) run.verdicts.push(verdict);
    }
  }

  const analysis = computeAnalysis(results, config.tasks);
  const arenaResult: ArenaResult = {
    timestamp: new Date().toISOString(),
    config: {
      models: config.models.map((m) => m.id),
      plugins: config.plugins.map((p) => p.id),
      tasks: config.tasks.map((t) => t.id),
      repetitions,
      ...(config.judge ? { judgeModel: config.judge.model.id } : {}),
    },
    results,
    aggregates,
    analysis,
  };

  await mkdir(config.outputDir, { recursive: true });
  await writeFile(
    join(config.outputDir, "results.json"),
    JSON.stringify(arenaResult, null, 2),
    "utf-8",
  );
  return arenaResult;
}

/**
 * Run every cell of the task × model × combo × repetition matrix, collecting
 * results and logging per-cell progress to stderr.
 */
async function runMatrix(
  config: ArenaConfig,
  combos: PluginConfig[][],
): Promise<RunResult[]> {
  const repetitions = config.repetitions ?? 1;
  const results: RunResult[] = [];
  for (const task of config.tasks) {
    for (const model of config.models) {
      for (const combo of combos) {
        for (let rep = 0; rep < repetitions; rep++) {
          const cellLabel = formatCell(task.id, model.id, combo, rep);
          process.stderr.write(`[arena] ${cellLabel} running...\n`);
          const result = await runCell(config.agent, task, model, combo, rep);
          results.push(result);
          process.stderr.write(
            `[arena] ${cellLabel} ${result.success ? "PASS" : "FAIL"} — ` +
              `${result.metrics.totalTokens} tokens, ${result.metrics.toolCallCount} tools, ` +
              `${result.metrics.llmCallCount} llm calls, ${result.metrics.executionTimeMs}ms\n`,
          );
        }
      }
    }
  }
  return results;
}

/**
 * Aggregate metrics per (model × plugin combo) cell.
 */
function buildAggregates(
  results: RunResult[],
  models: ModelConfig[],
  combos: PluginConfig[][],
): AggregateMetrics[] {
  const aggregates: AggregateMetrics[] = [];
  for (const model of models) {
    for (const combo of combos) {
      const pluginIds = combo.filter((p) => p.enabled).map((p) => p.id);
      const label = formatAggregateLabel(model.id, pluginIds);
      aggregates.push(
        aggregateResults(
          results,
          (r) => r.modelId === model.id && samePluginIds(r.pluginIds, pluginIds),
          label,
        ),
      );
    }
  }
  return aggregates;
}

/** Run a single matrix cell in an ISOLATED temp workspace. */
async function runCell(
  agent: ArenaConfig["agent"],
  task: ArenaConfig["tasks"][number],
  model: ArenaConfig["models"][number],
  combo: PluginConfig[],
  rep: number,
): Promise<RunResult> {
  const tempWorkspace = await createTempWorkspace(task, model, combo, rep);
  await installPlugins(tempWorkspace, combo);
  const result = await executeRun(agent, task, model, combo, tempWorkspace);
  await rm(tempWorkspace, { recursive: true, force: true });
  return result;
}

/**
 * Create an isolated temp workspace with a fresh copy of the fixture (if any).
 * Each run gets its own copy to prevent skill contamination from the host repo.
 */
async function createTempWorkspace(
  task: ArenaConfig["tasks"][number],
  model: ArenaConfig["models"][number],
  combo: PluginConfig[],
  rep: number,
): Promise<string> {
  const tempWorkspace = join(
    tmpdir(),
    `arena-${task.id}-${model.id}-${combo.map((p) => p.id + (p.enabled ? "on" : "off")).join(",")}-r${rep}-${Date.now()}`,
  );
  await mkdir(tempWorkspace, { recursive: true });
  if (task.fixture) {
    const fixturePath = resolve(PKG_ROOT, task.fixture);
    await cp(fixturePath, tempWorkspace, { recursive: true });
  }
  return tempWorkspace;
}

/**
 * Spawn the agent, run the prompt, run deterministic checks, and return the
 * result. On error returns a zeroed {@link RunResult} via {@link errorResult}.
 */
async function executeRun(
  agent: ArenaConfig["agent"],
  task: ArenaConfig["tasks"][number],
  model: ArenaConfig["models"][number],
  combo: PluginConfig[],
  tempWorkspace: string,
): Promise<RunResult> {
  const proc = agent.spawn({
    model,
    workspace: tempWorkspace,
    plugins: combo,
    permissionMode: "dangerous",
  });
  try {
    const result = await proc.run(task.prompt, task.timeoutMs ?? 120_000);
    result.taskId = task.id;
    if (!result.verdicts) result.verdicts = [];
    if (!result.checkResults) result.checkResults = [];
    if (task.checks && task.checks.length > 0) {
      result.checkResults = await runChecks(tempWorkspace, task.checks);
      result.success = result.success && result.checkResults.every((c) => c.passed);
    }
    return result;
  } catch (error) {
    return errorResult(task, model, combo, error);
  } finally {
    proc.kill();
  }
}

/** Build a zeroed {@link RunResult} for a failed run. */
function errorResult(
  task: ArenaConfig["tasks"][number],
  model: ArenaConfig["models"][number],
  combo: PluginConfig[],
  error: unknown,
): RunResult {
  return {
    taskId: task.id,
    modelId: model.id,
    pluginIds: combo.filter((p) => p.enabled).map((p) => p.id),
    metrics: {
      inputTokens: 0,
      outputTokens: 0,
      thoughtTokens: 0,
      totalTokens: 0,
      toolCallCount: 0,
      llmCallCount: 0,
      executionTimeMs: 0,
      stopReason: "cancelled",
    },
    trace: {
      sessionId: "",
      model: model.id,
      steps: [],
      finalMetrics: {
        totalPromptTokens: 0,
        totalCompletionTokens: 0,
        totalCachedTokens: 0,
        totalSteps: 0,
      },
    },
    output: "",
    checkResults: [],
    verdicts: [],
    success: false,
    error: error instanceof Error ? error.message : String(error),
  };
}

/** Run deterministic checks in the workspace. */
async function runChecks(
  workspace: string,
  checks: Task["checks"],
): Promise<CheckResult[]> {
  if (!checks) return [];
  const results: CheckResult[] = [];
  for (const check of checks) {
    try {
      const { output, exitCode } = await new Promise<{ output: string; exitCode: number }>((resolve, reject) => {
        const proc = spawn("bash", ["-c", check.command], { // NOSONAR — PATH needed for check commands
          cwd: workspace,
          stdio: ["pipe", "pipe", "pipe"],
          env: { ...process.env, CI: "true" },
        });
        let stdout = "";
        proc.stdout?.on("data", (d: Buffer) => { stdout += d.toString(); });
        proc.stderr?.on("data", (d: Buffer) => { stdout += d.toString(); });
        proc.on("close", (code: number) => {
          resolve({ output: stdout, exitCode: code });
        });
        proc.on("error", reject);
      });
      results.push({
        checkId: check.id,
        passed: exitCode === 0,
        output: output.trim(),
        exitCode,
      });
    } catch (error) {
      results.push({
        checkId: check.id,
        passed: false,
        output: error instanceof Error ? error.message : String(error),
        exitCode: -1,
      });
    }
  }
  return results;
}

/**
 * Aggregate metrics for a group of runs selected by `filter`.
 *
 * Computes averages across all matching runs. Returns zeroed metrics when
 * no runs match. Includes judge-related fields (`avgJudgeScore`,
 * `judgePassCount`) and a `label` identifying the aggregate group.
 */
export function aggregateResults(
  results: RunResult[],
  filter: (r: RunResult) => boolean,
  label = "",
): AggregateMetrics {
  const filtered = results.filter(filter);
  const n = filtered.length;
  if (n === 0) {
    return {
      totalRuns: 0,
      successCount: 0,
      avgInputTokens: 0,
      avgOutputTokens: 0,
      avgTotalTokens: 0,
      avgToolCalls: 0,
      avgLlmCalls: 0,
      avgExecutionTimeMs: 0,
      avgJudgeScore: 0,
      judgePassCount: 0,
      label,
    };
  }
  const sum = (f: (r: RunResult) => number) =>
    filtered.reduce((a, r) => a + f(r), 0);
  const round = (v: number) => Math.round(v);
  const round2 = (v: number) => Math.round(v * 100) / 100;

  // Judge scores: use verdicts[0].score (first judge verdict per run).
  const judgedRuns = filtered.filter((r) => r.verdicts.length > 0);
  const avgJudgeScore =
    judgedRuns.length === 0
      ? 0
      : round2(
          judgedRuns.reduce((a, r) => a + (r.verdicts[0]?.score ?? 0), 0) /
            judgedRuns.length,
        );
  const judgePassCount = filtered.filter(
    (r) => r.verdicts[0]?.passed === true,
  ).length;

  return {
    totalRuns: n,
    successCount: filtered.filter((r) => r.success).length,
    avgInputTokens: round(sum((r) => r.metrics.inputTokens) / n),
    avgOutputTokens: round(sum((r) => r.metrics.outputTokens) / n),
    avgTotalTokens: round(sum((r) => r.metrics.totalTokens) / n),
    avgToolCalls: round2(sum((r) => r.metrics.toolCallCount) / n),
    avgLlmCalls: round2(sum((r) => r.metrics.llmCallCount) / n),
    avgExecutionTimeMs: round(sum((r) => r.metrics.executionTimeMs) / n),
    avgJudgeScore,
    judgePassCount,
    label,
  };
}

/** Compare two plugin-id arrays for equality (order-insensitive). */
function samePluginIds(a: string[], b: string[]): boolean {
  if (a.length !== b.length) return false;
  const set = new Set(a);
  for (const id of b) {
    if (!set.has(id)) return false;
  }
  return true;
}

/** Format a human-readable cell label for logging. */
function formatCell(
  taskId: string,
  modelId: string,
  combo: PluginConfig[],
  rep: number,
): string {
  const plugins = combo
    .map((p) => `${p.id}=${p.enabled ? "on" : "off"}`)
    .join(",");
  return `${taskId}/${modelId}/{${plugins}}#${rep}`;
}

/** Format an aggregate group label: "model-id/plugins=on,off" or "model-id/no-plugins". */
function formatAggregateLabel(modelId: string, pluginIds: string[]): string {
  if (pluginIds.length === 0) return `${modelId}/no-plugins`;
  return `${modelId}/plugins=${pluginIds.join(",")}`;
}

/** Format a plugin combo label for comparisons: "no-plugins" or comma-joined ids. */
function comboLabel(pluginIds: string[]): string {
  if (pluginIds.length === 0) return "no-plugins";
  return pluginIds.join(",");
}

// ─── Case analysis ───────────────────────────────────────────────────

/**
 * Create a synthetic "average" {@link RunResult} representing a group of
 * runs with the same plugin combo. Used to feed {@link compareCombos} which
 * operates on single runs.
 */
function averageRun(runs: RunResult[]): RunResult | null {
  if (runs.length === 0) return null;
  const n = runs.length;
  const avg = (f: (r: RunResult) => number): number =>
    Math.round(runs.reduce((a, r) => a + f(r), 0) / n);
  const avg2 = (f: (r: RunResult) => number): number =>
    Math.round((runs.reduce((a, r) => a + f(r), 0) / n) * 100) / 100;
  const first = runs[0]!;
  return {
    taskId: first.taskId,
    modelId: first.modelId,
    pluginIds: first.pluginIds,
    metrics: {
      inputTokens: avg((r) => r.metrics.inputTokens),
      outputTokens: avg((r) => r.metrics.outputTokens),
      thoughtTokens: avg((r) => r.metrics.thoughtTokens),
      totalTokens: avg((r) => r.metrics.totalTokens),
      toolCallCount: avg2((r) => r.metrics.toolCallCount),
      llmCallCount: avg2((r) => r.metrics.llmCallCount),
      executionTimeMs: avg((r) => r.metrics.executionTimeMs),
      stopReason: first.metrics.stopReason,
    },
    trace: first.trace,
    output: first.output,
    checkResults: first.checkResults ?? [],
    verdicts: first.verdicts,
    success: runs.every((r) => r.success),
  };
}

/**
 * Compute per-task analysis comparing baseline (no plugins) vs each
 * candidate plugin combo.
 *
 * For each task, groups runs by plugin combo, creates an averaged
 * representative run per group, then compares the baseline (empty
 * `pluginIds`) against every non-empty candidate combo using
 * {@link compareCombos} from `judge.ts`.
 */
export function computeAnalysis(
  results: RunResult[],
  tasks: Task[],
): CaseAnalysis[] {
  const analyses: CaseAnalysis[] = [];

  for (const task of tasks) {
    const taskRuns = results.filter((r) => r.taskId === task.id);

    // Group runs by plugin combo (order-insensitive).
    const comboGroups = new Map<string, RunResult[]>();
    for (const run of taskRuns) {
      const key = comboLabel(run.pluginIds);
      const group = comboGroups.get(key);
      if (group) {
        group.push(run);
      } else {
        comboGroups.set(key, [run]);
      }
    }

    const baselineRuns = comboGroups.get("no-plugins") ?? [];
    const baseline = averageRun(baselineRuns);
    const comparisons: ComboComparison[] = [];

    if (baseline) {
      for (const [key, candidateRuns] of comboGroups) {
        if (key === "no-plugins") continue;
        const candidate = averageRun(candidateRuns);
        if (candidate) {
          comparisons.push(compareCombos(baseline, candidate));
        }
      }
    }

    analyses.push({
      taskId: task.id,
      taskName: task.name,
      prompt: task.prompt,
      comparisons,
    });
  }

  return analyses;
}
