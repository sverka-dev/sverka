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

import { spawn, execSync, type ChildProcess } from "node:child_process";
import { mkdir, cp, rm, readFile, writeFile } from "node:fs/promises";
import { existsSync, mkdtempSync, mkdirSync, cpSync, rmSync } from "node:fs";
import { join } from "node:path";
import { homedir, tmpdir } from "node:os";
import { DatabaseSync } from "node:sqlite";

import type {
  PromptResponse,
  Usage,
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

/**
 * Devin CLI session DB. It lives on the host at a fixed path — it does
 * NOT follow XDG_DATA_HOME, so isolated runs still write here.
 */
export function sessionDbPath(): string {
  return join(homedir(), ".local", "share", "devin", "cli", "sessions.db");
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

/** A message_nodes row: chat_message is a JSON-encoded chat message. */
interface SessionNodeRow {
  node_id: number;
  created_at: number;
  chat_message: string;
}

/** Parsed fields of a session-DB chat message we care about. */
interface SessionNodeMessage {
  role: string;
  content?: string;
  thinking?: { thinking?: string } | null;
  tool_calls?: { id?: string; name?: string }[] | null;
  metadata?: {
    metrics?: {
      input_tokens?: number | null;
      output_tokens?: number | null;
      cache_read_tokens?: number | null;
    } | null;
  } | null;
}

/** One parsed session-DB node: a trace step plus its token metrics (inference calls only). */
interface ParsedNode {
  step: TranscriptStep;
  tokens: { prompt: number; completion: number; cached: number } | null;
}

/**
 * Map a message_nodes row to a {@link ParsedNode}. Returns `undefined`
 * for non-step roles (e.g. `tool` results — their content arrives via
 * ACP-collected observations; as steps they'd mislabel tool output as
 * agent output).
 */
function parseNode(row: SessionNodeRow): ParsedNode | undefined {
  const node = JSON.parse(row.chat_message) as SessionNodeMessage;
  if (
    node.role !== "system" &&
    node.role !== "user" &&
    node.role !== "assistant"
  ) {
    return undefined;
  }
  const isInference = node.role === "assistant";
  const toolNames = (node.tool_calls ?? [])
    .map((t) => t.name)
    .filter(Boolean)
    .join(", ");
  const message = (
    node.content?.trim() ||
    node.thinking?.thinking?.trim() ||
    toolNames
  ).slice(0, 4000);
  const m = node.metadata?.metrics;
  return {
    step: {
      step_id: row.node_id,
      // message_nodes.created_at is epoch SECONDS (the CLI batch-writes
      // nodes at session end, so per-step timing is identical anyway);
      // tolerate a future switch to ms.
      timestamp: new Date(
        row.created_at < 1e12 ? row.created_at * 1000 : row.created_at,
      ).toISOString(),
      source: isInference ? "agent" : (node.role as "system" | "user"),
      message,
      extra: isInference
        ? { telemetry: { source: "assistant", operation: "inference" } }
        : null,
    },
    tokens: isInference
      ? {
          prompt: m?.input_tokens ?? 0,
          completion: m?.output_tokens ?? 0,
          cached: m?.cache_read_tokens ?? 0,
        }
      : null,
  };
}

/** Accumulate one inference call's token counts into transcript totals. */
function addTokens(
  metrics: TranscriptMetrics,
  tokens: NonNullable<ParsedNode["tokens"]>,
): void {
  metrics.total_prompt_tokens += tokens.prompt;
  metrics.total_completion_tokens += tokens.completion;
  metrics.total_cached_tokens += tokens.cached;
  metrics.total_steps += 1;
}

/**
 * Build a {@link Transcript} from the Devin session DB. `devin acp` never
 * writes transcript JSON files, but every message (incl. per-call token
 * metrics) lands in `message_nodes` — each `assistant` node is one LLM
 * inference call. Returns `undefined` when the session has no rows yet.
 */
export function readSessionTranscript(
  sessionId: string,
  dbPath?: string,
): Transcript | undefined {
  const path = dbPath ?? sessionDbPath();
  if (!existsSync(path)) return undefined;

  const db = new DatabaseSync(path, { readOnly: true });
  try {
    const rows = db
      .prepare(
        "SELECT node_id, created_at, chat_message FROM message_nodes WHERE session_id = ? ORDER BY node_id",
      )
      .all(sessionId) as unknown as SessionNodeRow[];
    if (rows.length === 0) return undefined;

    const sessionRow = db
      .prepare("SELECT model FROM sessions WHERE id = ?")
      .get(sessionId) as { model?: string } | undefined;

    const steps: TranscriptStep[] = [];
    const metrics: TranscriptMetrics = {
      total_prompt_tokens: 0,
      total_completion_tokens: 0,
      total_cached_tokens: 0,
      total_steps: 0,
    };
    for (const row of rows) {
      const parsed = parseNode(row);
      if (!parsed) continue;
      steps.push(parsed.step);
      if (parsed.tokens) addTokens(metrics, parsed.tokens);
    }

    return {
      session_id: sessionId,
      schema_version: "session-db",
      agent: {
        name: "devin",
        version: "",
        model_name: sessionRow?.model ?? "",
      },
      final_metrics: metrics,
      steps,
    };
  } finally {
    db.close();
  }
}

/**
 * Load a transcript for the session — session DB first (that's where
 * `devin acp` actually writes), then the transcript file as a fallback.
 * The DB write can lag `session/prompt` completion, so retry once.
 */
async function loadTranscript(
  sessionId: string,
  dir?: string,
): Promise<Transcript | undefined> {
  const tryDb = (): Transcript | undefined => {
    try {
      return readSessionTranscript(sessionId);
    } catch {
      return undefined;
    }
  };
  const fromDb =
    tryDb() ??
    (await new Promise<Transcript | undefined>((resolve) =>
      setTimeout(() => resolve(tryDb()), 400),
    ));
  if (fromDb) return fromDb;
  try {
    return await readTranscript(sessionId, dir);
  } catch {
    return undefined;
  }
}

/** Count LLM inference calls in a transcript (agent steps with telemetry.operation === "inference"). */
export function countLlmCalls(transcript: Transcript): number {
  return transcript.steps.filter(
    (s) =>
      s.source === "agent" && s.extra?.telemetry?.operation === "inference",
  ).length;
}

/** Build a {@link TraceStep} from a raw transcript step. */
function buildTraceStep(step: TranscriptStep): TraceStep {
  const isLlmCall =
    step.source === "agent" && step.extra?.telemetry?.operation === "inference";
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
    if (step?.source === "agent" && step.message.length > 0) {
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

  // Forbid every installed plugin at the repo level. Devin resolves plugin
  // authority enterprise > org > repo > user, and a repo-level wildcard
  // forbid blocks all user/managed installs (higher-authority "required"
  // plugins still load — they're a constant baseline across cells).
  // .agents/skills copies below are workspace content, not plugins, so
  // plugin-on cells are unaffected.
  await writeForbidManifest(workspace);

  // Nuke any existing skills directory — we start from a clean slate.
  // This prevents host skill contamination.
  await rm(skillsDir, { recursive: true, force: true });

  // Only create the directory if we have enabled plugins to install.
  const enabledPlugins = plugins.filter((p) => p.enabled);
  if (enabledPlugins.length === 0) return;

  await mkdir(skillsDir, { recursive: true });
  for (const plugin of enabledPlugins) {
    // Reject path-like plugin ids to prevent directory traversal
    if (
      plugin.id.includes("/") ||
      plugin.id.includes("\\") ||
      plugin.id.includes("..")
    ) {
      throw new Error(`Invalid plugin id: ${plugin.id}`);
    }
    const dest = join(skillsDir, plugin.id);
    await mkdir(dest, { recursive: true });
    await cp(plugin.path, dest, { recursive: true });
  }
}

/**
 * Write (or merge into) `<workspace>/.devin/config.json` with
 * `forbiddenPlugins: ["*"]`. Preserves other keys the fixture may ship,
 * including `requiredPlugins` (same-manifest requireds are exempt from
 * its own forbids, so plugin fixtures still work).
 */
async function writeForbidManifest(workspace: string): Promise<void> {
  const devinDir = join(workspace, ".devin");
  const manifestPath = join(devinDir, "config.json");
  let manifest: Record<string, unknown> = {};
  try {
    const parsed: unknown = JSON.parse(await readFile(manifestPath, "utf8"));
    if (typeof parsed === "object" && parsed !== null) {
      manifest = parsed as Record<string, unknown>;
    }
  } catch {
    // No existing manifest (or unreadable) — start fresh.
  }
  manifest.forbiddenPlugins = ["*"];
  await mkdir(devinDir, { recursive: true });
  await writeFile(manifestPath, `${JSON.stringify(manifest, null, 2)}\n`); // codeql[js/insecure-temporary-file] — inside a private mkdtemp (0700) workspace, not a predictable shared temp file
}

/**
 * Create a fresh XDG home for the spawned agent and point `env` at it:
 * - `XDG_CONFIG_HOME` — drops global user skills, hooks, MCP config, and
 *   user-level `AGENTS.md` so all cells share the builtin baseline.
 * - `XDG_DATA_HOME` — fresh plugin/session store; seeded with the host's
 *   `devin/credentials.toml` so the agent stays authenticated without
 *   writing session state into the user's real Devin data dir.
 *
 * Returns the env-home path — the caller must delete it after the run.
 */
function isolateAgentEnv(env: Record<string, string>): string {
  const envHome = mkdtempSync(join(tmpdir(), "arena-env-"));
  try {
    const configDir = join(envHome, "config");
    const dataDir = join(envHome, "data");
    mkdirSync(join(dataDir, "devin"), { recursive: true });
    mkdirSync(configDir, { recursive: true });

    const hostDataHome =
      process.env.XDG_DATA_HOME ?? join(homedir(), ".local", "share");
    const creds = join(hostDataHome, "devin", "credentials.toml");
    if (existsSync(creds)) {
      cpSync(creds, join(dataDir, "devin", "credentials.toml"));
    }

    env.XDG_CONFIG_HOME = configDir;
    env.XDG_DATA_HOME = dataDir;
    return envHome;
  } catch (error) {
    rmSync(envHome, { recursive: true, force: true });
    throw error;
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
    const { proc, envHome } = spawnDevin(config);
    let killed = false;
    let cleaned = false;
    const cleanup = (): void => {
      if (cleaned) return;
      cleaned = true;
      rm(envHome, { recursive: true, force: true }).catch((err: unknown) => {
        console.warn(
          `[arena] failed to remove isolated env ${envHome}: ${String(err)}`,
        );
      });
    };

    // SIGTERM, wait for exit (SIGKILL fallback), then remove envHome —
    // the child may still be writing session data/transcripts into it.
    const terminate = (): void => {
      if (proc.exitCode != null || proc.signalCode != null) {
        cleanup();
        return;
      }
      proc.once("exit", cleanup);
      const force = setTimeout(() => {
        proc.kill("SIGKILL");
        cleanup();
      }, 5_000);
      force.unref();
      proc.kill("SIGTERM");
    };

    return {
      run: async (prompt: string, timeoutMs: number): Promise<RunResult> => {
        try {
          return await runDevinSession(
            proc,
            config,
            prompt,
            timeoutMs,
            envHome,
          );
        } finally {
          terminate();
        }
      },
      kill: (): void => {
        if (killed) return;
        killed = true;
        terminate();
      },
    };
  }
}

/** Resolve the full path to the devin binary to avoid PATH-based lookup. */
function resolveDevinBinary(): string {
  try {
    return execSync("which devin", {
      encoding: "utf-8",
      stdio: ["pipe", "pipe", "pipe"],
    }).trim(); // NOSONAR — PATH needed to locate devin binary
  } catch {
    return "devin";
  }
}

/**
 * Spawn `devin acp --model <model.id>` as a subprocess in the workspace,
 * in an isolated XDG env (see {@link isolateAgentEnv}). Returns the child
 * process and the env-home path the caller must clean up.
 */
function spawnDevin(config: AgentSpawnConfig): {
  proc: ChildProcess;
  envHome: string;
} {
  const env = sanitizeEnv(config);
  const envHome = isolateAgentEnv(env);
  const devinBin = resolveDevinBinary();
  try {
    const proc = spawn(devinBin, ["acp", "--model", config.model.id], {
      cwd: config.workspace,
      stdio: ["pipe", "pipe", "inherit"],
      env,
    });
    return { proc, envHome };
  } catch (error) {
    rm(envHome, { recursive: true, force: true }).catch(() => {});
    throw error;
  }
}

/** Mutable collection state + callbacks for gathering ACP tool calls and observations. */
interface ToolCollector {
  collectedToolCalls: ToolCall[];
  observationsByCallId: Map<string, Observation>;
  toolCallCount: number;
  onToolCall: (update: ToolCallMessage, receivedAt: number) => void;
  onToolUpdate: (update: ToolCallUpdateMessage, receivedAt: number) => void;
}

/** Create a {@link ToolCollector} with callbacks that populate shared state. */
function createToolCollector(): ToolCollector {
  const collectedToolCalls: ToolCall[] = [];
  const observationsByCallId = new Map<string, Observation>();
  let toolCallCount = 0;

  const onToolCall = (update: ToolCallMessage, receivedAt: number): void => {
    toolCallCount++;
    const name = update.name ?? update.title ?? "unknown";
    const args = (update.rawInput as Record<string, unknown> | null) ?? {};
    collectedToolCalls.push({
      functionName: name,
      arguments: args,
      toolCallId: update.toolCallId,
      collectedAt: new Date(receivedAt).toISOString(),
    });
  };

  const onToolUpdate = (
    update: ToolCallUpdateMessage,
    _receivedAt: number,
  ): void => {
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
  envHome: string,
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
      join(envHome, "data", "devin", "cli", "transcripts"),
    );
    const llmCallCount = trace.steps.filter((s) => s.isLlmCall).length;
    const metrics = buildMetrics(
      promptResult,
      collector.toolCallCount,
      llmCallCount,
      startTime,
    );
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
    return buildErrorResult(
      model,
      pluginIds,
      collector.toolCallCount,
      sessionId,
      startTime,
      error,
    );
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
  dir?: string,
): Promise<TraceData | undefined> {
  if (!sessionId) return undefined;
  try {
    const transcript = await loadTranscript(sessionId, dir);
    if (!transcript) return undefined;
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

/** Attach the next tool call + observation to an agent step. Returns true if attached. */
function attachNextToolCall(
  step: TraceStep,
  collectedToolCalls: ToolCall[],
  observationsByCallId: Map<string, Observation>,
  toolIdx: number,
): { attached: boolean; nextIdx: number } {
  if (toolIdx >= collectedToolCalls.length)
    return { attached: false, nextIdx: toolIdx };
  const tc = collectedToolCalls[toolIdx];
  if (!tc) return { attached: false, nextIdx: toolIdx };
  const calls: ToolCall[] = [tc];
  const obs = observationsByCallId.get(tc.toolCallId);
  const observations: Observation[] = obs ? [obs] : [];
  step.toolCalls = calls;
  // Real arrival time beats the DB's identical session-end stamps.
  if (tc.collectedAt) step.timestamp = tc.collectedAt;
  if (observations.length > 0) step.observations = observations;
  return { attached: true, nextIdx: toolIdx + 1 };
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
    const result = attachNextToolCall(
      step,
      collectedToolCalls,
      observationsByCallId,
      toolIdx,
    );
    if (result.attached) toolIdx = result.nextIdx;
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
      timestamp: tc.collectedAt ?? new Date().toISOString(),
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
  dir?: string,
): Promise<TraceData> {
  return (
    (await buildTraceFromTranscript(
      sessionId,
      collectedToolCalls,
      observationsByCallId,
      dir,
    )) ??
    buildTraceFallback(
      sessionId,
      model,
      collectedToolCalls,
      observationsByCallId,
    )
  );
}
