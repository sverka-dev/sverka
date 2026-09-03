# Temporal compiler target

> **Work in progress.** The Temporal compiler generates workflow + activity
> stubs. You deploy them to your own Temporal worker. APIs may change.

The `@sverka/compiler` Temporal sub-module compiles a DefinitionGraph to a
Temporal Workflow TypeScript file. Each step becomes a Temporal Activity.
Step dependencies become workflow sequencing (`await`). Triggers become
workflow handlers.

## Usage

```ts
import { compileTemporal } from "@sverka/compiler";
import { createSverka } from "@sverka/sdk";

const sverka = createSverka({ root: process.cwd() });
const graph = await sverka.toGraph();

const result = compileTemporal(graph, {
  name: "my-pipeline",
  namespace: "default",
  taskQueue: "sverka",
});

// result.artifacts: [{ path: "my-pipeline.workflow.ts", content: "..." }, { path: "my-pipeline.activities.ts", content: "..." }]
```

## What gets generated

- **`<name>.workflow.ts`** — Temporal workflow definition. Step DAG becomes
  `await activity()` sequencing. `manual` trigger → signal handler;
  `schedule` trigger → timer. `push`/`changeRequest` → unsupported
  diagnostic.
- **`<name>.activities.ts`** — Activity stubs that call `sverka run --step
  <id>`. You implement the activities by installing the Sverka CLI on your
  Temporal worker.

## Capability mapping

| Sverka feature | Temporal mapping |
|----------------|-----------------|
| Step DAG | `await activity()` sequencing |
| `manual` trigger | Signal handler |
| `schedule` trigger | Timer |
| `push` / `changeRequest` trigger | Unsupported (diagnostic) |
| `policy.retry` | Temporal retry policy on activities |
| `policy.timeout` | Temporal activity timeouts |
| Suspend/resume | Follow-up (Temporal has `AsyncCompletion`) |
| Saga compensations | Follow-up (Temporal has compensation patterns) |
| Matrix | One activity call per combo (no Temporal-native matrix) |

## What you need to provide

- A Temporal worker running the generated workflow + activities.
- The Sverka CLI installed on the worker (activities call `sverka run
  --step`).
- Worker configuration (queues, identity, etc.).
