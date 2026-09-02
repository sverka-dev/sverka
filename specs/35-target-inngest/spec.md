# Spec 35 — Inngest Code Generation Target

**Status:** Active
**Source:** specs/architecture-spec.md §19 (Target Contract), §24 (Capability Model), §29 (Package Surface)
**Package:** `@sverka/compiler` (inngest sub-module)
**Capability namespace:** `inngest.*`
**Related:** ADR-016, Spec 08 (github target), Spec 09 (gitlab target)

## Overview

Compile a DefinitionGraph to an Inngest Step Function TypeScript file.
Each step becomes an Inngest `step.run()` (durable boundary, auto-retried).
Step dependencies become step sequencing. Triggers become Inngest event
triggers. The user deploys the generated function to their Inngest app.

## Goals

- `compileInngest(graph, config?): CompilationResult` — pure function,
  no network, deterministic output.
- Emit one file: `<name>.ts` (Inngest step function with `createFunction`).
- Map step DAG → `step.run()` sequencing with `await`.
- Map triggers: `manual` → event trigger; `schedule` → cron trigger;
  `push`/`changeRequest` → unsupported (diagnostic).
- Map `policy.retry` → Inngest retry config (native auto-retry).
- Map `policy.timeout` → Inngest step timeout.
- Capability manifest declaring native/lowered/emulated/unsupported.

## Non-goals

- Executing the function (no `@inngest/agent-kit` dep — ADR-016).
- Step implementation (step.run stubs call `sverka run --step`).
- Queue configuration (user configures their own Inngest queues).
- Matrix expansion (generate parallel `step.run` calls; no Inngest-native
  matrix).
- Suspend/resume mapping (Inngest has `step.waitFor` — follow-up).
- Inngest middleware / rate limiting / throttling.

## Interfaces

```ts
interface InngestTargetConfig {
  readonly appId?: string;  // default: pipeline id
}

function compileInngest(
  graph: DefinitionGraph,
  config?: InngestTargetConfig,
): CompilationResult;

class InngestTarget implements Target {
  readonly name = "inngest";
  readonly capabilities: CapabilityManifest;
  constructor(config?: InngestTargetConfig);
  compile(graph: DefinitionGraph): CompilationResult;
}
```

No new types exported beyond `InngestTargetConfig`.

## Data models

### Generated function structure

```typescript
// <name>.ts
import { Inngest } from "@inngest/agent-kit";

const inngest = new Inngest({ id: "sverka" });

export const <entryId> = inngest.createFunction(
  { id: "<entryId>", name: "<pipeline-id>", retries: 3 },
  { event: "sverka/<entryId>" },  // or { cron: "0 * * * *" } for schedule
  async ({ step }) => {
    // Step: build
    await step.run("build", async () => {
      // execSync("sverka run --step build")
    });
    // Step: test (depends on build — sequential await)
    await step.run("test", async () => {
      // execSync("sverka run --step test")
    });
    return { status: "complete" };
  },
);
```

### Step → Inngest mapping

| Sverka | Inngest |
|---|---|
| Step | `step.run(stepId, async () => { ... })` |
| Dependency | Sequential `await step.run()` |
| Condition | `if`/`else` in function body |
| Matrix | `Promise.all` of `step.run` calls |
| RetryPolicy | `createFunction` retries config |
| Timeout | `step.run` timeout option |
| Shell operation | `step.run` stub calls `sverka run --step` |
| Scalar output | `step.run` return value |
| Artifact output | `sverka run` handles; `step.run` returns path |
| Manual trigger | `{ event: "sverka/<entryId>" }` |
| Schedule trigger | `{ cron: "<cron-expr>" }` |

### Capability manifest

```ts
const inngestCapabilities: CapabilityManifest = {
  "graph.dependencies": "native",
  "graph.conditions": "native",
  "graph.matrix": "emulated",
  "operation.shell": "emulated",
  "output.scalar": "native",
  "output.artifact": "partial",
  "policy.retry": "native",
  "policy.timeout": "native",
  "trigger.push": "unsupported",
  "trigger.changeRequest": "unsupported",
  "trigger.manual": "native",
  "trigger.schedule": "native",
  "runtime.host": "emulated",
  "runtime.container": "emulated",
  "agent.step": "native",
};
```

Note: `agent.step` is `native` for Inngest because Inngest is designed
for AI-agent workflows with durable step functions — a natural fit for
AgentStep.

## Error handling

`InngestTargetError` with `override readonly cause: unknown`. Codes:
- `INVALID_GRAPH` — no pipelines or no entries.
- `LOWER_FAILED` — step lowering error.
- `EMIT_FAILED` — code generation error.

## Test plan

1. Empty graph → `INVALID_GRAPH` error.
2. Single-step graph → function with one `step.run`.
3. Two-step graph with dependency → sequential `await step.run`.
4. Diamond dependency → correct await ordering.
5. Manual trigger → `{ event: "sverka/<entryId>" }` trigger.
6. Schedule trigger → `{ cron: "<expr>" }` trigger.
7. Push trigger → unsupported diagnostic.
8. RetryPolicy → `retries` in `createFunction` config.
9. Timeout → `step.run` timeout option.
10. Matrix → `Promise.all` of `step.run` calls.
11. Condition → if/else in function body.
12. Generated function code is valid TypeScript (structural assertions).
13. Determinism: same graph → identical output.
14. Capability manifest exported and correct.
15. Public API: `compileInngest` + `InngestTarget` + types exported.
