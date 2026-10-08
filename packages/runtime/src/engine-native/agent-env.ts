// Spec 54 — AgentDriver environment conventions.
//
// The generated CI jobs and `sverka run`/`sverka agent` resolve an agent
// driver from a fixed set of environment variables, so the same workflow
// runs locally and in CI without code changes:
//
//   SVERKA_AGENT_ANTHROPIC_KEY  → anthropic driver (engines "anthropic", "claude*")
//   SVERKA_AGENT_OPENAI_KEY     → openai driver     (engines "openai", "gpt*", "o*")
//   GITLAB_DUO_TOKEN            → reserved for a future Duo driver package
//   SVERKA_AGENT_DRIVER=stub    → fixed stub driver (testing only)
//
// `expectedAgentKeyEnv` names the variable a missing driver expects — the
// NO_AGENT_DRIVER error cites it so CI failures are actionable.

import { AgentDriverError } from "./errors.js";
import type {
  AgentDriver,
  AgentExecuteRequest,
  AgentResult,
  AgentWrite,
} from "./agent-driver.js";

/** Env vars read by `sverka agent` / generated jobs (Spec 54). */
export const AGENT_ENV = {
  engine: "SVERKA_AGENT_ENGINE",
  driver: "SVERKA_AGENT_DRIVER",
  model: "SVERKA_AGENT_MODEL",
  prompt: "SVERKA_AGENT_PROMPT",
  maxTokens: "SVERKA_AGENT_MAX_TOKENS",
  anthropicKey: "SVERKA_AGENT_ANTHROPIC_KEY",
  openaiKey: "SVERKA_AGENT_OPENAI_KEY",
  duoToken: "GITLAB_DUO_TOKEN",
  mention: "SVERKA_MENTION",
} as const;

/**
 * Map an engine name to the API-key env var a driver would need. Returns
 * undefined for engines with no key requirement ("stub") and for engines
 * no bundled convention covers — callers then report the known list.
 */
export function expectedAgentKeyEnv(engine: string): string | undefined {
  if (engine === "stub") return undefined;
  if (engine === "anthropic" || engine.startsWith("claude")) {
    return AGENT_ENV.anthropicKey;
  }
  if (engine === "openai" || engine.startsWith("gpt") || /^o\d/.test(engine)) {
    return AGENT_ENV.openaiKey;
  }
  if (engine === "duo") return AGENT_ENV.duoToken;
  return undefined;
}

/** Engines with a bundled convention — used in NO_AGENT_DRIVER hints. */
export const KNOWN_AGENT_ENGINES = [
  "anthropic",
  "openai",
  "duo",
  "stub",
] as const;

/**
 * Resolve the engine for a job-level agent invocation.
 * `SVERKA_AGENT_ENGINE` (set per-step by the compiler) wins;
 * `SVERKA_AGENT_DRIVER` is the documented manual override.
 */
export function resolveAgentEngine(
  env: Readonly<Record<string, string | undefined>>,
): string {
  return env[AGENT_ENV.engine] ?? env[AGENT_ENV.driver] ?? "stub";
}

/**
 * Build the driver list implied by the environment. A driver is only
 * registered when its key is present, so a missing key surfaces as
 * NO_AGENT_DRIVER naming the expected variable (Spec 54 error contract).
 */
export function resolveAgentDrivers(
  env: Readonly<Record<string, string | undefined>>,
): readonly AgentDriver[] {
  const drivers: AgentDriver[] = [];
  const anthropicKey = env[AGENT_ENV.anthropicKey];
  if (anthropicKey !== undefined && anthropicKey !== "") {
    drivers.push(createAnthropicDriver(anthropicKey));
  }
  const openaiKey = env[AGENT_ENV.openaiKey];
  if (openaiKey !== undefined && openaiKey !== "") {
    drivers.push(createOpenaiDriver(openaiKey));
  }
  // A Duo driver is a follow-up (Spec 54 non-goal) — the token alone does
  // not yield a driver, so duo stays NO_AGENT_DRIVER either way.
  if (env[AGENT_ENV.driver] === "stub") {
    drivers.push(envStubDriver());
  }
  return drivers;
}

/**
 * NO_AGENT_DRIVER error naming the env var a fix requires (Spec 54:
 * "missing agent key env var → NO_AGENT_DRIVER naming the expected env
 * var").
 */
export function noAgentDriverError(
  engine: string,
  context: string,
): AgentDriverError {
  const keyEnv = expectedAgentKeyEnv(engine);
  if (engine === "duo") {
    return new AgentDriverError(
      `NO_AGENT_DRIVER: engine 'duo' needs a driver package declaring canExecute("duo") and ${AGENT_ENV.duoToken} (${context}); Duo drivers are a follow-up`,
      "NO_AGENT_DRIVER",
    );
  }
  if (keyEnv !== undefined) {
    return new AgentDriverError(
      `NO_AGENT_DRIVER: no agent driver can execute engine '${engine}' (${context}) — set ${keyEnv}, or use SVERKA_AGENT_DRIVER=stub for a dry run`,
      "NO_AGENT_DRIVER",
    );
  }
  if (engine === "stub") {
    return new AgentDriverError(
      `NO_AGENT_DRIVER: engine 'stub' requires ${AGENT_ENV.driver}=stub (${context})`,
      "NO_AGENT_DRIVER",
    );
  }
  return new AgentDriverError(
    `NO_AGENT_DRIVER: no agent driver can execute engine '${engine}' (${context}) — known engines: ${KNOWN_AGENT_ENGINES.join(", ")}`,
    "NO_AGENT_DRIVER",
  );
}

