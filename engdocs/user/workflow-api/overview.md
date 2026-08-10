# Workflow API

Sverka workflows are TypeScript. Compose operations with seven functions
exported from `@sverka/sdk`.

## `pipeline(...operations)`

Sequential composition. Each operation depends on the previous one,
forming a linear chain.

```ts
import { pipeline, run } from "@sverka/sdk";

const p = pipeline(
  run({ command: "bun", args: ["run", "lint"] }),
  run({ command: "bun", args: ["run", "test"] }),
);
```

## `run(spec)`

Define a single run operation. Lazy: no side effects at call time.

```ts
import { run } from "@sverka/sdk";

const lint = run({ command: "eslint", args: ["."], image: "node:24" });
```

`spec` is a `Partial<OperationSpec>`. Common fields:

| Field     | Type     | Description                          |
|-----------|----------|--------------------------------------|
| `command` | `string` | Shell command to run                 |
| `args`    | `string[]` | Arguments to pass to the command   |
| `image`   | `string` | Container image (for Docker executor) |
| `kind`    | `string` | Operation kind (defaults to `"run"`)  |

## `parallel(...operations)`

Concurrent composition. Siblings share the same implicit join point; no
dependency edges between them.

```ts
import { parallel, run } from "@sverka/sdk";

const all = parallel(
  run({ command: "bun", args: ["run", "lint"] }),
  run({ command: "bun", args: ["run", "test"] }),
  run({ command: "bun", args: ["run", "typecheck"] }),
);
```

## `when(condition, operation)`

Conditionally include an operation. The condition is an expression string
evaluated at plan time against the plan context. When false, the operation
is recorded but marked skipped.

```ts
import { when, run } from "@sverka/sdk";

const nightly = when("schedule == 'nightly'", run({ command: "bun", args: ["run", "test"] }));
```

## `matrix(dimensions, operation)`

Expand an operation across a matrix of variable values. Each combination
becomes a separate node in the graph.

```ts
import { matrix, run } from "@sverka/sdk";

const multi = matrix({ node: ["20", "22", "24"] }, run({ command: "bun", args: ["run", "test"] }));
```

## `task(name, operation)`

Name an operation. Sugar for `op.named(name)`. Useful for labeling
operations in plan output.

```ts
import { task, run } from "@sverka/sdk";

const lint = task("lint", run({ command: "bun", args: ["run", "lint"] }));
```

## `defineWorkflow(definition)`

Type-safe helper for `sverka.config.ts`. Identity function that ensures
the workflow definition matches the expected shape.

```ts
import { defineWorkflow, pipeline, task, run } from "@sverka/sdk";

export default defineWorkflow({
  name: "verify",
  workflow: pipeline(
    task("lint", run({ command: "bun", args: ["run", "lint"] })),
  ),
});
```

## Runtime SDK exports

In addition to the composables above, `@sverka/sdk` re-exports runtime
functions, error classes, and the Sverka facade. These are used by the CLI
and by programmatic consumers that need direct access to planning, execution,
or configuration loading.

### Sverka facade

| Export | Type | Description |
|--------|------|-------------|
| `createSverka(options)` | function | Create a Sverka instance with root, config path, executor, baseline, and onlyNew options. Provides `plan()` and `execute()` methods. |
| `plan(options)` | function | Top-level convenience: discover context, propose checks, resolve to operations. Returns `PlanResult`. |
| `execute(options)` | function | Top-level convenience: plan + execute. Returns `ExecutionResult` with verdict, findings, and outcomes. |
| `findConfig(root)` | function | Auto-discover `sverka.config.ts` in the given root directory. Returns the path or `null`. |
| `loadWorkflow(configPath)` | function | Load and import a `sverka.config.ts` file. Returns the `WorkflowDefinition`. |

### Planning

| Export | Type | Description |
|--------|------|-------------|
| `createPlanner(options)` | function | Create a planner instance for project context discovery and check proposal. |
| `computePlanId(plan)` | function | Compute the deterministic plan ID from a `Plan` object. |
| `validatePlan(plan)` | function | Validate a `Plan` against the IR schema. Returns the plan or throws. |

### Error classes

| Export | Type | Description |
|--------|------|-------------|
| `CoreError` | class | Base error for core composition failures. |
| `PlanningError` | class | Error thrown during planning (discovery, proposal). |
| `CompositionError` | class | Error thrown during workflow composition (invalid graph). |

```ts
import { createSverka, findConfig, loadWorkflow, validatePlan, computePlanId } from "@sverka/sdk";
import { CoreError, PlanningError, CompositionError } from "@sverka/sdk";
import { createPlanner } from "@sverka/sdk";
```

## Combining composables

Composables compose freely:

```ts
import { defineWorkflow, pipeline, parallel, task, run, when } from "@sverka/sdk";

export default defineWorkflow({
  name: "verify",
  workflow: pipeline(
    task("lint", run({ command: "bun", args: ["run", "lint"] })),
    parallel(
      task("typecheck", run({ command: "bun", args: ["run", "typecheck"] })),
      task("test", run({ command: "bun", args: ["run", "test"] })),
    ),
    when("schedule == 'nightly'", run({ command: "bun", args: ["run", "test:integration"] })),
  ),
});
```
