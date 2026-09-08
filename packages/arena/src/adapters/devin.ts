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
import { Writable, Readable } from "node:stream";
import { mkdir, cp, rm, readFile } from "node:fs/promises";
import { existsSync } from "node:fs";
import { join } from "node:path";
import { homedir } from "node:os";

import * as acp from "@agentclientprotocol/sdk";
import type {
  PromptResponse,
  Usage,
  RequestPermissionResponse,
  ToolCallContent,
} from "@agentclientprotocol/sdk";

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

/** Build {@link RunMetrics} from a PromptResponse + collected counts + timing. */
function buildMetrics(
  promptResult: { stopReason: string; usage?: Usage | null },
  toolCallCount: number,
  llmCallCount: number,
  startTime: number,
): RunMetrics {
  const usage = promptResult.usage ?? null;
  return {
    inputTokens: usage?.inputTokens ?? 0,
    outputTokens: usage?.outputTokens ?? 0,
    thoughtTokens: usage?.thoughtTokens ?? 0,
    totalTokens: usage?.totalTokens ?? 0,
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
  const model = config.model;
  const permissionMode = config.permissionMode ?? "dangerous";

  // ── Environment sanitization ──────────────────────────────────────
  // Strip out host contamination: Gas City, Beads, MCP servers, project
  // skills, and other variables that would leak the host's configuration
  // into the benchmark. The agent must only see what we explicitly install.
  const SANITIZE_PREFIXES = [
    "GC_",
    "BEADS_",
    "BD_",
    "MCP_",
    "CLAUDECODE",
    "CLAUDE_CODE_",
    "CODEX_",
  ];
  const SANITIZE_EXACT = new Set([
    "DEVIN_PERMISSION_MODE",
    "DEVIN_MODEL",
    "AGENTS_MD",
    "CLAUDE_PROJECT_MD",
  ]);

  const env: Record<string, string> = {};
  for (const [key, value] of Object.entries(process.env)) {
    if (value === undefined) continue;
    // Skip variables that match sanitize prefixes or exact names.
    if (SANITIZE_EXACT.has(key)) continue;
    if (SANITIZE_PREFIXES.some((p) => key.startsWith(p))) continue;
    env[key] = value;
  }

  // Set only what the agent needs.
  env.DEVIN_PERMISSION_MODE = permissionMode;
  env.DEVIN_MODEL = model.envVar ? (env[model.envVar] ?? model.id) : model.id;
  if (model.envVar) {
    env[model.envVar] = env[model.envVar] ?? model.id;
  }
  // Merge any explicit env overrides from config (these win).
  if (config.env) {
    for (const [key, value] of Object.entries(config.env)) {
      env[key] = value;
    }
  }

  return spawn("devin", ["acp", "--model", model.id], {
    cwd: config.workspace,
    stdio: ["pipe", "pipe", "inherit"],
    env,
  });
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

  if (!proc.stdin || !proc.stdout) {
    throw new Error("Devin agent process missing stdin/stdout");
  }

  // Collect tool calls + observations from ACP events in real time.
  const collectedToolCalls: ToolCall[] = [];
  const observationsByCallId = new Map<string, Observation>();
  let toolCallCount = 0;
  let sessionId = "";

  try {
    const input = Writable.toWeb(proc.stdin);
    const output = Readable.toWeb(proc.stdout);
    const stream = acp.ndJsonStream(input, output);

    const promptResult = await acp
      .client({ name: "sverka-arena" })
      .onRequest(
        acp.methods.client.session.requestPermission,
        (ctx): RequestPermissionResponse => {
          const options = ctx.params.options;
          const allow = options.find(
            (o) => o.kind === "allow_once" || o.kind === "allow_always",
          );
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

        return ctx.buildSession(config.workspace).withSession(async (session) => {
          sessionId = session.sessionId;
          const promptPromise = session.prompt(prompt);
          const timeoutPromise = new Promise<never>((_, reject) =>
            setTimeout(
              () => reject(new Error(`Agent timed out after ${timeoutMs}ms`)),
              timeoutMs,
            ),
          );

          // Collect updates until stop or timeout.
          const collectPromise = (async (): Promise<PromptResponse> => {
            for (;;) {
              const message = await session.nextUpdate();
              if (message.kind === "stop") return message.response;
              const update = message.update;
              if (update.sessionUpdate === "tool_call") {
                toolCallCount++;
                const name = update.name ?? update.title ?? "unknown";
                const args =
                  (update.rawInput as Record<string, unknown> | null) ?? {};
                collectedToolCalls.push({
                  functionName: name,
                  arguments: args,
                  toolCallId: update.toolCallId,
                });
              } else if (update.sessionUpdate === "tool_call_update") {
                const text = extractTextContent(update.content ?? undefined);
                if (text) {
                  observationsByCallId.set(update.toolCallId, {
                    sourceCallId: update.toolCallId,
                    content: text,
                  });
                }
              }
            }
          })();

          return Promise.race([promptPromise, collectPromise, timeoutPromise]);
        });
      });

    // Read transcript for full trace + LLM call count.
    const trace = await buildTrace(
      sessionId,
      model,
      collectedToolCalls,
      observationsByCallId,
    );
    const llmCallCount = trace.steps.filter((s) => s.isLlmCall).length;

    const metrics = buildMetrics(
      promptResult,
      toolCallCount,
      llmCallCount,
      startTime,
    );

    // Capture the agent's final text output: the prompt response text, or
    // the last agent message from the trace.
    const agentOutput = extractAgentOutput(promptResult, trace);

    return {
      taskId: "", // filled in by the runner
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
    const metrics = buildMetrics(
      { stopReason: "cancelled", usage: null },
      toolCallCount,
      0,
      startTime,
    );
    // Best-effort trace from collected data when the session fails.
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
}

/** Build {@link TraceData} from the Devin transcript, enriched with ACP-collected tool calls. */
async function buildTrace(
  sessionId: string,
  model: ModelConfig,
  collectedToolCalls: ToolCall[],
  observationsByCallId: Map<string, Observation>,
): Promise<TraceData> {
  // If we have a session id and a transcript file, build the trace from it.
  if (sessionId) {
    try {
      const transcript = await readTranscript(sessionId);
      const steps = transcript.steps.map(buildTraceStep);

      // Attach ACP-collected tool calls / observations to agent steps in order.
      let toolIdx = 0;
      for (const step of steps) {
        if (step.source !== "agent") continue;
        const attachedCalls: ToolCall[] = [];
        const attachedObs: Observation[] = [];
        // Attach the next available tool call to this agent step.
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
    }
  }

  // Fallback: build a minimal trace from ACP-collected data.
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

/** Check whether a transcript file exists for a given session id. */
export function transcriptExists(sessionId: string, dir?: string): boolean {
  if (!sessionId) return false;
  return existsSync(join(dir ?? transcriptDir(), `${sessionId}.json`));
}
