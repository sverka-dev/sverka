# Spec 27 — AgentStep

**Status:** Active
**Source:** specs/architecture-spec.md §9 (Authoring), §14.1 (Runtime — "abstract agent selectors"), §22 (Native Engine)
**Package:** `@sverka/workflow` (model: `AgentOperation`, `AgentStep`), `@sverka/sdk` (`agent` tagged template), `@sverka/runtime` (engine: `AgentDriver`)
**Bead:** sv-wthn.2.2
**Depends on:** sv-wthn.2.1 (MCP plugin — `ToolProvider` facet)
**Related:** Spec 23 (MCP plugin), Spec 10 (engine-native), Spec 03 (SDK)

## Overview

AI agent as a step type. An `AgentStep` runs an AI engine (Copilot/Claude/
GPT/Gemini) with a prompt, optional MCP tools, and token budget. The agent
invocation is a new `OperationDefinition` kind `"agent"` — it executes
inside a step like `shell`, via a new `AgentDriver` runtime interface. The
SDK provides an `agent` tagged template (mirrors `$` for shell).

Non-deterministic by design: agent steps are **excluded from replay** (the
engine marks them non-cacheable and skips cache restore), and the result
(text + tool-call trace) is **saved as an artifact** for auditability.

Inspired by gh-aw agentic workflows + Mastra agent steps.

## Goals

- `AgentOperation` added to `OperationDefinition` union: `{ kind: "agent",
  engine, model?, prompt, tools?, maxTokens? }`.
- `AgentStep` class in cdk (extends `Step`); `AgentStepProps`.
- `agent` tagged template in SDK (mirrors `$`): returns `AgentStepBuilder`.
- `AgentDriver` runtime interface in engine-native: `executeAgent(request)
  → AgentResult`. The native engine selects an `AgentDriver` from its
  config when a step has an `agent` operation.
- `AgentResult`: `{ text, toolCalls?, finishReason, usage? }` — saved as
  artifact (`<stepId>/agent-result.json`).
- Engine: agent steps are non-cacheable (cache skipped regardless of
  `cache` spec); result saved as artifact automatically.
- `RunEvent`: agent steps emit the standard step lifecycle events
  (pending/ready/started/succeeded/failed); no new event variant needed.
- `agent.step` capability declared in target manifests: native engine
  `native`; GHA `emulated` (runs via sverka execute); GitLab `emulated`.

## Non-goals

- AI engine SDK integrations (Copilot/Claude/GPT/Gemini clients) — NOT
  bundled. `AgentDriver` is an interface; concrete drivers (e.g.
  `@sverka/agent-openai`) are follow-up packages. The native engine ships
  with a **stub driver** that returns a fixed result (for testing).
- Streaming agent output (token-by-token) — follow-up; v1 returns the
  complete result.
- Agent step replay/caching — explicitly excluded (non-deterministic).
- Agent step in targets (GHA/GitLab lowering) — `emulated` (the compiled
  workflow runs `sverka execute` which uses the native engine); no native
  GHA/GitLab agent job type.
- Multi-turn agent conversations within a step — follow-up; v1 is
  single-prompt → result.
- Tool-call execution loop (agent calls tool → tool returns → agent
  continues) — v1 exposes tools to the driver; the loop is the driver's
  responsibility. The stub driver doesn't loop.
- Cost/token tracking — sv-wthn.5.2 (Wave 5).

## Interfaces

### Model (`@sverka/workflow` cdk)

```ts
export interface AgentToolRef {
  readonly plugin: string;   // e.g. "mcp"
  readonly tool: string;     // e.g. "github.create-pr"
}

export interface AgentOperation {
  readonly kind: "agent";
  readonly engine: string;           // e.g. "claude", "gpt-4", "copilot"
  readonly model?: string;           // e.g. "claude-sonnet-4-5"
  readonly prompt: string;
  readonly tools?: readonly AgentToolRef[];
  readonly maxTokens?: number;
}
```

`OperationDefinition` union gains `AgentOperation`.

```ts
export interface AgentStepProps extends StepProps {
  readonly engine: string;
  readonly model?: string;
  readonly prompt: string;
  readonly tools?: readonly AgentToolRef[];
  readonly maxTokens?: number;
}

export class AgentStep extends Step {
  readonly engine: string;
  readonly model?: string;
  readonly prompt: string;
  readonly tools: readonly AgentToolRef[];
  readonly maxTokens?: number;
  constructor(scope: Pipeline, id: string, props: AgentStepProps);
}
```

### SDK (`@sverka/sdk`)

```ts
export interface AgentStepBuilder {
  outputs(outputs: Readonly<Record<string, OutputDeclaration>>): AgentStepBuilder;
  inputs(inputs: readonly Reference[]): AgentStepBuilder;
  dependsOn(steps: readonly string[]): AgentStepBuilder;
  tools(...tools: readonly AgentToolRef[]): AgentStepBuilder;
  model(model: string): AgentStepBuilder;
  maxTokens(n: number): AgentStepBuilder;
  build(pipeline: Pipeline, id: string): AgentStep;
}

export function agent(
  strings: TemplateStringsArray,
  ...values: readonly (string | Reference)[]
): AgentStepBuilder;
```