// ---------------------------------------------------------------------------
// Writes extraction (Spec 54 safe-outputs channel)
// ---------------------------------------------------------------------------

/**
 * Extract agent write intents from model text. The contract: the model
 * emits a fenced `sverka-writes` block containing a JSON array (or an
 * object with a `writes` array). Malformed blocks fail loudly — the apply
 * stage never guesses writes.
 */
export function parseAgentWrites(text: string): readonly AgentWrite[] {
  const writes: AgentWrite[] = [];
  let pos = 0;
  for (;;) {
    const block = nextWritesBlock(text, pos);
    if (block === undefined) return writes;
    pos = block.nextPos;
    if (block.body === "") continue;
    for (const item of extractWritesItems(parseWritesJson(block.body))) {
      writes.push(validateAgentWrite(item));
    }
  }
}

/**
 * Locate the next fenced `sverka-writes` block via a linear indexOf scan —
 * a regex over uncontrolled model output is a ReDoS vector. The fence
 * marker may only be followed by whitespace up to the newline.
 */
function nextWritesBlock(
  text: string,
  from: number,
): { body: string; nextPos: number } | undefined {
  const FENCE = "```sverka-writes";
  for (;;) {
    const open = text.indexOf(FENCE, from);
    if (open === -1) return undefined;
    let bodyStart = open + FENCE.length;
    while (
      bodyStart < text.length &&
      (text[bodyStart] === " " ||
        text[bodyStart] === "\t" ||
        text[bodyStart] === "\r")
    ) {
      bodyStart++;
    }
    if (text[bodyStart] !== "\n") {
      from = open + FENCE.length;
      continue;
    }
    bodyStart++;
    const close = text.indexOf("```", bodyStart);
    if (close === -1) return undefined;
    return { body: text.slice(bodyStart, close).trim(), nextPos: close + 3 };
  }
}

function parseWritesJson(body: string): unknown {
  try {
    return JSON.parse(body);
  } catch (e) {
    throw new AgentDriverError(
      `AGENT_EXECUTION_FAILED: malformed sverka-writes block (invalid JSON): ${e instanceof Error ? e.message : String(e)}`,
      "AGENT_EXECUTION_FAILED",
      e,
    );
  }
}

/** The block holds a JSON array, or an object with a 'writes' array. */
function extractWritesItems(parsed: unknown): readonly unknown[] {
  if (Array.isArray(parsed)) return parsed;
  const w =
    typeof parsed === "object" && parsed !== null
      ? (parsed as { writes?: unknown }).writes
      : undefined;
  if (!Array.isArray(w)) {
    throw new AgentDriverError(
      "AGENT_EXECUTION_FAILED: sverka-writes block must be a JSON array or an object with a 'writes' array",
      "AGENT_EXECUTION_FAILED",
    );
  }
  return w;
}

function validateAgentWrite(item: unknown): AgentWrite {
  if (
    typeof item !== "object" ||
    item === null ||
    typeof (item as { kind?: unknown }).kind !== "string"
  ) {
    throw new AgentDriverError(
      "AGENT_EXECUTION_FAILED: every sverka-writes entry must be an object with a string 'kind'",
      "AGENT_EXECUTION_FAILED",
    );
  }
  return item as AgentWrite;
}

/** Combine driver-reported writes with text extraction. */
export function collectAgentWrites(result: AgentResult): readonly AgentWrite[] {
  // Driver-supplied writes are still model output — validate them with the
  // same contract the fenced-block path enforces.
  if (result.writes !== undefined) {
    if (!Array.isArray(result.writes)) {
      throw new AgentDriverError(
        "AGENT_EXECUTION_FAILED: driver result.writes must be an array",
        "AGENT_EXECUTION_FAILED",
      );
    }
    return result.writes.map((w) => validateAgentWrite(w));
  }
  return parseAgentWrites(result.text);
}

// ---------------------------------------------------------------------------
// Minimal HTTP drivers (Spec 54 — bundled conventions; richer driver
// packages remain follow-ups per Spec 27)
// ---------------------------------------------------------------------------

interface HttpDriverOptions {
  readonly name: string;
  readonly apiKey: string;
  readonly url: string;
  readonly match: (engine: string) => boolean;
  readonly buildBody: (request: AgentExecuteRequest) => Record<string, unknown>;
  readonly buildHeaders: (apiKey: string) => Record<string, string>;
  readonly parseResponse: (json: unknown) => AgentResult;
}

