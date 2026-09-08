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
  inputTokens: number;
  outputTokens: number;
  thoughtTokens: number;
  totalTokens: number;
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
