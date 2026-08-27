# GitLab CI compiler

> **Work in progress.** The compiler API is functional but the generated
> pipeline is a thin wrapper (ADR-004) that installs the Sverka CLI and runs
> `sverka execute`. Native one-job-per-step lowering is planned but not yet
> shipped. Expect breaking changes to config types.

The `@sverka/compiler-gitlab` package compiles a canonical **Plan** (from
`@sverka/ir`) into a GitLab CI YAML string. Source:
`packages/compiler-gitlab/src/compile.ts`.

## Usage

```ts
import { compileGitlabCi } from "@sverka/compiler-gitlab";
import type { GitlabCompilerConfig } from "@sverka/compiler-gitlab";
import { createSverka } from "@sverka/sdk";

const sverka = createSverka({ root: process.cwd() });
const plan = await sverka.toPlan();

const config: GitlabCompilerConfig = {
  image: "oven/bun:latest",
  sverkaVersion: "latest",
  rules: [
    { if: '$CI_PIPELINE_SOURCE == "push"' },
    { if: '$CI_PIPELINE_SOURCE == "merge_request_event"' },
  ],
};

const yaml = compileGitlabCi(plan, config);
console.log(yaml);
```

## Public API

```ts
export function compileGitlabCi(
  plan: Plan,
  config?: GitlabCompilerConfig,
): string;
```

- **`plan`** — a `Plan` from `@sverka/ir` (obtain via `createSverka().toPlan()`
  or build one directly).
- **`config`** — optional compiler configuration. All fields optional;
  sensible defaults apply.
- **Returns** — a GitLab CI YAML string. Pure and synchronous: no I/O, no
  side effects. The same plan + config always produces the same YAML.

## Configuration types

```ts
export interface GitlabCompilerConfig {
  /**
   * Base image for the job. Defaults to "oven/bun:latest".
   * The image must provide the Bun runtime because the generated job runs
   * `bun install` in `before_script`.
   */
  readonly image?: string;
  /** Sverka version to install. Defaults to "latest". */
  readonly sverkaVersion?: string;
  /** Rules for when the pipeline should run. Defaults to push + merge request. */
  readonly rules?: readonly GitlabRule[];
}

export interface GitlabRule {
  readonly if?: string;
  readonly when?: "on_success" | "never" | "always" | "manual";
}
```

## Generated pipeline shape (ADR-004 thin wrapper)

The compiler produces a **single job** that installs the Sverka CLI and runs
`sverka execute`. The plan's operations are not lowered to individual GitLab
jobs — execution is delegated to Sverka at runtime.

```yaml
stages: [verify]
sverka:
  stage: verify
  image: oven/bun:latest
  rules:
    - if: '$CI_PIPELINE_SOURCE == "push"'
    - if: '$CI_PIPELINE_SOURCE == "merge_request_event"'
  before_script:
    - bun install -g @sverka/cli@latest
  script:
    - sverka execute
  artifacts:
    when: always
    paths:
      - .sverka/output/
```

### Image requirement

The chosen `image` **must provide the Bun runtime**, because `before_script`
runs `bun install -g @sverka/cli`. The default `oven/bun:latest` satisfies
this. If you override `image`, ensure Bun is available.

### Rules

Rules control when the pipeline runs. The defaults trigger on push and merge
request events. Each rule may declare an `if` expression and/or a `when`
value (`on_success`, `never`, `always`, `manual`). Rules with neither `if`
nor `when` are filtered out.

## CLI usage

```sh
# Print YAML to stdout
sverka compile --target gitlab

# Write to a file
sverka compile --target gitlab --output .gitlab-ci.yml
```

> **Note:** `sverka synth --target gitlab` is a **stub** and returns
> "not yet implemented". Use `sverka compile` instead.
## Support levels

| Level | Meaning |
|---|---|
| `native` | Target has a direct 1:1 mapping for this feature |
| `lowered` | Feature is translated to an equivalent target construct |
| `emulated` | Feature is approximated via a combination of target constructs |
| `partial` | Only some aspects of the feature are supported |
| `connector` | Feature requires a plugin connector to provide |
| `unsupported` | Target cannot express this feature; produces a diagnostic |

## GitLab capability manifest

> **Note:** This manifest is from the `@sverka/gitlab` native target package (Wave I). The shipped `@sverka/compiler-gitlab` thin-wrapper compiler does not use capability analysis — it delegates everything to `sverka execute`. This manifest documents the **planned** native lowering support matrix.

| Capability | Support |
|---|---|
| `trigger.push` | `native` |
| `trigger.changeRequest` | `native` |
| `trigger.manual` | `native` |
| `runtime.host` | `native` |
| `runtime.container` | `native` |
| `operation.shell` | `native` |
| `operation.import` | `lowered` |
| `output.scalar` | `lowered` |
| `output.artifact` | `native` |
| `graph.dependencies` | `native` |
| `graph.matrix` | `native` |
| `matrix.include` | `lowered` |
| `matrix.exclude` | `emulated` |
| `matrix.failFast` | `unsupported` |
| `matrix.maxParallel` | `unsupported` |
| `trigger.schedule` | `native` |
| `step.beforeScript` | `native` |
| `step.afterScript` | `native` |
| `step.continueOnError` | `native` |
| `policy.retry` | `native` |
| `execution.workdir` | `emulated` |
| `execution.shell` | `unsupported` |
| `environment.variables` | `native` |
| `secrets.runtime` | `native` |
| `secrets.pipeline-input` | `native` |
| `concurrency.interruptible` | `native` |
| `environment.permissions` | `unsupported` |
| `runner.selection` | `native` |
| `runner.group` | `unsupported` |
| `secrets.oidc` | `native` |
| `secrets.oidc.multiAudience` | `native` |
| `workflow.rules` | `native` |
| `workflow.rules.changes` | `native` |
| `workflow.rules.exists` | `native` |
| `workflow.defaults` | `native` |
| `workflow.defaults.shell` | `unsupported` |
| `workflow.defaults.workdir` | `unsupported` |
| `workflow.defaults.env` | `unsupported` |
| `workflow.defaults.beforeScript` | `native` |
| `workflow.defaults.afterScript` | `native` |
| `workflow.defaults.timeout` | `native` |
| `workflow.defaults.retry` | `native` |
| `workflow.defaults.interruptible` | `native` |
| `workflow.inputs` | `native` |
| `workflow.inputs.choice` | `native` |
| `workflow.inputs.array` | `native` |
| `workflow.inputs.pattern` | `native` |
| `environment.services` | `native` |
| `environment.services.ports` | `unsupported` |
| `deployment.environment` | `native` |
| `deployment.environment.action` | `native` |
| `deployment.environment.tier` | `native` |
| `artifact.retention` | `native` |
| `artifact.access` | `native` |
| `cache` | `native` |
| `cache.policy` | `native` |
| `cache.fallbackKeys` | `native` |
| `concurrency.group` | `native` |
| `concurrency.cancelInProgress` | `unsupported` |
| `reusable.pipeline` | `lowered` |
| `reusable.pipeline.inputs` | `native` |
| `reusable.pipeline.outputs` | `native` |
| `reusable.component` | `native` |
| `reusable.component.versioning` | `native` |
| `reusable.childPipeline` | `native` |
| `reusable.downstream` | `native` |
| `deployment.release` | `native` |
| `deployment.pages` | `native` |
| `import.gitlab` | `native` |
| `import.include` | `native` |
| `scheduling.delay` | `native` |
| `execution.background` | `emulated` |
