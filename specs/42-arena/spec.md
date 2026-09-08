# Spec 42: Arena — Abstract Agent Benchmark Framework

## Purpose

TypeScript-native framework for measuring the **causal lift** of agent
plugins/skills. Run the same prompt against an agent with different configs
(model, plugins on/off) and collect traces, tokens, tool calls, and timing.

**Unique vs existing tools (all Python):**

- TypeScript native, ships as npm package (`@sverka/arena`)
- Gas City formula orchestration
- Visual trace viewer with per-call inspection
- Devin support (ACP protocol)
- Abstract agent/model/plugin interfaces

## Core Interfaces

### AgentAdapter

Pluggable interface for different agent CLIs (Devin, Claude Code, Codex, …).

```typescript
interface AgentAdapter {
  /** Unique adapter id (e.g. "devin", "claude", "codex") */
  id: string;
  /** Spawn the agent process with given model + workspace */
  spawn(config: AgentSpawnConfig): AgentProcess;
}

interface AgentSpawnConfig {
  model: ModelConfig;
  workspace: string;
  /** Plugins to install in workspace before spawning */
  plugins: PluginConfig[];
  /** Permission mode */
  permissionMode?: "auto" | "dangerous" | "accept-edits";
  /** Extra env vars */
  env?: Record<string, string>;
}

interface AgentProcess {
  /** ACP session runner — returns trace + metrics */
  run(prompt: string, timeoutMs: number): Promise<RunResult>;
  /** Kill the agent process */
  kill(): void;
}
```

### ModelConfig

```typescript
interface ModelConfig {
  /** Model id passed to agent (e.g. "glm-5-2", "claude-sonnet-4") */
  id: string;
  /** Display name */
  name: string;
  /** Env var to set (e.g. DEVIN_MODEL) */
  envVar?: string;
}
```

### PluginConfig

The variable we're testing — a skill/plugin installed in the workspace.

```typescript
interface PluginConfig {
  /** Plugin id (e.g. "sverka", "reuse-first") */
  id: string;
  /** Display name */
  name: string;
  /** Path to skill directory or file */
  path: string;
  /** Whether to install this plugin in the workspace */
  enabled: boolean;
  /** Where to install (e.g. ".agents/skills/<id>/") */
  installPath?: string;
}
```

### Task

```typescript
interface Task {
  id: string;
  name: string;
  prompt: string;
  timeoutMs?: number;
  /** Optional success criteria for judge evaluation */
  successCriteria?: string;
}
```

### ArenaConfig

Defines the full matrix.

```typescript
interface ArenaConfig {
  tasks: Task[];
  agent: AgentAdapter;
  models: ModelConfig[];
  plugins: PluginConfig[];
  workspace?: string;
  /** Number of repetitions per cell (for pass@k) */
  repetitions?: number;
  outputDir: string;
}
```

### RunResult + RunMetrics

```typescript
interface RunResult {
  taskId: string;
  modelId: string;
  pluginIds: string[];
  metrics: RunMetrics;
  trace: TraceData;
  success: boolean;
  error?: string;
}

interface RunMetrics {
  inputTokens: number;
  outputTokens: number;
  thoughtTokens: number;
  totalTokens: number;
  toolCallCount: number;
  llmCallCount: number;
  executionTimeMs: number;
  stopReason: string;
}
```

### TraceData + TraceStep + ToolCall + Observation

```typescript
interface TraceData {
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

interface TraceStep {
  stepId: number;
  timestamp: string;
  source: "system" | "agent" | "user";
  message: string;
  toolCalls?: ToolCall[];
  observations?: Observation[];
  isLlmCall: boolean;
}

interface ToolCall {
  functionName: string;
  arguments: Record<string, unknown>;
  toolCallId: string;
}

interface Observation {
  sourceCallId: string;
  content: string;
}
```

### AggregateMetrics + ArenaResult

