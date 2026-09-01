# Spec 33 — Temporal Code Generation Target

**Status:** Active
**Source:** specs/architecture-spec.md §19 (Target Contract), §24 (Capability Model), §29 (Package Surface)
**Package:** `@sverka/compiler` (temporal sub-module)
**Capability namespace:** `temporal.*`
**Related:** ADR-016, Spec 08 (github target), Spec 09 (gitlab target)

## Overview

Compile a DefinitionGraph to a Temporal Workflow TypeScript file. Each
step becomes a Temporal Activity. Step dependencies become workflow
sequencing (`await`). Triggers become workflow handlers (manual → signal,
schedule → timer). The user deploys the generated workflow + activities
to their Temporal worker.

## Goals

- `compileTemporal(graph, config?): CompilationResult` — pure function,
  no network, deterministic output.
- Emit two files: `<name>.workflow.ts` (workflow definition) +
  `<name>.activities.ts` (activity stubs that call `sverka run --step`).
- Map step DAG to activity `await` sequencing.
- Map triggers: `manual` → Temporal signal handler; `schedule` → timer;
  `push`/`changeRequest` → unsupported (diagnostic).
- Map `policy.retry` → Temporal retry policy on activities.
- Map `policy.timeout` → Temporal activity timeouts.
- Capability manifest declaring native/lowered/emulated/unsupported.

## Non-goals

- Executing the workflow (no `@temporalio/sdk` dep — ADR-016).
- Activity implementation (stubs call `sverka run --step <id>`).
- Worker configuration (user sets up their own Temporal worker).
- Matrix expansion (generate one activity call per matrix combo; no
  Temporal-native matrix).
- Suspend/resume mapping (Temporal has `AsyncCompletion` — follow-up).
- Saga compensation mapping (Temporal has compensation patterns —
  follow-up).

## Interfaces

```ts
interface TemporalTargetConfig {
  readonly namespace?: string;   // default: "default"
  readonly taskQueue?: string;   // default: "sverka"
}

function compileTemporal(
  graph: DefinitionGraph,
  config?: TemporalTargetConfig,
): CompilationResult;

class TemporalTarget implements Target {
  readonly name = "temporal";
  readonly capabilities: CapabilityManifest;
  constructor(config?: TemporalTargetConfig);
  compile(graph: DefinitionGraph): CompilationResult;
}
```

Exported types: `TemporalTargetConfig`, `TemporalTargetGraph`,
`TemporalWorkflow`, `TemporalActivity`, `GeneratedArtifact`,
`TargetDiagnostic`, `CompilationResult`. `Target` is reused from
`@sverka/compiler` plugin types.

## Data models

### Generated workflow structure

```
<name>.workflow.ts
  - import { defineWorkflow, proxyActivities } from "@temporalio/workflow"
  - import type * as activities from "./<name>.activities.js"
  - proxyActivities({ startToCloseTimeout, retry })
  - export const <entryId> = defineWorkflow(<entryId>, [<inputs>], async (...) => {
      // One await runStep(<stepId>) per step, sequenced by DAG
      // Conditions → if/else
      // Matrix → for-loop with one activity call per combo
    })

<name>.activities.ts
  - import { defineActivity } from "@temporalio/activity"
  - export const runStep = defineActivity("runStep", async (stepId: string) => {
      // execSync(`sverka run --step ${stepId}`)
    })
```

### Step → activity mapping

| Sverka | Temporal |
|---|---|
| Step | Activity (`runStep(stepId)`) |
| Dependency | `await` sequencing |
| Condition | `if`/`else` in workflow body |
| Matrix | `for` loop with activity calls |
| RetryPolicy | Activity retry config |
| Timeout | `startToCloseTimeout` |
| Shell operation | Activity stub calls `sverka run --step` |
| Scalar output | Activity return value |
| Artifact output | `sverka run` handles; activity returns path |

### Capability manifest

```ts
const temporalCapabilities: CapabilityManifest = {
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
  "agent.step": "emulated",
};
```

## Error handling

`TemporalTargetError` with `override readonly cause: unknown`. Codes:
- `INVALID_GRAPH` — no pipelines or no entries.
- `LOWER_FAILED` — step lowering error.
- `EMIT_FAILED` — code generation error.

## Test plan

1. Empty graph → `INVALID_GRAPH` error.
2. Single-step graph → workflow with one activity call.
3. Two-step graph with dependency → workflow with sequential awaits.
4. Diamond dependency (A→B,C→D) → correct await ordering.
5. Manual trigger → workflow with signal handler.
6. Schedule trigger → workflow with timer handler.
7. Push trigger → unsupported diagnostic.
8. RetryPolicy → activity retry config in generated code.
9. Timeout → `startToCloseTimeout` in generated code.
10. Matrix → for-loop with activity calls per combo.
11. Condition (status: failure) → if/else in workflow body.
12. Generated workflow code is valid TypeScript (parse with `tsx --check`
    or regex structural assertions).
13. Determinism: same graph → identical output (byte-for-byte).
14. Capability manifest exported and correct.
15. Public API: `compileTemporal` + `TemporalTarget` + types exported.
