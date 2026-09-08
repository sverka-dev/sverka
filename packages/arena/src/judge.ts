/**
 * Judge module — blind LLM evaluation of run outputs.
 *
 * The judge receives the task prompt + the agent's output and scores it
 * against the success criteria. It does NOT know which plugins were active
 * (blind evaluation) unless {@link JudgeConfig.revealPlugins} is set.
 *
 * The judge itself is driven through the same {@link AgentAdapter}
 * interface as the agent under test: it is spawned, sent a prompt, and
 * killed after the response is collected.
 */

import type {
  JudgeConfig,
  JudgeVerdict,
  RunResult,
  Task,
  ComboComparison,
} from "./types.js";

/** Default system prompt for the judge. */
export const DEFAULT_JUDGE_PROMPT =
  "You are a blind evaluator. You will receive a task prompt and an agent's " +
  "response. Score the response 0-100 based on how well it completes the " +
  "task. Be strict but fair. Output JSON: " +
  '{"score": number, "passed": boolean, "reasoning": string, "issues": string[]}. ' +
  "A score of 70+ is passing.";

/** Default timeout for a single judge run (ms). */
const DEFAULT_JUDGE_TIMEOUT_MS = 120_000;

/**
 * Build the judge prompt for a single run.
 *
 * Includes the task prompt, success criteria, and the agent's output. Does
 * NOT include which plugins were active unless `config.revealPlugins` is
 * true. Asks the judge for a JSON response with score, passed, reasoning,
 * and issues.
 */
export function buildJudgePrompt(
  task: Task,
  runOutput: string,
  config: JudgeConfig,
): string {
  const systemPrompt = config.systemPrompt ?? DEFAULT_JUDGE_PROMPT;
  const lines: string[] = [];

  lines.push(systemPrompt);
  lines.push("");
  lines.push("## Task Prompt");
  lines.push(task.prompt);
  lines.push("");

  if (task.successCriteria) {
    lines.push("## Success Criteria");
    lines.push(task.successCriteria);
    lines.push("");
  }

  if (config.revealPlugins && task.id) {
    // Only reveal plugin info when explicitly requested. The run itself
    // carries the plugin ids; we surface them here for transparency.
    lines.push("## Plugins Active During Run");
    lines.push("(revealed by configuration)");
    lines.push("");
  }

  lines.push("## Agent Response");
  lines.push(runOutput || "(no output)");
  lines.push("");

  lines.push(
    "## Instructions\n" +
      "Evaluate the agent's response against the task prompt and success " +
      'criteria. Respond with ONLY a JSON object: {"score": number, "passed": ' +
      'boolean, "reasoning": string, "issues": string[]}. A score of 70 or ' +
      "above is passing. Do not include any text outside the JSON.",
  );

  return lines.join("\n");
}

/**
 * Parse a judge response into a {@link JudgeVerdict}.
 *
 * Extracts JSON from the response, handling markdown code fences
 * (` ```json ... ``` `). Falls back to `score=0, passed=false` when the
 * response cannot be parsed.
 */
export function parseJudgeResponse(
  response: string,
  runIndex: number,
  run: RunResult,
): JudgeVerdict {
  const jsonText = extractJson(response);
  const fallback: JudgeVerdict = {
    runIndex,
    score: 0,
    passed: false,
    reasoning: response.trim() || "Failed to parse judge response",
    issues: [],
    taskId: run.taskId,
    modelId: run.modelId,
    pluginIds: run.pluginIds,
  };

  if (jsonText === null) {
    return fallback;
  }

  let parsed: unknown;
  try {
    parsed = JSON.parse(jsonText);
  } catch {
    return fallback;
  }

  if (typeof parsed !== "object" || parsed === null) {
    return fallback;
  }

  const obj = parsed as Record<string, unknown>;
  const score = typeof obj.score === "number" ? obj.score : 0;
  const passed =
    typeof obj.passed === "boolean" ? obj.passed : score >= 70;
  const reasoning =
    typeof obj.reasoning === "string" ? obj.reasoning : "";
  const issues = Array.isArray(obj.issues)
    ? obj.issues.filter((i): i is string => typeof i === "string")
    : [];

  return {
    runIndex,
    score,
    passed,
    reasoning,
    issues,
    taskId: run.taskId,
    modelId: run.modelId,
    pluginIds: run.pluginIds,
  };
}

/**
 * Judge a single run — spawn the judge agent, send the prompt, collect the
 * response, parse it into a {@link JudgeVerdict}, and kill the agent.
 */
export async function judgeRun(
  run: RunResult,
  task: Task,
  config: JudgeConfig,
  runIndex: number,
): Promise<JudgeVerdict> {
  const prompt = buildJudgePrompt(task, run.output, config);

  const proc = config.agent.spawn({
    model: config.model,
    workspace: process.cwd(),
    plugins: [],
    permissionMode: "dangerous",
  });

  try {
    const result = await proc.run(prompt, DEFAULT_JUDGE_TIMEOUT_MS);
    return parseJudgeResponse(result.output, runIndex, run);
  } catch (error) {
    return {
      runIndex,
      score: 0,
      passed: false,
      reasoning:
        error instanceof Error ? error.message : String(error),
      issues: [],
      taskId: run.taskId,
      modelId: run.modelId,
      pluginIds: run.pluginIds,
    };
  } finally {
    proc.kill();
  }
}

