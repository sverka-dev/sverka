# Run queries

> **Work in progress.** Run queries are implemented in the native engine.
> APIs may change.

A read-only **query** of a run's current state: which steps are pending,
running, succeeded, failed, and the overall run status. The engine tracks
this state internally; the query surfaces a point-in-time snapshot without
consuming the `RunEvent` stream.

## When to use queries

- **MCP server `run.status` tool** — report run progress to an AI agent.
- **`sverka status` CLI command** — show what's happening in a long run.
- **Dashboards** — poll run state without subscribing to the event stream.

## Querying a run

```ts
import { createEngine } from "@sverka/runtime";

const engine = createEngine();

const iter = engine.run({ plan, workspace: "./ws" });
for await (const event of iter) {
  if (event.type === "run-started") {
    // Query is available immediately after run-started
    const state = engine.query();
    console.log(state);
    // {
    //   runId: "run-123",
    //   planId: "rp-abc",
    //   status: "running",
    //   startedAt: 1725379200000,
    //   steps: [
    //     { stepId: "ci/lint", state: "pending" },
    //     { stepId: "ci/build", state: "pending" },
    //   ]
    // }
  }
  if (event.type === "step-succeeded") {
    const state = engine.query();
    const step = state?.steps.find(s => s.stepId === event.stepId);
    console.log(`${step?.stepId}: ${step?.state} (${step?.durationMs}ms)`);
  }
}
```

## RunState model

```ts
interface RunState {
  runId: string;
  planId: string;
  status: "running" | "success" | "failure" | "cancelled" | "suspended";
  startedAt: number;
  steps: Array<{
    stepId: string;
    state: "pending" | "ready" | "running" | "succeeded" | "failed" | "cancelled" | "skipped" | "suspended";
    durationMs?: number;
  }>;
}
```

`"running"` is the non-terminal status surfaced only by `query` — it is
**not** part of `RunStatus` (which is terminal-only).

## Limitations (v1)

- **Read-only.** Queries snapshot the current state; they do not affect
  execution.
- **Signals (write side) are deferred.** `Engine.signal(name, payload)` is
  not in v1. Suspend/resume + cancel cover the write side.
- **CI targets are emulated.** The compiled workflow runs `sverka execute`,
  which uses the native engine.
