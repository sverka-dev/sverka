# Inngest compiler target

> **Work in progress.** The Inngest compiler generates a step function
> TypeScript file. You deploy it to your Inngest app. APIs may change.

The `@sverka/compiler` Inngest sub-module compiles a DefinitionGraph to an
Inngest Step Function TypeScript file. Each step becomes an Inngest
`step.run()` (durable boundary, auto-retried). Step dependencies become
step sequencing. Triggers become Inngest event triggers.

## Usage

```ts
import { Project, Pipeline, ShellStep, Entry } from "@sverka/cdk";
import { synthesize } from "@sverka/workflow";
import { compileInngest } from "@sverka/compiler";

const proj = new Project("myproj");
const p = new Pipeline(proj, "ci");
new ShellStep(p, "lint", { command: "npm run lint" });
new Entry(p, "on-push", { trigger: { kind: "push" }, roots: ["lint"] });

const graph = synthesize(proj);

const result = compileInngest(graph, {
  appId: "my-pipeline",
});

// result.artifacts: [{ path: "my-pipeline.ts", content: "..." }]
```

## What gets generated

- **`<name>.ts`** — Inngest step function using `inngest.createFunction()`.
  Step DAG becomes `step.run()` sequencing with `await`. `manual` trigger
  → event trigger; `schedule` trigger → cron trigger.
  `push`/`changeRequest` → unsupported diagnostic. Generated steps execute
  lowered commands directly via `execSync` (no Sverka CLI required).

## Capability mapping

| Sverka feature | Inngest mapping |
|----------------|----------------|
| Step DAG | `step.run()` sequencing with `await` |
| `manual` trigger | Event trigger |
| `schedule` trigger | Cron trigger |
| `push` / `changeRequest` trigger | Unsupported (diagnostic) |
| `policy.retry` | Inngest retry config (native auto-retry) |
| `policy.timeout` | Unsupported (diagnostic) |
| Suspend/resume | Follow-up (Inngest has `step.waitFor`) |
| Matrix | Parallel `step.run` calls (no Inngest-native matrix) |

## What you need to provide

- An Inngest app to deploy the generated function.
- Queue configuration (Inngest queues, rate limiting, throttling).
