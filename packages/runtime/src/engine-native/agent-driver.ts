// AgentDriver — abstraction over AI engines for AgentStep execution. Spec 27.
//
// The native engine does NOT bundle concrete AI SDK integrations (OpenAI,
// Anthropic, etc.). Concrete clients are follow-up packages that implement
// AgentDriver. The native engine ships only a fixed stub driver for testing.

import type { AgentToolRef } from "@sverka/workflow";

/** A single tool call emitted by an agent during execution. */
export interface AgentToolCall {
  readonly id: string;
  readonly name: string;
  readonly arguments: unknown;
}

/** Token/usage accounting for an agent execution (optional). */
export interface AgentUsage {
  readonly inputTokens?: number;
  readonly outputTokens?: number;
  readonly totalTokens?: number;
}

/**
 * A write the agent asks the apply stage to perform (Spec 54). Validated
 * against the step's `permissions.write` declarations by `sverka apply`
 * before any provider call — the agent job itself stays read-only.
 */
export interface AgentWrite {
  readonly kind: string;
  readonly [key: string]: unknown;
}

/** Result returned by an AgentDriver. */
export interface AgentResult {
  readonly text: string;
  readonly toolCalls?: readonly AgentToolCall[];
  readonly finishReason: "stop" | "length" | "tool_call" | "error" | string;
  readonly usage?: AgentUsage;
  /**
   * Declared write intents the driver extracted from the model output.
   * When absent, callers extract writes from `text` via
   * {@link parseAgentWrites} (the fenced `sverka-writes` block contract).
   */
  readonly writes?: readonly AgentWrite[];
}

/** Request passed to an AgentDriver. */
export interface AgentExecuteRequest {
  readonly engine: string;
  readonly model?: string;
  readonly prompt: string;
  readonly tools?: readonly AgentToolRef[];
  readonly maxTokens?: number;
  readonly signal?: AbortSignal;
}

/**
 * AgentDriver — provider-neutral abstraction over AI engines.
 *
 * `canExecute(engine)` returns true if this driver can handle the named engine
 * (e.g. "claude", "gpt-4", "copilot", "gemini", or "default").
 * `executeAgent(request)` performs a single non-deterministic agent call.
 * Tool-call loops, streaming, and multi-turn conversations are the driver's
 * responsibility and are out of scope for the native engine.
 */
export interface AgentDriver {
  readonly name: string;
  canExecute(engine: string): boolean;
  executeAgent(request: AgentExecuteRequest): Promise<AgentResult>;
  dispose?(): Promise<void>;
}

/**
 * Create a fixed stub agent driver for testing.
 * Returns `{ text: "[stub agent response]", finishReason: "stop" }` for any
 * engine. Never makes a network call.
 */
export function createStubAgentDriver(): AgentDriver {
  return {
    name: "stub-agent",
    canExecute: () => true,
    async executeAgent(_request: AgentExecuteRequest): Promise<AgentResult> {
      return {
        text: "[stub agent response]",
        finishReason: "stop",
      };
    },
  };
}
