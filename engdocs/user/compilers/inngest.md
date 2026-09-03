# Inngest compiler target

> **Work in progress.** The Inngest compiler generates a step function
> TypeScript file. You deploy it to your Inngest app. APIs may change.

The `@sverka/compiler` Inngest sub-module compiles a DefinitionGraph to an
Inngest Step Function TypeScript file. Each step becomes an Inngest
`step.run()` (durable boundary, auto-retried). Step dependencies become
step sequencing. Triggers become Inngest event triggers.

## Usage

```ts
import { compileInngest } from "@sverka/compiler";
import { createSverka } from "@sverka/sdk";

const sverka = createSverka({ root: process.cwd() });
const graph = await sverka.toGraph();

const result = compileInngest(graph, {
  name: "my-pipeline",
  eventId: "pipeline/requested",
});

// result.files: { "my-pipeline.ts": "..." }
```

## What gets generated

- **`<name>.ts`** — Inngest step function using `inngest.createFunction()`.
  Step DAG becomes `step.run()` sequencing with `await`. `manual` trigger
  → event trigger; `schedule` trigger → cron trigger.
  `push`/`changeRequest` → unsupported diagnostic. Step stubs call
  `sverka run --step <id>`.

## Capability mapping

| Sverka feature | Inngest mapping |
|----------------|----------------|
| Step DAG | `step.run()` sequencing with `await` |
| `manual` trigger | Event trigger |
| `schedule` trigger | Cron trigger |
| `push` / `changeRequest` trigger | Unsupported (diagnostic) |
| `policy.retry` | Inngest retry config (native auto-retry) |
| `policy.timeout` | Inngest step timeout |
| Suspend/resume | Follow-up (Inngest has `step.waitFor`) |
| Matrix | Parallel `step.run` calls (no Inngest-native matrix) |

## What you need to provide

- An Inngest app to deploy the generated function.
- The Sverka CLI available where the function executes (step stubs call
  `sverka run --step`).
- Queue configuration (Inngest queues, rate limiting, throttling).