function createHttpDriver(opts: HttpDriverOptions): AgentDriver {
  return {
    name: opts.name,
    canExecute: (engine) => opts.match(engine),
    async executeAgent(request: AgentExecuteRequest): Promise<AgentResult> {
      const res = await fetch(opts.url, {
        method: "POST",
        headers: {
          "content-type": "application/json",
          ...opts.buildHeaders(opts.apiKey),
        },
        body: JSON.stringify(opts.buildBody(request)),
        ...(request.signal !== undefined ? { signal: request.signal } : {}),
      });
      if (!res.ok) {
        const body = await res.text().catch(() => "");
        throw new AgentDriverError(
          `AGENT_EXECUTION_FAILED: ${opts.name} request failed (${res.status}): ${body.slice(0, 300)}`,
          "AGENT_EXECUTION_FAILED",
        );
      }
      let json: unknown;
      try {
        json = await res.json();
      } catch (e) {
        throw new AgentDriverError(
          `AGENT_EXECUTION_FAILED: ${opts.name} response is not valid JSON: ${e instanceof Error ? e.message : String(e)}`,
          "AGENT_EXECUTION_FAILED",
          e,
        );
      }
      return opts.parseResponse(json);
    },
  };
}

/** Anthropic Messages API driver (default model: claude-sonnet-4-5). */
export function createAnthropicDriver(apiKey: string): AgentDriver {
  return createHttpDriver({
    name: "anthropic",
    apiKey,
    url: "https://api.anthropic.com/v1/messages",
    match: (engine) => engine === "anthropic" || engine.startsWith("claude"),
    buildHeaders: (key) => ({
      "x-api-key": key,
      "anthropic-version": "2023-06-01",
    }),
    buildBody: (request) => ({
      model: request.model ?? "claude-sonnet-4-5",
      max_tokens: request.maxTokens ?? 4096,
      messages: [{ role: "user", content: request.prompt }],
    }),
    parseResponse: (json) => {
      const r = json as {
        content?: { type: string; text?: string }[];
        stop_reason?: string;
        usage?: { input_tokens?: number; output_tokens?: number };
      };
      const text = (r.content ?? [])
        .filter((c) => c.type === "text" && typeof c.text === "string")
        .map((c) => c.text)
        .join("");
      const finishReason = anthropicFinishReason(r.stop_reason);
      return {
        text,
        finishReason,
        ...(r.usage !== undefined
          ? {
              usage: {
                ...(r.usage.input_tokens !== undefined
                  ? { inputTokens: r.usage.input_tokens }
                  : {}),
                ...(r.usage.output_tokens !== undefined
                  ? { outputTokens: r.usage.output_tokens }
                  : {}),
              },
            }
          : {}),
      };
    },
  });
}

/** Anthropic `stop_reason` → AgentResult.finishReason. */
function anthropicFinishReason(reason: string | undefined): string {
  switch (reason) {
    case undefined:
    case "end_turn":
    case "stop_sequence":
      return "stop";
    case "max_tokens":
      return "length";
    case "tool_use":
      return "tool_call";
    default:
      return reason;
  }
}

/** OpenAI Chat Completions driver (default model: gpt-4o). */
export function createOpenaiDriver(apiKey: string): AgentDriver {
  return createHttpDriver({
    name: "openai",
    apiKey,
    url: "https://api.openai.com/v1/chat/completions",
    match: (engine) =>
      engine === "openai" || engine.startsWith("gpt") || /^o\d/.test(engine),
    buildHeaders: (key) => ({ authorization: `Bearer ${key}` }),
    buildBody: (request) => ({
      model: request.model ?? "gpt-4o",
      messages: [{ role: "user", content: request.prompt }],
      ...(request.maxTokens !== undefined
        ? { max_tokens: request.maxTokens }
        : {}),
    }),
    parseResponse: (json) => {
      const r = json as {
        choices?: {
          message?: { content?: string };
          finish_reason?: string;
        }[];
        usage?: {
          prompt_tokens?: number;
          completion_tokens?: number;
          total_tokens?: number;
        };
      };
      const choice = r.choices?.[0];
      return {
        text: choice?.message?.content ?? "",
        finishReason: choice?.finish_reason ?? "stop",
        ...(r.usage !== undefined
          ? {
              usage: {
                ...(r.usage.prompt_tokens !== undefined
                  ? { inputTokens: r.usage.prompt_tokens }
                  : {}),
                ...(r.usage.completion_tokens !== undefined
                  ? { outputTokens: r.usage.completion_tokens }
                  : {}),
                ...(r.usage.total_tokens !== undefined
                  ? { totalTokens: r.usage.total_tokens }
                  : {}),
              },
            }
          : {}),
      };
    },
  });
}

function envStubDriver(): AgentDriver {
  return {
    name: "stub-agent",
    canExecute: (engine) => engine === "stub",
    executeAgent(_request: AgentExecuteRequest): Promise<AgentResult> {
      return Promise.resolve({
        text: "[stub agent response]",
        finishReason: "stop",
      });
    },
  };
}
