# @sverka/arena — Abstract Agent Benchmark Framework

## Vision

TypeScript-native framework for measuring the causal lift of agent plugins/skills.
Run the same prompt against an agent with different configs (model, plugins on/off)
and collect traces, tokens, tool calls, and timing.

**Unique vs existing tools (all Python):**
- TypeScript native, ships as npm package
- Gas City formula orchestration
- Visual trace viewer with per-call inspection
- Devin support (ACP protocol)
- Abstract agent/model/plugin interfaces

## Architecture

```
packages/arena/
  src/
    types.ts          # Core interfaces: Agent, Model, Plugin, Task, RunConfig
    adapters/
      devin.ts        # Devin ACP adapter (primary)
      claude.ts       # Claude Code adapter (future)
      codex.ts        # Codex adapter (future)
    runner.ts         # Matrix runner: task × agent × model × plugins
    collector.ts      # Trace collector from ACP events + transcripts
    reporter.ts       # JSON report writer
    judge.ts          # Optional LLM judge for output quality
    index.ts          # Public API
  bin.ts              # CLI entry point
  __tests__/
    runner.test.ts
    collector.test.ts
    types.test.ts
    integration.test.ts
```

## Core Interfaces

### Agent

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

### Model

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

### Plugin/Skill

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

### Run Configuration (the matrix)

```typescript
interface ArenaConfig {
  /** Tasks to run */
  tasks: Task[];
  /** Agent adapter to use */
  agent: AgentAdapter;
  /** Models to test */
  models: ModelConfig[];
  /** Plugin configurations (each tested on/off) */
  plugins: PluginConfig[];
  /** Workspace path (defaults to cwd) */
  workspace?: string;
  /** Number of repetitions per cell (for pass@k) */
  repetitions?: number;
  /** Output directory for reports + traces */
  outputDir: string;
}
```

### Run Result + Trace

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
  llmCallCount: number;  // Number of LLM inference steps
  executionTimeMs: number;
  stopReason: string;
}

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

## Matrix Execution

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
- If 2 plugins: 4 cells (off/off, on/off, off/on, on/off)
- etc.

## Dashboard

The existing dashboard at `website/public/benchmark/` will be updated:
- Index page: matrix view (task × plugin combo, per model)
- Trace page: per-task, per-cell trace with tool call inspector
- LLM call counter per cell
- Token/tool/time comparison

## Gas City Formula

The formula `formulas/arena-benchmark.toml` orchestrates:
1. **Architect**: Design arena package interfaces + spec
2. **Builder**: Implement arena package (TDD)
3. **Builder**: Implement trace collector + dashboard integration
4. **Reviewer**: Quality gates
5. **Mayor**: Run real benchmark + publish results

## Migration from @sverka/benchmark

The existing `packages/benchmark/` will be renamed to `packages/arena/` with
backward-compatible re-export. The hardcoded "raw-shell" vs "sverka" types
will be replaced with the abstract PluginConfig system.

## Tasks

| # | Task | What |
|---|------|------|
| 1 | Spec | Write `specs/42-arena/spec.md` |
| 2 | Types | Core interfaces in `types.ts` |
| 3 | Devin adapter | ACP-based adapter with plugin install |
| 4 | Matrix runner | Full matrix execution |
| 5 | Trace collector | Collect from ACP events + transcripts |
| 6 | CLI | `arena run --config arena.config.ts` |
| 7 | Dashboard | Update dashboard for matrix view |
| 8 | Tests | Full TDD coverage |
| 9 | Real run | Execute benchmark with real agents |