/**
 * Judge all runs in a list, pairing each run with its matching task.
 *
 * Supports `config.repetitions` — the judge is run N times per run for
 * confidence. All verdicts are returned (one per repetition).
 */
export async function judgeAllRuns(
  results: RunResult[],
  tasks: Task[],
  config: JudgeConfig,
): Promise<JudgeVerdict[]> {
  const taskById = new Map<string, Task>();
  for (const task of tasks) {
    taskById.set(task.id, task);
  }

  const repetitions = config.repetitions ?? 1;
  const verdicts: JudgeVerdict[] = [];

  for (let i = 0; i < results.length; i++) {
    const run = results[i];
    if (!run) continue;
    const task = taskById.get(run.taskId);
    if (!task) continue;

    for (let rep = 0; rep < repetitions; rep++) {
      // eslint-disable-next-line no-await-in-loop
      const verdict = await judgeRun(run, task, config, i);
      verdicts.push(verdict);
    }
  }

  return verdicts;
}

/**
 * Compare two plugin combos for a task (for {@link ComboComparison}).
 *
 * Computes deltas as `candidate - baseline`. Determines whether the
 * candidate is better:
 *   - Lower tokens / toolCalls / llmCalls / time = better
 *   - Higher judgeScore = better
 *
 * The judge score for each run is the average of its verdicts' scores
 * (0 when there are no verdicts).
 */
export function compareCombos(
  baseline: RunResult,
  candidate: RunResult,
): ComboComparison {
  const baselineScore = avgJudgeScore(baseline);
  const candidateScore = avgJudgeScore(candidate);

  const deltaTokens =
    candidate.metrics.totalTokens - baseline.metrics.totalTokens;
  const deltaToolCalls =
    candidate.metrics.toolCallCount - baseline.metrics.toolCallCount;
  const deltaLlmCalls =
    candidate.metrics.llmCallCount - baseline.metrics.llmCallCount;
  const deltaTimeMs =
    candidate.metrics.executionTimeMs - baseline.metrics.executionTimeMs;
  const deltaJudgeScore = candidateScore - baselineScore;

  // Candidate is better when it uses fewer resources OR scores higher.
  // A strictly better on score, or equal score with fewer resources.
  const fewerResources =
    deltaTokens <= 0 &&
    deltaToolCalls <= 0 &&
    deltaLlmCalls <= 0 &&
    deltaTimeMs <= 0;

  const candidateBetter =
    deltaJudgeScore > 0 || (deltaJudgeScore === 0 && fewerResources &&
      (deltaTokens < 0 || deltaToolCalls < 0 || deltaLlmCalls < 0 || deltaTimeMs < 0));

  return {
    baseline: comboLabel(baseline),
    candidate: comboLabel(candidate),
    deltaTokens,
    deltaToolCalls,
    deltaLlmCalls,
    deltaTimeMs,
    deltaJudgeScore,
    candidateBetter,
  };
}

// ─── Helpers ─────────────────────────────────────────────────────────

/**
 * Extract the first JSON object from a response string.
 *
 * Handles raw JSON and JSON wrapped in markdown code fences
 * (` ```json ... ``` ` or ` ``` ... ``` `). Returns `null` when no JSON
 * object can be located.
 */
function extractJson(response: string): string | null {
  const trimmed = response.trim();
  if (trimmed === "") return null;

  // Try fenced block first: ```json ... ``` or ``` ... ```
  // Use string search instead of regex to avoid ReDoS on pathological input.
  const fenceStart = trimmed.indexOf("```");
  if (fenceStart !== -1) {
    const afterFence = trimmed.slice(fenceStart + 3);
    // Skip optional "json" label
    let contentStart = 0;
    if (afterFence.startsWith("json")) {
      contentStart = 4;
    }
    // Skip whitespace after label
    while (contentStart < afterFence.length && /\s/.test(afterFence[contentStart]!)) {
      contentStart++;
    }
    const fenceEnd = afterFence.indexOf("```", contentStart);
    if (fenceEnd !== -1) {
      const inner = afterFence.slice(contentStart, fenceEnd).trim();
      if (looksLikeJson(inner)) return inner;
    }
  }

  // Try to locate the first {...} block in the raw text.
  const start = trimmed.indexOf("{");
  const end = trimmed.lastIndexOf("}");
  if (start !== -1 && end !== -1 && end > start) {
    return trimmed.slice(start, end + 1);
  }

  return null;
}

/** Quick check that a string starts with `{` (a JSON object). */
function looksLikeJson(text: string): boolean {
  return text.trim().startsWith("{");
}

/** Average judge score across a run's verdicts (0 when no verdicts). */
function avgJudgeScore(run: RunResult): number {
  if (run.verdicts.length === 0) return 0;
  const sum = run.verdicts.reduce((a, v) => a + v.score, 0);
  return sum / run.verdicts.length;
}

/** Build a human-readable combo label for a run's plugin set. */
function comboLabel(run: RunResult): string {
  if (run.pluginIds.length === 0) return "no-plugins";
  return run.pluginIds.join(",");
}
