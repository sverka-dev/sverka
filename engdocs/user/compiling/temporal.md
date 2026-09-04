# Temporal compiler target

> **Work in progress.** The Temporal compiler generates workflow + activity
> stubs. You deploy them to your own Temporal worker. APIs may change.

The `@sverka/compiler` Temporal sub-module compiles a DefinitionGraph to a
Temporal Workflow TypeScript file. Each step becomes a Temporal Activity.
Step dependencies become workflow sequencing (`await`). Triggers become
workflow handlers.

## Usage

```ts
import { Project, Pipeline, ShellStep, Entry } from "@sverka/workflow";
import { synthesize } from "@sverka/workflow";
import { compileTemporal } from "@sverka/compiler";

const proj = new Project("myproj");
const p = new Pipeline(proj, "ci");
new ShellStep(p, "lint", { command: "npm run lint" });
new Entry(p, "on-push", { trigger: { kind: "manual" }, roots: ["lint"] });

const graph = synthesize(proj);

const result = compileTemporal(graph, {
  namespace: "default",
  taskQueue: "sverka",
});

// result.artifacts: [{ path: "ci.workflow.ts", content: "..." }, { path: "ci.activities.ts", content: "..." }]
```

## What gets generated

- **`<name>.workflow.ts`** — Temporal workflow definition. Step DAG becomes
  `await activity()` sequencing. `manual` and `schedule` triggers currently
  produce only trigger comments in the generated code (not actual signal
  handlers or timers). `push`/`changeRequest` → unsupported diagnostic.
- **`<name>.activities.ts`** — Activity stubs that execute lowered shell
  commands directly via `runStep` (no Sverka CLI required).

## Capability mapping

| Sverka feature | Temporal mapping |
|----------------|-----------------|
| Step DAG | `await activity()` sequencing |
| `manual` trigger | Trigger comment (signal handler not yet generated) |
| `schedule` trigger | Trigger comment (timer not yet generated) |
| `push` / `changeRequest` trigger | Unsupported (diagnostic) |
| `policy.retry` | Temporal retry policy on activities |
| `policy.timeout` | Temporal activity timeouts |
| Suspend/resume | Follow-up (Temporal has `AsyncCompletion`) |
| Saga compensations | Follow-up (Temporal has compensation patterns) |
| Matrix | One activity call per combo (no Temporal-native matrix) |

## What you need to provide

- A Temporal worker running the generated workflow + activities.
- Worker configuration (queues, identity, etc.).
