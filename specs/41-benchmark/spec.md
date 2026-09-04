# Spec 41: Benchmark Arena

## Purpose

Two-agent comparison harness that measures Sverka CLI+skill delegation against
raw shell execution. Arena spawns two `devin acp` agents on the same task,
collects ACP metrics (tokens, tool calls, time, stop reason), and outputs JSON.

## Interface

### Types

```typescript
/** A benchmark task scenario. */
interface Task {
  id: string;
  name: string;
  prompt: string;
  timeoutMs?: number;
}

/** Agent configuration — determines workspace setup. */
interface AgentConfig {
  id: string;
  name: string;
  type: "raw-shell" | "sverka";
}

/** Metrics collected from ACP events + timing. */
interface RunMetrics {
  inputTokens: number;
  outputTokens: number;
  thoughtTokens: number;
  totalTokens: number;
  toolCallCount: number;
  executionTimeMs: number;
  stopReason: string;
}

/** Result of a single task+agent run. */
interface RunResult {
  taskId: string;
  agentId: string;
  agentType: string;
  metrics: RunMetrics;
  success: boolean;
  error?: string;
}

/** Aggregate metrics for one agent type across all tasks. */
interface AggregateMetrics {
  totalTasks: number;
  successCount: number;
  avgInputTokens: number;
  avgOutputTokens: number;
  avgTotalTokens: number;
  avgToolCalls: number;
  avgExecutionTimeMs: number;
}

/** Full benchmark output. */
interface BenchmarkResult {
  timestamp: string;
  model: string;
  results: RunResult[];
  summary: {
    "raw-shell": AggregateMetrics;
    sverka: AggregateMetrics;
  };
}

/** Arena configuration. */
interface BenchmarkConfig {
  tasks: Task[];
  agents: AgentConfig[];
  model?: string;
  outputDir?: string;
}
```

### Functions

```typescript
/** Run the full benchmark: each task x each agent. */
function runBenchmark(config: BenchmarkConfig): Promise<BenchmarkResult>;

/** Write benchmark results to a JSON file. */
function writeReport(result: BenchmarkResult, outputPath: string): Promise<void>;

/** Built-in task scenarios (5 tasks). */
const BENCHMARK_TASKS: Task[];

/** Default agent configs (raw-shell + sverka). */
const DEFAULT_AGENTS: AgentConfig[];
```

### Exports

```typescript
export { runBenchmark, writeReport, BENCHMARK_TASKS, DEFAULT_AGENTS };
export type { Task, AgentConfig, RunMetrics, RunResult, AggregateMetrics, BenchmarkResult, BenchmarkConfig };
```

## Architecture

### ACP Integration

Arena spawns `devin acp` as a subprocess per agent run. Communication via
JSON-RPC over stdio using `@agentclientprotocol/sdk`. Flow:

1. Spawn `devin acp --model <model>` in agent workspace
2. Initialize ACP connection (protocol version handshake)
3. Create session with workspace as `cwd`
4. Send `session/prompt` with task prompt
5. Collect `session/update` notifications:
   - `tool_call` events → increment toolCallCount
   - `usage_update` events → track context usage
6. Receive `PromptResponse` with final `usage` + `stopReason`
7. Kill subprocess, cleanup workspace

### Agent Differentiation

- **raw-shell**: Workspace has only the test project. No sverka CLI or skill.
- **sverka**: Workspace has test project + `@sverka/cli` in node_modules +
  `.agents/skills/sverka/SKILL.md` copied from repo.

Both agents get `DEVIN_PERMISSION_MODE=dangerous` to auto-approve all tools.

### Task Scenarios

5 tasks, ordered simple → complex:

1. **run-checks**: "Run all quality checks (lint, typecheck, test, build) for
   this TypeScript project and report results."
2. **discover**: "Discover what checks are available in this project and list
   them."
3. **create-config**: "Create a CI workflow configuration file for this
   project that runs lint, typecheck, test, and build in dependency order."
4. **compile-github**: "Compile a CI workflow to GitHub Actions YAML format
   for this project."
5. **multi-step**: "Create a multi-step pipeline with dependencies: lint and
   typecheck run in parallel, test depends on both, build depends on test."

### Metrics Collection

- `inputTokens`, `outputTokens`, `thoughtTokens`, `totalTokens` — from
  `PromptResponse.usage`
- `toolCallCount` — counted from `session/update` `tool_call` events
- `executionTimeMs` — wall clock from prompt send to PromptResponse
- `stopReason` — from `PromptResponse.stopReason`
- `success` — `stopReason === "end_turn"`

### Output

JSON file at `<outputDir>/benchmark-<timestamp>.json` containing
`BenchmarkResult`. Human-readable summary printed to stderr.

## Test Plan

1. Task definitions: all 5 tasks have id, name, non-empty prompt
2. Default agents: 2 agents (raw-shell + sverka) with correct types
3. Metrics extraction: correctly maps PromptResponse + event counts to RunMetrics
4. Aggregate metrics: correctly averages across multiple RunResults
5. Report writer: writes valid JSON matching BenchmarkResult schema
6. Success determination: end_turn → true, other stop reasons → false
7. Public API: exports match spec (functions + types)
8. Integration (skipped without SVERKA_BENCHMARK env): spawns real devin acp,
   runs one task, collects metrics

## Dependencies

- `@agentclientprotocol/sdk` — ACP client (zero deps, Apache-2.0)
- No `@sverka/*` workspace deps — standalone package

## Non-goals

- Dashboard rendering (Phase 4)
- Parallel agent execution (sequential for MVP)
- Real workspace project setup (tasks use prompt-only, no file fixtures for MVP)
- Cost calculation (tokens only, no $ amounts)
