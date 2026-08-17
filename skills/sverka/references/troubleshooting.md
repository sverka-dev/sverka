# Troubleshooting

## `sverka run` exits with code 1

Exit code 1 means policy failure — findings exceeded the configured
thresholds. Check the findings output:

```bash
sverka run --format json | jq '.findings[] | {rule, severity, file}'
```

Evaluate policy against a SARIF findings file:

```bash
sverka policy --findings findings.sarif
```

## `sverka run` exits with code 3

Exit code 3 means runtime error. Common causes:

- **Docker not available:** `sverka run --executor docker` requires Docker
  on PATH. Check with `sverka doctor`.
- **Config not found:** sverka can't find `sverka.config.ts`. Run
  `sverka init` or specify `--config path/to/config`.

## `bun test` fails but `bun run test` passes

`bun test` runs Bun's built-in test runner, not vitest. Always use
`bun run test` (which runs `vitest run` via nx).

## `sverka plan` shows no steps

The config has no `Entry` constructs, or the entry's `roots` reference
non-existent step IDs. Check:

```bash
sverka graph --format json | jq '.entries[]'
sverka graph --format json | jq '.steps[].id'
```

Make sure your config exports a `Project` (or `Pipeline`) with at least
one `Entry` pointing to valid step IDs.

## `sverka validate` reports cycle

A dependency cycle exists in the Definition Graph. Check:

```bash
sverka graph --format json | jq '.steps[] | {id, dependencies}'
```

Look for steps that depend on each other transitively. Remove the
circular `dependsOn` reference.

## `sverka synth` reports unsupported feature

The target CI system doesn't support a feature used in the workflow.
For example, GitLab doesn't support `workflow_call` triggers. Check
the capability diagnostics:

```bash
sverka graph --format json | jq '.diagnostics'
```

Either remove the unsupported feature or switch to a target that
supports it.

## Config not loading

Sverka config files are TypeScript (`sverka.config.ts`). They must
export a `Project` or `Pipeline` as the default export:

```typescript
import { Project, Pipeline, ShellStep, Entry } from "@sverka/cdk";

const proj = new Project("verify");
// ... build pipeline ...

export default proj;
```

If using the SDK or Decorator API, make sure `@sverka/sdk` or
`@sverka/decorators` is installed in the project (`bun add @sverka/sdk`).

## `fromClass` throws "not a decorated pipeline"

The class is missing the `@pipeline` decorator. Make sure the class
is decorated:

```typescript
import { pipeline, step, fromClass } from "@sverka/decorators";

@pipeline          // <-- required
class CiPipeline {
  @step build = "bun run build"
}

export default fromClass(CiPipeline, "ci");
```
