/**
 * Devin ACP adapter — spawns `devin acp` as a subprocess and drives an
 * Agent Client Protocol session to collect trace data + metrics.
 *
 * The adapter is abstract over models and plugins: it accepts any
 * {@link ModelConfig} and any set of {@link PluginConfig}s, installs the
 * enabled plugins into the workspace, and runs the prompt against the
 * spawned agent. After the session completes it reads the Devin CLI
 * transcript file to build full {@link TraceData}.
 */

import { spawn, type ChildProcess } from "node:child_process";
import { mkdir, cp, rm, readFile } from "node:fs/promises";
import { existsSync } from "node:fs";
import { join } from "node:path";
import { homedir } from "node:os";

import type { PromptResponse, Usage, ToolCallContent } from "@agentclientprotocol/sdk";

import type {
  AgentAdapter,
  AgentSpawnConfig,
  AgentProcess,
  RunResult,
  RunMetrics,
  TraceData,
  TraceStep,
  ToolCall,
  Observation,
  PluginConfig,
  ModelConfig,
} from "../types.js";
import { sanitizeEnv, runAcpSession } from "../acp.js";
import type { ToolCallMessage, ToolCallUpdateMessage } from "../acp.js";

// ─── Transcript source types (raw JSON from Devin CLI) ───────────────

/** A single step in the raw Devin CLI transcript. */
interface TranscriptStep {
  step_id: number;
  source: "system" | "agent" | "user";
  message: string;
  timestamp: string;
  extra?: {
    generation_model?: string | null;
    telemetry?: {
      source?: string;
      operation?: string;
    } | null;
  } | null;
}

/** Final metrics block in a Devin CLI transcript. */
interface TranscriptMetrics {
  total_prompt_tokens: number;
  total_completion_tokens: number;
  total_cached_tokens: number;
  total_steps: number;
}

/** Full raw transcript written by the Devin CLI. */
interface Transcript {
  session_id: string;
  schema_version: string;
  agent: {
    name: string;
    version: string;
    model_name: string;
  };
  final_metrics: TranscriptMetrics;
  steps: TranscriptStep[];
}

// ─── Helpers ─────────────────────────────────────────────────────────

/** Default transcript directory: ~/.local/share/devin/cli/transcripts */
export function transcriptDir(): string {
  return join(homedir(), ".local", "share", "devin", "cli", "transcripts");
}

/** Read a transcript JSON file by session ID. Throws if not found. */
async function readTranscript(
  sessionId: string,
  dir?: string,
): Promise<Transcript> {
  const path = join(dir ?? transcriptDir(), `${sessionId}.json`);
  const content = await readFile(path, "utf-8");
  return JSON.parse(content) as Transcript;
}

/** Count LLM inference calls in a transcript (agent steps with telemetry.operation === "inference"). */
export function countLlmCalls(transcript: Transcript): number {
  return transcript.steps.filter(
    (s) =>
      s.source === "agent" &&
      s.extra?.telemetry?.operation === "inference",
  ).length;
}

/** Build a {@link TraceStep} from a raw transcript step. */
function buildTraceStep(step: TranscriptStep): TraceStep {
  const isLlmCall =
    step.source === "agent" &&
    step.extra?.telemetry?.operation === "inference";
  return {
    stepId: step.step_id,
    timestamp: step.timestamp,
    source: step.source,
    message: step.message,
    isLlmCall,
  };
}

/** Extract text content from a ToolCallContent array (best-effort). */
function extractTextContent(
  contents: ReadonlyArray<ToolCallContent> | undefined,
): string {
  if (!contents) return "";
  const parts: string[] = [];
  for (const c of contents) {
    if (c.type === "content" && c.content.type === "text") {
      parts.push(c.content.text);
    }
  }
  return parts.join("\n");
}

/** Extract token counts from a Usage object, defaulting to 0. */
export function extractUsageTokens(usage: Usage | null | undefined): {
  inputTokens: number;
  outputTokens: number;
  thoughtTokens: number;
  totalTokens: number;
} {
  return {
    inputTokens: usage?.inputTokens ?? 0,
    outputTokens: usage?.outputTokens ?? 0,
    thoughtTokens: usage?.thoughtTokens ?? 0,
    totalTokens: usage?.totalTokens ?? 0,
  };
}

/** Build {@link RunMetrics} from a PromptResponse + collected counts + timing. */
function buildMetrics(
  promptResult: { stopReason: string; usage?: Usage | null },
  toolCallCount: number,
  llmCallCount: number,
  startTime: number,
): RunMetrics {
  return {
    ...extractUsageTokens(promptResult.usage),
    toolCallCount,
    llmCallCount,
    executionTimeMs: Date.now() - startTime,
    stopReason: promptResult.stopReason,
  };
}

/**
 * Extract the agent's final text output from the prompt response or trace.
 *
 * Prefers the text content from the ACP `PromptResponse`, falling back to
 * the last agent message in the trace.
 */
