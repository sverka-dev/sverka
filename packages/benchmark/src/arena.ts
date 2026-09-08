import { spawn, type ChildProcess } from "node:child_process";
import { Writable, Readable } from "node:stream";
import { cp, mkdir, writeFile } from "node:fs/promises";
import { join } from "node:path";
import { fileURLToPath } from "node:url";
import { dirname, resolve } from "node:path";

import * as acp from "@agentclientprotocol/sdk";
import type {
  PromptResponse,
  Usage,
  SessionUpdate,
  RequestPermissionRequest,
  RequestPermissionResponse,
} from "@agentclientprotocol/sdk";

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
  const usage = promptResult.usage ?? null;
  return {
    inputTokens: usage?.inputTokens ?? 0,
    outputTokens: usage?.outputTokens ?? 0,
    thoughtTokens: usage?.thoughtTokens ?? 0,
    totalTokens: usage?.totalTokens ?? 0,
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
    const { promptResult, toolCallCount } = await runAcpSession(
      proc,
      workspace,
      task.prompt,
      task.timeoutMs ?? 120000,
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
  return spawn("devin", ["acp", "--model", model], {
    cwd: workspace,
    stdio: ["pipe", "pipe", "inherit"],
    env: {
      ...process.env,
      DEVIN_PERMISSION_MODE: "dangerous",
      DEVIN_MODEL: model,
    },
  });
}

/** Run an ACP session: initialize, create session, prompt, collect events. */
async function runAcpSession(
  proc: ChildProcess,
  workspace: string,
  prompt: string,
  timeoutMs: number,
): Promise<{ promptResult: PromptResponse; toolCallCount: number }> {
  if (!proc.stdin || !proc.stdout) {
    throw new Error("Agent process missing stdin/stdout");
  }

  const input = Writable.toWeb(proc.stdin);
  const output = Readable.toWeb(proc.stdout);
  const stream = acp.ndJsonStream(input, output);

  let toolCallCount = 0;

  const promptResult = await acp
    .client({ name: "sverka-benchmark" })
    .onRequest(
      acp.methods.client.session.requestPermission,
      (ctx): RequestPermissionResponse => {
        const options = ctx.params.options;
        const allow = options.find((o) => o.kind === "allow_once" || o.kind === "allow_always");
        return {
          outcome: {
            outcome: "selected",
            optionId: allow?.optionId ?? options[0]?.optionId ?? "",
          },
        };
      },
    )
    .connectWith(stream, async (ctx) => {
      await ctx.request(acp.methods.agent.initialize, {
        protocolVersion: acp.PROTOCOL_VERSION,
        clientCapabilities: {},
      });

      return ctx.buildSession(workspace).withSession(async (session) => {
        const promptPromise = session.prompt(prompt);
        const timeoutPromise = new Promise<never>((_, reject) =>
          setTimeout(() => reject(new Error(`Agent timed out after ${timeoutMs}ms`)), timeoutMs),
        );

        // Collect updates until stop or timeout
        const collectPromise = (async () => {
          for (;;) {
            const message = await session.nextUpdate();
            if (message.kind === "stop") return message.response;
            const update = message.update;
            if (update.sessionUpdate === "tool_call") {
              toolCallCount++;
            }
          }
        })();

        return Promise.race([promptPromise, collectPromise, timeoutPromise]);
      });
    });

  return { promptResult, toolCallCount };
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
