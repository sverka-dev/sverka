/** Agent adapter — pluggable interface for different agent CLIs */
export interface AgentAdapter {
  id: string;
  spawn(config: AgentSpawnConfig): AgentProcess;
}

export interface AgentSpawnConfig {
  model: ModelConfig;
  workspace: string;
  plugins: PluginConfig[];
  permissionMode?: "auto" | "dangerous" | "accept-edits";
  env?: Record<string, string>;
}

export interface AgentProcess {
  run(prompt: string, timeoutMs: number): Promise<RunResult>;
  kill(): void;
}

/** Model configuration */
export interface ModelConfig {
  id: string;
  name: string;
  envVar?: string;
}

/** Plugin/skill configuration — the variable we're testing */
export interface PluginConfig {
  id: string;
  name: string;
  path: string;
  enabled: boolean;
  installPath?: string;
}

/** Task to benchmark */
export interface Task {
  id: string;
  name: string;
  prompt: string;
  timeoutMs?: number;
  /** Natural-language criteria the judge uses to evaluate the output */
  successCriteria?: string;
  /** Optional expected output for deterministic comparison */
  expectedOutput?: string;
  /** Fixture project to copy into the workspace for this task.
   * Path relative to the arena package root (e.g. "fixtures/ts-fix-test").
   * If omitted, the runner uses an empty temp directory. */
  fixture?: string;
  /** Optional deterministic checks to run after the agent finishes.
   * Each check is a shell command; exit 0 = pass, non-zero = fail. */
  checks?: DeterministicCheck[];
}

/** A deterministic check — shell command that exits 0 on success. */
export interface DeterministicCheck {
  id: string;
  command: string;
  description: string;
}

/** Full arena configuration — defines the matrix */
export interface ArenaConfig {
  tasks: Task[];
  agent: AgentAdapter;
  models: ModelConfig[];
  plugins: PluginConfig[];
  workspace?: string;
  repetitions?: number;
  outputDir: string;
  /** Judge configuration for blind evaluation (optional) */
  judge?: JudgeConfig;
}

/** Judge configuration — blind LLM evaluation of run outputs */
export interface JudgeConfig {
  /** Model to use for judging (can differ from agent models) */
  model: ModelConfig;
  /** Agent adapter for the judge (can differ from the agent under test) */
  agent: AgentAdapter;
  /** Number of judge repetitions per run (for confidence intervals) */
  repetitions?: number;
  /** Whether to show the judge which plugins were active (default: false = blind) */
  revealPlugins?: boolean;
  /** Custom system prompt for the judge */
  systemPrompt?: string;
}

/** Judge evaluation of a single run */
export interface JudgeVerdict {
  /** Run being judged (index into ArenaResult.results) */
  runIndex: number;
  /** Score 0-100 */
  score: number;
  /** Whether the judge considers this a pass (score >= threshold) */
  passed: boolean;
  /** Judge's reasoning */
  reasoning: string;
  /** Specific issues found */
  issues: string[];
  /** Which run this verdict applies to (for pairing) */
  taskId: string;
  modelId: string;
  pluginIds: string[];
}

/** Result of a single matrix cell run */
export interface RunResult {
  taskId: string;
  modelId: string;
  pluginIds: string[];
  metrics: RunMetrics;
  trace: TraceData;
  /** The agent's final output (text response to the prompt) */
  output: string;
  success: boolean;
  /** Results of deterministic checks (empty if none configured) */
  checkResults: CheckResult[];
  error?: string;
  /** Judge verdicts for this run (empty if no judge configured) */
  verdicts: JudgeVerdict[];
}

/** Result of a single deterministic check */
export interface CheckResult {
  checkId: string;
  passed: boolean;
  output: string;
  exitCode: number;
}

/** Metrics collected per run */
export interface RunMetrics {
  inputTokens: number;
  outputTokens: number;
  thoughtTokens: number;
  totalTokens: number;
  toolCallCount: number;
  llmCallCount: number;
  executionTimeMs: number;
  stopReason: string;
}

/** Full trace data for visualization */
export interface TraceData {
  sessionId: string;
  model: string;
  steps: TraceStep[];
  finalMetrics: {
    totalPromptTokens: number;
    totalCompletionTokens: number;
    totalCachedTokens: number;
    totalSteps: number;
  };
}

/** A single step in the trace */
export interface TraceStep {
  stepId: number;
  timestamp: string;
  source: "system" | "agent" | "user";
  message: string;
  toolCalls?: ToolCall[];
  observations?: Observation[];
  isLlmCall: boolean;
}

/** A tool call within a step */
export interface ToolCall {
  functionName: string;
  arguments: Record<string, unknown>;
  toolCallId: string;
}

/** Observation result from a tool call */
export interface Observation {
  sourceCallId: string;
  content: string;
}

/** Aggregate metrics for a group of runs */
export interface AggregateMetrics {
  totalRuns: number;
  successCount: number;
  avgInputTokens: number;
  avgOutputTokens: number;
  avgTotalTokens: number;
  avgToolCalls: number;
  avgLlmCalls: number;
  avgExecutionTimeMs: number;
  /** Average judge score (0-100) across judged runs */
  avgJudgeScore: number;
  /** Number of runs that passed judge evaluation */
  judgePassCount: number;
  /** Label for this aggregate group (e.g. "glm-5-2/sverka=on") */
  label: string;
}

/** Full arena result — all cells in the matrix */
export interface ArenaResult {
  timestamp: string;
  config: {
    models: string[];
    plugins: string[];
    tasks: string[];
    repetitions: number;
    judgeModel?: string;
  };
  results: RunResult[];
  aggregates: AggregateMetrics[];
  /** Per-task analysis comparing plugin on vs off */
  analysis: CaseAnalysis[];
}

/** Analysis of a single case (task) across plugin combinations */
export interface CaseAnalysis {
  taskId: string;
  taskName: string;
  prompt: string;
  /** Comparison between plugin combos for this task */
  comparisons: ComboComparison[];
  /** AI-generated summary of findings for this case */
  summary?: string;
}

/** Comparison between two plugin combos for a task */
export interface ComboComparison {
  /** Plugin combo label (e.g. "no-plugins" vs "sverka") */
  baseline: string;
  candidate: string;
  /** Metric deltas (candidate - baseline) */
  deltaTokens: number;
  deltaToolCalls: number;
  deltaLlmCalls: number;
  deltaTimeMs: number;
  deltaJudgeScore: number;
  /** Whether the candidate is better than baseline */
  candidateBetter: boolean;
}