function extractAgentOutput(
  promptResult: PromptResponse,
  trace: TraceData,
): string {
  // PromptResponse in ACP v1 doesn't have a content field directly.
  // Fall back to the last agent message in the trace.
  for (let i = trace.steps.length - 1; i >= 0; i--) {
    const step = trace.steps[i];
    if (step && step.source === "agent" && step.message.length > 0) {
      return step.message;
    }
  }
  return "";
}

// ─── Plugin installation ─────────────────────────────────────────────

/**
 * Install enabled plugins and remove disabled ones from the workspace.
 *
 * CRITICAL: This function first removes the entire `.agents/skills/`
 * directory to ensure no inherited skills from the host contaminate the
 * benchmark. Only explicitly enabled plugins are installed.
 *
 * Each enabled plugin's `path` is copied to `workspace/.agents/skills/<id>/`.
 */
export async function installPlugins(
  workspace: string,
  plugins: PluginConfig[],
): Promise<void> {
  const skillsDir = join(workspace, ".agents", "skills");

  // Nuke any existing skills directory — we start from a clean slate.
  // This prevents host skill contamination.
  await rm(skillsDir, { recursive: true, force: true });

  // Only create the directory if we have enabled plugins to install.
  const enabledPlugins = plugins.filter((p) => p.enabled);
  if (enabledPlugins.length === 0) return;

  await mkdir(skillsDir, { recursive: true });
  for (const plugin of enabledPlugins) {
    const dest = join(skillsDir, plugin.id);
    await mkdir(dest, { recursive: true });
    await cp(plugin.path, dest, { recursive: true });
  }
}

// ─── Adapter ─────────────────────────────────────────────────────────

/**
 * Devin ACP adapter — spawns `devin acp` as a subprocess.
 *
 * Usage:
 * ```ts
 * const adapter = new DevinAdapter();
 * const proc = adapter.spawn({ model, workspace, plugins });
 * const result = await proc.run("Fix the bug", 120_000);
 * proc.kill();
 * ```
 */
export class DevinAdapter implements AgentAdapter {
  readonly id = "devin";

  spawn(config: AgentSpawnConfig): AgentProcess {
    const proc = spawnDevin(config);
    let killed = false;

    return {
      run: (prompt: string, timeoutMs: number): Promise<RunResult> =>
        runDevinSession(proc, config, prompt, timeoutMs),
      kill: (): void => {
        if (killed) return;
        killed = true;
        proc.kill("SIGTERM");
      },
    };
  }
}

/** Spawn `devin acp --model <model.id>` as a subprocess in the workspace. */
function spawnDevin(config: AgentSpawnConfig): ChildProcess {
  const env = sanitizeEnv(config);
  return spawn("devin", ["acp", "--model", config.model.id], {
    cwd: config.workspace,
    stdio: ["pipe", "pipe", "inherit"],
    env,
  });
}

/** Mutable collection state + callbacks for gathering ACP tool calls and observations. */
interface ToolCollector {
  collectedToolCalls: ToolCall[];
  observationsByCallId: Map<string, Observation>;
  toolCallCount: number;
  onToolCall: (update: ToolCallMessage) => void;
  onToolUpdate: (update: ToolCallUpdateMessage) => void;
}

/** Create a {@link ToolCollector} with callbacks that populate shared state. */
function createToolCollector(): ToolCollector {
  const collectedToolCalls: ToolCall[] = [];
  const observationsByCallId = new Map<string, Observation>();
  let toolCallCount = 0;

  const onToolCall = (update: ToolCallMessage): void => {
    toolCallCount++;
    const name = update.name ?? update.title ?? "unknown";
    const args = (update.rawInput as Record<string, unknown> | null) ?? {};
    collectedToolCalls.push({
      functionName: name,
      arguments: args,
      toolCallId: update.toolCallId,
    });
  };

  const onToolUpdate = (update: ToolCallUpdateMessage): void => {
    const text = extractTextContent(update.content ?? undefined);
    if (text) {
      observationsByCallId.set(update.toolCallId, {
        sourceCallId: update.toolCallId,
        content: text,
      });
    }
  };

  return {
    collectedToolCalls,
    observationsByCallId,
    get toolCallCount() {
      return toolCallCount;
    },
    onToolCall,
    onToolUpdate,
  };
}

/** Build a {@link RunResult} for a failed session (best-effort trace from collected data). */
function buildErrorResult(
  model: ModelConfig,
  pluginIds: string[],
  toolCallCount: number,
  sessionId: string,
  startTime: number,
  error: unknown,
): RunResult {
  const metrics = buildMetrics(
    { stopReason: "cancelled", usage: null },
    toolCallCount,
    0,
    startTime,
  );
  const trace: TraceData = {
    sessionId,
    model: model.id,
    steps: [],
    finalMetrics: {
      totalPromptTokens: 0,
      totalCompletionTokens: 0,
      totalCachedTokens: 0,
      totalSteps: 0,
    },
  };
  return {
    taskId: "",
    modelId: model.id,
    pluginIds,
    metrics,
    trace,
    output: "",
    checkResults: [],
    verdicts: [],
    success: false,
    error: error instanceof Error ? error.message : String(error),
  };
}

