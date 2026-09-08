/**
 * Shared ACP (Agent Client Protocol) utilities — extracted from the Devin
 * adapter so they can be reused by other adapters and the benchmark runner.
 *
 * This module contains:
 * - {@link sanitizeEnv}: strip host-contaminating env vars before spawning an agent.
 * - {@link createPermissionHandler}: auto-approve permission requests.
 * - {@link runAcpSession}: drive a full ACP connect/initialize/prompt/collect loop.
 */

import { Writable, Readable } from "node:stream";
import type { ChildProcess } from "node:child_process";

import * as acp from "@agentclientprotocol/sdk";
import type {
  PromptResponse,
  RequestPermissionResponse,
  SessionUpdate,
} from "@agentclientprotocol/sdk";

import type { AgentSpawnConfig } from "./types.js";

// ─── Types ───────────────────────────────────────────────────────────

/** A `session/update` notification whose `sessionUpdate` is `"tool_call"`. */
export type ToolCallMessage = Extract<SessionUpdate, { sessionUpdate: "tool_call" }>;

/** A `session/update` notification whose `sessionUpdate` is `"tool_call_update"`. */
export type ToolCallUpdateMessage = Extract<
  SessionUpdate,
  { sessionUpdate: "tool_call_update" }
>;

// ─── Environment sanitization ────────────────────────────────────────

/** Env-var prefixes to strip from the spawned process environment. */
const SANITIZE_PREFIXES = [
  "GC_",
  "BEADS_",
  "BD_",
  "MCP_",
  "CLAUDECODE",
  "CLAUDE_CODE_",
  "CODEX_",
];

/** Exact env-var names to strip from the spawned process environment. */
const SANITIZE_EXACT = new Set([
  "DEVIN_PERMISSION_MODE",
  "DEVIN_MODEL",
  "AGENTS_MD",
  "CLAUDE_PROJECT_MD",
]);

/**
 * Build a sanitized environment for an agent subprocess.
 *
 * Strips out host contamination: Gas City, Beads, MCP servers, project
 * skills, and other variables that would leak the host's configuration
 * into the benchmark. The agent must only see what we explicitly install.
 *
 * Sets `DEVIN_PERMISSION_MODE` and `DEVIN_MODEL` from the spawn config,
 * then merges any explicit `config.env` overrides (which win).
 */
export function sanitizeEnv(config: AgentSpawnConfig): Record<string, string> {
  const model = config.model;
  const permissionMode = config.permissionMode ?? "dangerous";

  const env: Record<string, string> = {};
  for (const [key, value] of Object.entries(process.env)) {
    if (value === undefined) continue;
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

  return env;
}

// ─── Permission handling ──────────────────────────────────────────────

/**
 * Create a permission-request handler that auto-approves tool calls.
 *
 * Selects the first `allow_once` or `allow_always` option, falling back to
 * the first available option. This is the same handler used by both the
 * Devin adapter and the benchmark runner.
 */
export function createPermissionHandler(): acp.ClientRequestHandler<
  acp.RequestPermissionRequest,
  acp.RequestPermissionResponse
> {
  return (ctx): RequestPermissionResponse => {
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
  };
}

// ─── Session loop ────────────────────────────────────────────────────

/**
 * Process a single {@link acp.ActiveSessionMessage} from the session update
 * stream. Returns the final {@link PromptResponse} when the session reports
 * a stop, otherwise invokes the appropriate callback and returns `undefined`
 * so the caller can continue collecting.
 */
function handleSessionUpdate(
  message: acp.ActiveSessionMessage,
  onToolCall?: (update: ToolCallMessage) => void,
  onToolUpdate?: (update: ToolCallUpdateMessage) => void,
): PromptResponse | undefined {
  if (message.kind === "stop") return message.response;
  const update = message.update;
  if (update.sessionUpdate === "tool_call") {
    onToolCall?.(update);
  } else if (update.sessionUpdate === "tool_call_update") {
    onToolUpdate?.(update);
  }
  return undefined;
}

/**
 * Drive a single ACP session: send the prompt, race the collect loop
 * against a timeout, and return the final {@link PromptResponse}.
 */
async function runSessionLoop(
  session: acp.ActiveSession,
  prompt: string,
  timeoutMs: number,
  onToolCall?: (update: ToolCallMessage) => void,
  onToolUpdate?: (update: ToolCallUpdateMessage) => void,
  onSession?: (sessionId: string) => void,
): Promise<PromptResponse> {
  onSession?.(session.sessionId);
  const promptPromise = session.prompt(prompt);
  const timeoutPromise = new Promise<never>((_, reject) =>
    setTimeout(
      () => reject(new Error(`Agent timed out after ${timeoutMs}ms`)),
      timeoutMs,
    ),
  );

  const collectPromise = (async (): Promise<PromptResponse> => {
    for (;;) {
      const message = await session.nextUpdate();
      const result = handleSessionUpdate(message, onToolCall, onToolUpdate);
      if (result) return result;
    }
  })();

  return Promise.race([promptPromise, collectPromise, timeoutPromise]);
}

/**
 * Run a full ACP session against a spawned agent subprocess.
 *
 * Connects to the agent, initializes the protocol, creates a session in
 * `workspace`, sends `prompt`, and collects update events until the session
 * stops or `timeoutMs` elapses.
 *
 * The `onToolCall` and `onToolUpdate` callbacks let callers collect tool
 * calls and observations without duplicating the session loop logic. The
 * optional `onSession` callback reports the session ID once created. All
 * callbacks are optional.
 *
 * @returns The final {@link PromptResponse} from the agent.
 */
export async function runAcpSession(
  proc: ChildProcess,
  workspace: string,
  prompt: string,
  timeoutMs: number,
  onToolCall?: (update: ToolCallMessage) => void,
  onToolUpdate?: (update: ToolCallUpdateMessage) => void,
  onSession?: (sessionId: string) => void,
): Promise<PromptResponse> {
  if (!proc.stdin || !proc.stdout) {
    throw new Error("Agent process missing stdin/stdout");
  }

  const input = Writable.toWeb(proc.stdin);
  const output = Readable.toWeb(proc.stdout);
  const stream = acp.ndJsonStream(input, output);

  return acp
    .client({ name: "sverka-arena" })
    .onRequest(
      acp.methods.client.session.requestPermission,
      createPermissionHandler(),
    )
    .connectWith(stream, async (ctx) => {
      await ctx.request(acp.methods.agent.initialize, {
        protocolVersion: acp.PROTOCOL_VERSION,
        clientCapabilities: {},
      });
      return ctx
        .buildSession(workspace)
        .withSession((session) =>
          runSessionLoop(session, prompt, timeoutMs, onToolCall, onToolUpdate, onSession),
        );
    });
}