```typescript
interface AggregateMetrics {
  totalRuns: number;
  successCount: number;
  avgInputTokens: number;
  avgOutputTokens: number;
  avgTotalTokens: number;
  avgToolCalls: number;
  avgLlmCalls: number;
  avgExecutionTimeMs: number;
}

interface ArenaResult {
  timestamp: string;
  config: {
    models: string[];
    plugins: string[];
    tasks: string[];
    repetitions: number;
  };
  results: RunResult[];
  aggregates: AggregateMetrics[];
}
```

## Matrix Execution Model

The runner executes a full matrix:

```
for each task:
  for each model:
    for each plugin combination (on/off):
      for each repetition:
        spawn agent with config
        run prompt
        collect trace + metrics
        kill agent
```

Plugin combinations are derived from `plugins[]`:

- If 1 plugin: 2 cells (off, on)
- If 2 plugins: 4 cells (off/off, on/off, off/on, on/on)
- etc. (2^n combinations)

Each cell is repeated `repetitions` times (default 1) for pass@k statistics.

## Devin ACP Adapter Design

The primary adapter (`src/adapters/devin.ts`) wraps the Devin CLI's ACP mode.

**Spawn flow:**

1. Install enabled plugins into `workspace/.agents/skills/<id>/` (copy from
   `PluginConfig.path` to `PluginConfig.installPath`).
2. Set env vars: `DEVIN_MODEL` from `ModelConfig.envVar`, plus any
   `AgentSpawnConfig.env`.
3. Spawn `devin acp` as a child process with the workspace as cwd.
4. Return an `AgentProcess` that drives the ACP session.

**Run flow:**

1. Create an ACP session via the SDK.
2. Send the prompt as a user message.
3. Subscribe to events: `agent_message`, `tool_call`, `tool_result`,
   `task_update`, `usage`.
4. Accumulate metrics + trace steps until `stopReason` is received or timeout.
5. Return `RunResult` with full `TraceData`.

**Kill flow:**

1. Abort the ACP session.
2. Terminate the child process.

## Trace Collector Design

The trace collector (`src/collector.ts`) merges two data sources:

### 1. ACP events (live)

- `agent_message` → `TraceStep` with `source: "agent"`
- `tool_call` → `ToolCall` on the current step
- `tool_result` → `Observation` linked by `sourceCallId`
- `usage` → accumulate token counts
- `task_update` → step boundary / `stopReason`

### 2. Devin transcripts (post-run)

Devin writes transcript JSON to
`~/.local/share/devin/cli/transcripts/<session-id>.json`.

The collector reads the transcript after the run to fill in any missing
fields (e.g. `thoughtTokens`, `isLlmCall` flags) and to cross-check token
counts against the live ACP usage events.

**Merge strategy:**

- ACP events are authoritative for tool calls and observations.
- Transcript is authoritative for token breakdowns and LLM call counts.
- Steps are keyed by `stepId`, deduplicated by timestamp.

## CLI

```
arena run --config arena.config.ts
```

- `--config` — path to a TypeScript module exporting an `ArenaConfig`
- `--output` — override `outputDir`
- `--filter` — task/model/plugin filters (optional)
- `--repetitions` — override repetitions (optional)

The CLI loads the config, runs the matrix, and writes:

- `<outputDir>/arena-<timestamp>.json` — full `ArenaResult`
- `<outputDir>/traces/<taskId>-<modelId>-<pluginCombo>-<rep>.json` — per-run traces

## Migration from @sverka/benchmark

The existing `packages/benchmark/` will be superseded by `packages/arena/`.
The hardcoded "raw-shell" vs "sverka" agent types are replaced with the
abstract `PluginConfig` system. A backward-compatible re-export will be
provided during migration.

## Dashboard

The existing dashboard at `website/public/benchmark/` will be updated:

- Index page: matrix view (task × plugin combo, per model)
- Trace page: per-task, per-cell trace with tool call inspector
- LLM call counter per cell
- Token/tool/time comparison
