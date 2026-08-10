# First plan

This page walks through defining a workflow, synthesizing a plan, and
running verification.

## Define a workflow

Create `sverka.config.ts` in your project root (or run `sverka init` to
generate one):

```ts
import { defineWorkflow, pipeline, task, run } from "@sverka/sdk";

export default defineWorkflow({
  name: "verify",
  workflow: pipeline(
    task("lint", run({ command: "bun", args: ["run", "lint"] })),
    task("typecheck", run({ command: "bun", args: ["run", "typecheck"] })),
    task("test", run({ command: "bun", args: ["run", "test"] })),
  ),
});
```

The workflow runs lint, typecheck, and test sequentially. Each `task` names
its operation for the plan output.

## See what would run

```sh
sverka plan
```

This discovers your project, resolves checks, and prints the plan without
executing anything. You see the operation order, commands, and check IDs.

## Run verification

```sh
sverka execute
```

This runs the plan locally. Results are normalized into a single findings
report. The exit code reflects the policy verdict:

| Exit code | Meaning        |
|-----------|----------------|
| 0         | Success (pass) |
| 1         | Policy fail    |
| 2         | Usage error    |
| 3         | Runtime error  |

## Validate your config

```sh
sverka validate
```

Checks that `sverka.config.ts` loads and the workflow is well-formed. No
execution happens.

## Next steps

- [Workflow API](../workflow-api/overview.md) — all composables
- [CLI reference](../cli/overview.md) — all commands and flags