`agent\`Build and test the project\`` creates an `AgentStepBuilder` with
`engine: "default"`. The builder's `.engine("claude")` method sets the
engine (or pass via a config object — see alternatives).

### Engine (`@sverka/runtime` engine-native)

```ts
export interface AgentExecuteRequest {
  readonly engine: string;
  readonly model?: string;
  readonly prompt: string;
  readonly tools?: readonly AgentToolRef[];
  readonly maxTokens?: number;
  readonly workspace: string;
  readonly signal?: AbortSignal;
}

export interface AgentUsage {
  readonly promptTokens?: number;
  readonly completionTokens?: number;
  readonly totalTokens?: number;
}

export interface AgentResult {
  readonly text: string;
  readonly toolCalls?: readonly { readonly tool: string; readonly args: Readonly<Record<string, unknown>>; readonly result?: unknown }[];
  readonly finishReason: "stop" | "length" | "tool-call" | "error";
  readonly usage?: AgentUsage;
}

export interface AgentDriver {
  readonly name: string;
  canExecute(engine: string): boolean;
  executeAgent(request: AgentExecuteRequest): Promise<AgentResult>;
  dispose?(): Promise<void>;
}
```

`EngineConfig` gains `readonly agentDrivers?: readonly AgentDriver[]`.
`RuntimeDriver` is unchanged (shell only). The engine's `runStep` checks
if the step has an `agent` operation; if so, it selects an `AgentDriver`
via `canExecute(engine)`.

### Stub driver (shipped with engine-native)

```ts
export function createStubAgentDriver(): AgentDriver;
```

Returns a driver that responds with a fixed `AgentResult` (`text:
"[stub agent response]", finishReason: "stop"`). For testing only.

## Data models

### Synthesis

`AgentStep` synthesizes to a `StepDefinition` with one `AgentOperation`.
The step's `runtime` is `host` (agents run in-process, not in containers
in v1). The prompt is interpolated at runtime (references resolved by the
engine, same as shell command interpolation).

### Engine execution

1. `runStep` detects `op.kind === "agent"`.
2. Selects `AgentDriver` from `config.agentDrivers` via `canExecute(engine)`.
3. If no driver: step fails with `NO_AGENT_DRIVER` diagnostic.
4. Calls `executeAgent(request)` with resolved prompt (references
   interpolated).
5. Saves `AgentResult` as artifact: `<artifactDir>/<stepId>/agent-result.json`.
6. Step outcome: `succeeded` if `finishReason !== "error"`, else `failed`.
7. Cache: **skipped** for agent steps (non-deterministic). The engine
   checks `op.kind === "agent"` and skips `tryCacheHit`/`storeCacheResult`
   even if `step.cache` is set.

### Tool resolution

`AgentToolRef` names a tool by `plugin.tool` (e.g. `mcp.github.create-pr`).
The engine resolves the tool provider from the plugin registry at runtime.
If the tool is not found, the agent runs without it (warn diagnostic) —
the agent driver decides how to handle missing tools.

## Error handling

- `NO_AGENT_DRIVER`: no `AgentDriver` in config can handle the step's
  `engine`. Step fails (not a throw — emits `step-failed` with the error
  message).
- `AgentDriverError` (new, in engine-native): wraps driver-thrown errors.
  `override readonly cause`. Code: `AGENT_EXECUTION_FAILED`.
- Tool-not-found: non-fatal (warn diagnostic); agent runs without the tool.
- No new `SynthesisError` codes — `AgentStep` validation is standard
  (non-empty `engine`, `prompt`).

## Test plan

1. `AgentStep` synthesizes to `StepDefinition` with an `agent` operation
   (verify via synthesize + graph inspect).
2. `agent\`prompt\`` SDK builder creates an `AgentStep` with `engine:
   "default"`, the prompt string, and no tools.
3. `agent\`prompt\`.tools({ plugin: "mcp", tool: "github.create-pr" })`
   adds a tool ref to the step.
4. `agent\`prompt\`.engine("claude").model("claude-sonnet-4-5")` sets
   engine + model.
5. Engine with stub driver: agent step emits standard lifecycle events
   (pending→ready→started→succeeded), result saved as artifact.
6. Engine with no agent driver: agent step fails with `NO_AGENT_DRIVER`
   (step-failed event, no throw).
7. Engine: agent step with `cache` set → cache skipped (no cache-hit
   event, no store call).
8. Agent driver that throws → `AgentDriverError(AGENT_EXECUTION_FAILED)`,
   step fails.
9. Tool ref `{ plugin: "mcp", tool: "unknown" }` → warn diagnostic, agent
   runs without the tool.
10. `AgentResult` artifact saved at `<artifactDir>/<stepId>/agent-result.json`
    with `text`, `finishReason`, `usage`.
11. `AgentOperation`, `AgentStep`, `AgentStepProps`, `AgentToolRef` exported
    from `@sverka/workflow`.
12. `agent`, `AgentStepBuilder` exported from `@sverka/sdk`.
13. `AgentDriver`, `AgentExecuteRequest`, `AgentResult`, `AgentUsage`,
    `createStubAgentDriver` exported from `@sverka/runtime`.
14. `agent.step` capability: native engine `native`, GHA `emulated`,
    GitLab `emulated`.