/** Run a full ACP session: initialize, create session, prompt, collect events, read transcript. */
async function runDevinSession(
  proc: ChildProcess,
  config: AgentSpawnConfig,
  prompt: string,
  timeoutMs: number,
): Promise<RunResult> {
  const startTime = Date.now();
  const model = config.model;
  const pluginIds = config.plugins.filter((p) => p.enabled).map((p) => p.id);
  const collector = createToolCollector();
  let sessionId = "";

  try {
    const promptResult = await runAcpSession(
      proc,
      config.workspace,
      prompt,
      timeoutMs,
      collector.onToolCall,
      collector.onToolUpdate,
      (id) => {
        sessionId = id;
      },
    );

    const trace = await buildTrace(
      sessionId,
      model,
      collector.collectedToolCalls,
      collector.observationsByCallId,
    );
    const llmCallCount = trace.steps.filter((s) => s.isLlmCall).length;
    const metrics = buildMetrics(promptResult, collector.toolCallCount, llmCallCount, startTime);
    const agentOutput = extractAgentOutput(promptResult, trace);

    return {
      taskId: "",
      modelId: model.id,
      pluginIds,
      metrics,
      trace,
      output: agentOutput,
      checkResults: [],
      verdicts: [],
      success: metrics.stopReason === "end_turn",
    };
  } catch (error) {
    return buildErrorResult(model, pluginIds, collector.toolCallCount, sessionId, startTime, error);
  }
}

/**
 * Build {@link TraceData} from the Devin transcript, enriched with
 * ACP-collected tool calls. Returns `undefined` when no transcript is
 * available so the caller can fall back to {@link buildTraceFallback}.
 */
async function buildTraceFromTranscript(
  sessionId: string,
  collectedToolCalls: ToolCall[],
  observationsByCallId: Map<string, Observation>,
): Promise<TraceData | undefined> {
  if (!sessionId) return undefined;
  try {
    const transcript = await readTranscript(sessionId);
    const steps = transcript.steps.map(buildTraceStep);
    attachToolCallsToSteps(steps, collectedToolCalls, observationsByCallId);
    return {
      sessionId: transcript.session_id,
      model: transcript.agent.model_name,
      steps,
      finalMetrics: {
        totalPromptTokens: transcript.final_metrics.total_prompt_tokens,
        totalCompletionTokens: transcript.final_metrics.total_completion_tokens,
        totalCachedTokens: transcript.final_metrics.total_cached_tokens,
        totalSteps: transcript.final_metrics.total_steps,
      },
    };
  } catch {
    // Transcript not available — fall through to ACP-only trace.
    return undefined;
  }
}

/** Attach ACP-collected tool calls/observations to agent steps in order. */
function attachToolCallsToSteps(
  steps: TraceStep[],
  collectedToolCalls: ToolCall[],
  observationsByCallId: Map<string, Observation>,
): void {
  let toolIdx = 0;
  for (const step of steps) {
    if (step.source !== "agent") continue;
    const attachedCalls: ToolCall[] = [];
    const attachedObs: Observation[] = [];
    if (toolIdx < collectedToolCalls.length) {
      const tc = collectedToolCalls[toolIdx];
      if (tc) {
        attachedCalls.push(tc);
        const obs = observationsByCallId.get(tc.toolCallId);
        if (obs) attachedObs.push(obs);
        toolIdx++;
      }
    }
    if (attachedCalls.length > 0) {
      step.toolCalls = attachedCalls;
    }
    if (attachedObs.length > 0) {
      step.observations = attachedObs;
    }
  }
}

/** Build a minimal {@link TraceData} from ACP-collected data only. */
function buildTraceFallback(
  sessionId: string,
  model: ModelConfig,
  collectedToolCalls: ToolCall[],
  observationsByCallId: Map<string, Observation>,
): TraceData {
  const steps: TraceStep[] = collectedToolCalls.map((tc, i): TraceStep => {
    const obs = observationsByCallId.get(tc.toolCallId);
    const step: TraceStep = {
      stepId: i,
      timestamp: new Date().toISOString(),
      source: "agent",
      message: tc.functionName,
      toolCalls: [tc],
      isLlmCall: false,
    };
    if (obs) {
      step.observations = [obs];
    }
    return step;
  });

  return {
    sessionId,
    model: model.id,
    steps,
    finalMetrics: {
      totalPromptTokens: 0,
      totalCompletionTokens: 0,
      totalCachedTokens: 0,
      totalSteps: steps.length,
    },
  };
}

/** Build {@link TraceData} from the Devin transcript, falling back to ACP-only data. */
async function buildTrace(
  sessionId: string,
  model: ModelConfig,
  collectedToolCalls: ToolCall[],
  observationsByCallId: Map<string, Observation>,
): Promise<TraceData> {
  return (
    (await buildTraceFromTranscript(
      sessionId,
      collectedToolCalls,
      observationsByCallId,
    )) ??
    buildTraceFallback(
      sessionId,
      model,
      collectedToolCalls,
      observationsByCallId,
    )
  );
}

/** Check whether a transcript file exists for a given session id. */
export function transcriptExists(sessionId: string, dir?: string): boolean {
  if (!sessionId) return false;
  return existsSync(join(dir ?? transcriptDir(), `${sessionId}.json`));
}
