import { spawn, type ChildProcess } from "node:child_process";
import { cp, mkdir, writeFile } from "node:fs/promises";
import { join } from "node:path";
import { fileURLToPath } from "node:url";
import { dirname, resolve } from "node:path";

import type { Usage } from "@agentclientprotocol/sdk";

import { sanitizeEnv, runAcpSession, extractUsageTokens } from "@sverka/arena";

import type {
  Task,
  AgentConfig,
  RunMetrics,
  RunResult,
  AggregateMetrics,
  BenchmarkResult,
  BenchmarkConfig,
} from "./types.js";

/** Extract RunMetrics from a PromptResponse + collected event data. */
export function extractMetrics(
  promptResult: { stopReason: string; usage?: Usage | null },
  toolCallCount: number,
  startTime: number,
): RunMetrics {
  return {
    ...extractUsageTokens(promptResult.usage),
    toolCallCount,
    executionTimeMs: Date.now() - startTime,
    stopReason: promptResult.stopReason,
  };
}

/** Aggregate metrics for one agent type across multiple RunResults. */
export function aggregateMetrics(
  results: RunResult[],
  agentType: string,
): AggregateMetrics {
  const filtered = results.filter((r) => r.agentType === agentType);
  const n = filtered.length;
  if (n === 0) {
    return {
      totalTasks: 0,
      successCount: 0,
      avgInputTokens: 0,
      avgOutputTokens: 0,
      avgTotalTokens: 0,
      avgToolCalls: 0,
      avgExecutionTimeMs: 0,
    };
  }
  const sum = (f: (r: RunResult) => number) => filtered.reduce((a, r) => a + f(r), 0);
  return {
    totalTasks: n,
    successCount: filtered.filter((r) => r.success).length,
    avgInputTokens: Math.round(sum((r) => r.metrics.inputTokens) / n),
    avgOutputTokens: Math.round(sum((r) => r.metrics.outputTokens) / n),
    avgTotalTokens: Math.round(sum((r) => r.metrics.totalTokens) / n),
    avgToolCalls: Math.round((sum((r) => r.metrics.toolCallCount) / n) * 100) / 100,
    avgExecutionTimeMs: Math.round(sum((r) => r.metrics.executionTimeMs) / n),
  };
}

/** Run the full benchmark: each task × each agent, sequentially. */
export async function runBenchmark(
  config: BenchmarkConfig,
): Promise<BenchmarkResult> {
  const model = config.model ?? "glm-5-2";
  const results: RunResult[] = [];

  for (const task of config.tasks) {
    for (const agent of config.agents) {
      process.stderr.write(`[${task.id}/${agent.id}] Running...\n`);
      const result = await runTask(task, agent, model);
      results.push(result);
      process.stderr.write(
        `[${task.id}/${agent.id}] ${result.success ? "PASS" : "FAIL"} — ` +
          `${result.metrics.totalTokens} tokens, ${result.metrics.toolCallCount} tools, ` +
          `${result.metrics.executionTimeMs}ms\n`,
      );
    }
  }

  return {
    timestamp: new Date().toISOString(),
    model,
    results,
    summary: {
      "raw-shell": aggregateMetrics(results, "raw-shell"),
      sverka: aggregateMetrics(results, "sverka"),
    },
  };
}

/** Run a single task with one agent. */
async function runTask(
  task: Task,
  agent: AgentConfig,
  model: string,
): Promise<RunResult> {
  const workspace = await setupWorkspace(agent);
  const startTime = Date.now();
  let proc: ChildProcess | null = null;

  try {
    proc = spawnAcpAgent(workspace, model);
    let toolCallCount = 0;
    const promptResult = await runAcpSession(
      proc,
      workspace,
      task.prompt,
      task.timeoutMs ?? 120000,
      () => {
        toolCallCount++;
      },
    );
    const metrics = extractMetrics(promptResult, toolCallCount, startTime);
    return {
      taskId: task.id,
      agentId: agent.id,
      agentType: agent.type,
      metrics,
      success: metrics.stopReason === "end_turn",
    };
  } catch (error) {
    const metrics = extractMetrics(
      { stopReason: "cancelled", usage: null },
      0,
      startTime,
    );
    return {
      taskId: task.id,
      agentId: agent.id,
      agentType: agent.type,
      metrics,
      success: false,
      error: error instanceof Error ? error.message : String(error),
    };
  } finally {
    proc?.kill("SIGTERM");
  }
}

/** Set up workspace for an agent.
 *
 *  Both agents work in the actual Sverka repo so they have the real project
 *  to operate on. The only difference is that the "sverka" agent gets the
 *  Sverka skill installed in .agents/skills/sverka/.
 *
 *  We do NOT create a temp copy — copying node_modules + dist is too slow
 *  and the agents need the real build artifacts to run `sverka` commands.
 */
async function setupWorkspace(agent: AgentConfig): Promise<string> {
  const here = dirname(fileURLToPath(import.meta.url));
  const repoRoot = resolve(here, "..", "..", "..");
  const workspace = repoRoot;

  if (agent.type === "sverka") {
    // Skill is already in the repo at .agents/skills/sverka/SKILL.md
    // No need to copy — just ensure the directory exists
    const skillDir = join(workspace, ".agents", "skills", "sverka");
    const skillFile = join(skillDir, "SKILL.md");
    try {
      await mkdir(skillDir, { recursive: true });
      const repoSkillPath = resolveRepoFile(".agents/skills/sverka/SKILL.md");
      if (repoSkillPath && resolve(repoSkillPath) !== resolve(skillFile)) {
        await cp(repoSkillPath, skillFile, { recursive: true });
      }
    } catch {
      // Skill already exists — that's fine
    }
  }

  return workspace;
}

/** Spawn `devin acp` as a subprocess in the given workspace. */
function spawnAcpAgent(workspace: string, model: string): ChildProcess {
  const env = sanitizeEnv({
    model: { id: model, name: model },
    workspace,
    plugins: [],
  });
  return spawn("devin", ["acp", "--model", model], { // NOSONAR — PATH needed for devin binary
    cwd: workspace,
    stdio: ["pipe", "pipe", "inherit"],
    env,
  });
}

/** Write benchmark results to a JSON file. */
export async function writeReport(
  result: BenchmarkResult,
  outputPath: string,
): Promise<void> {
  const json = JSON.stringify(result, null, 2);
  await writeFile(outputPath, json, "utf-8");
}

/** Resolve a file path relative to the repo root. */
function resolveRepoFile(relPath: string): string | null {
  try {
    const here = dirname(fileURLToPath(import.meta.url));
    // From packages/benchmark/src/ or packages/benchmark/dist/ go up to repo root
    const repoRoot = resolve(here, "..", "..", "..");
    return join(repoRoot, relPath);
  } catch {
    return null;
  }
}
