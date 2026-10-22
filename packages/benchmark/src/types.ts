/** A benchmark task scenario. */
export interface Task {
  id: string;
  name: string;
  prompt: string;
  timeoutMs?: number;
}

/** Agent configuration — determines workspace setup. */
export interface AgentConfig {
  id: string;
  name: string;
  type: "raw-shell" | "sverka";
}

/** Metrics collected from ACP events + timing. */
export interface RunMetrics {
  /** Prompt-side tokens — 0 under ACP 2.x (no per-turn breakdown is
   *  reported and the benchmark has no transcript source). */
  inputTokens: number;
  /** Completion-side tokens — 0 under ACP 2.x. */
  outputTokens: number;
  /** Thinking/reasoning tokens — 0 under ACP 2.x. */
  thoughtTokens: number;
  /** Token estimate: the last `usage_update.used` — context-window
   *  occupancy at turn end, the only token number ACP 2.x reports. */
  totalTokens: number;
  /** Tokens in context at turn end (last ACP `usage_update.used`). */
  contextTokensUsed?: number;
  /** Agent's context window size (last ACP `usage_update.size`). */
  contextWindowSize?: number;
  /** Cumulative session cost (last ACP `usage_update.cost.amount`). */
  costAmount?: number;
  /** ISO 4217 currency of {@link costAmount}. */
  costCurrency?: string;
  toolCallCount: number;
  executionTimeMs: number;
  stopReason: string;
}

/** Result of a single task+agent run. */
export interface RunResult {
  taskId: string;
  agentId: string;
  agentType: string;
  metrics: RunMetrics;
  success: boolean;
  error?: string;
}

/** Aggregate metrics for one agent type across all tasks. */
export interface AggregateMetrics {
  totalTasks: number;
  successCount: number;
  avgInputTokens: number;
  avgOutputTokens: number;
  avgTotalTokens: number;
  avgToolCalls: number;
  avgExecutionTimeMs: number;
}

/** Full benchmark output. */
export interface BenchmarkResult {
  timestamp: string;
  model: string;
  results: RunResult[];
  summary: {
    "raw-shell": AggregateMetrics;
    sverka: AggregateMetrics;
  };
}

/** Arena configuration. */
export interface BenchmarkConfig {
  tasks: Task[];
  agents: AgentConfig[];
  model?: string;
  outputDir?: string;
}
