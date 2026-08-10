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
