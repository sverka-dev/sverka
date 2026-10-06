# GitLab CI compiler

The `gitlab` target compiles a Sverka **Definition Graph** (from
`@sverka/workflow`) into a GitLab CI pipeline — executable steps become
jobs, `needs:` edges come from declared dependencies, and stages are
derived from topological order. Special step kinds lower differently:
component steps become `include:` entries, pipeline-call steps are inlined
as namespaced jobs, and child-pipeline steps become trigger jobs.

Only the **first root pipeline** is emitted — a single `.gitlab-ci.yml`
cannot express multiple pipelines, so additional roots are dropped.

## CLI usage

```sh
# Print YAML to stdout
sverka compile --target gitlab

# Write pipeline files into a directory
sverka compile --target gitlab --output-dir out/
```

## Generated pipeline shape

Each `ShellStep` becomes a job with its command in `script:`; dependency
wiring lands in `needs:`. Stages are computed by topological level — the
first level is `build`, each later level is `stage-N`:

```yaml
stages: [build, stage-1]
build:
  stage: build
  script:
    - bun run build
typecheck:
  stage: stage-1
  needs: [build]
  script:
    - bun run typecheck
```

Triggers come from the pipeline's `Entry` definitions; step rules map to
GitLab `rules:` (`if`/`when`). Declared step secrets map to CI/CD variables.

## Public API

```ts
import { GitlabTarget, compileGitlab } from "@sverka/compiler";

const result = compileGitlab(graph);
// result.artifacts    — GeneratedArtifact[] (.gitlab-ci.yml)
// result.diagnostics  — capability findings
```

`GitlabTarget` implements the `Target` contract: `analyze`, `lower`, `emit`,
`compile`.

## Support levels

| Level         | Meaning                                                        |
| ------------- | -------------------------------------------------------------- |
| `native`      | Target has a direct 1:1 mapping for this feature               |
| `lowered`     | Feature is translated to an equivalent target construct        |
| `emulated`    | Feature is approximated via a combination of target constructs |
| `partial`     | Only some aspects of the feature are supported                 |
| `connector`   | Feature requires a plugin connector to provide                 |
| `unsupported` | Target cannot express this feature; produces a diagnostic      |

## GitLab capability manifest

| Capability                        | Support       |
| --------------------------------- | ------------- |
| `trigger.push`                    | `native`      |
| `trigger.changeRequest`           | `native`      |
| `trigger.manual`                  | `native`      |
| `runtime.host`                    | `native`      |
| `runtime.container`               | `native`      |
| `operation.shell`                 | `native`      |
| `operation.import`                | `lowered`     |
| `output.scalar`                   | `lowered`     |
| `output.artifact`                 | `native`      |
| `graph.dependencies`              | `native`      |
| `graph.matrix`                    | `native`      |
| `matrix.include`                  | `lowered`     |
| `matrix.exclude`                  | `emulated`    |
| `matrix.failFast`                 | `unsupported` |
| `matrix.maxParallel`              | `unsupported` |
| `trigger.schedule`                | `native`      |
| `step.beforeScript`               | `native`      |
| `step.afterScript`                | `native`      |
| `step.continueOnError`            | `native`      |
| `policy.retry`                    | `native`      |
| `execution.workdir`               | `emulated`    |
| `execution.shell`                 | `unsupported` |
| `environment.variables`           | `native`      |
| `secrets.runtime`                 | `native`      |
| `secrets.pipeline-input`          | `native`      |
| `concurrency.interruptible`       | `native`      |
| `environment.permissions`         | `unsupported` |
| `runner.selection`                | `native`      |
| `runner.group`                    | `unsupported` |
| `secrets.oidc`                    | `native`      |
| `secrets.oidc.multiAudience`      | `native`      |
| `workflow.rules`                  | `native`      |
| `workflow.rules.changes`          | `native`      |
| `workflow.rules.exists`           | `native`      |
| `workflow.defaults`               | `native`      |
| `workflow.defaults.shell`         | `unsupported` |
| `workflow.defaults.workdir`       | `unsupported` |
| `workflow.defaults.env`           | `unsupported` |
| `workflow.defaults.beforeScript`  | `native`      |
| `workflow.defaults.afterScript`   | `native`      |
| `workflow.defaults.timeout`       | `native`      |
| `workflow.defaults.retry`         | `native`      |
| `workflow.defaults.interruptible` | `native`      |
| `workflow.inputs`                 | `native`      |
| `workflow.inputs.choice`          | `native`      |
| `workflow.inputs.array`           | `native`      |
| `workflow.inputs.pattern`         | `native`      |
| `environment.services`            | `native`      |
| `environment.services.ports`      | `unsupported` |
| `deployment.environment`          | `native`      |
| `deployment.environment.action`   | `native`      |
| `deployment.environment.tier`     | `native`      |
| `artifact.retention`              | `native`      |
| `artifact.access`                 | `native`      |
| `cache`                           | `native`      |
| `cache.policy`                    | `native`      |
| `cache.fallbackKeys`              | `native`      |
| `concurrency.group`               | `native`      |
| `concurrency.cancelInProgress`    | `unsupported` |
| `reusable.pipeline`               | `lowered`     |
| `reusable.pipeline.inputs`        | `native`      |
| `reusable.pipeline.outputs`       | `native`      |
| `reusable.component`              | `native`      |
| `reusable.component.versioning`   | `native`      |
| `reusable.childPipeline`          | `native`      |
| `reusable.downstream`             | `native`      |
| `deployment.release`              | `native`      |
| `deployment.pages`                | `native`      |
| `import.gitlab`                   | `native`      |
| `import.include`                  | `native`      |
| `scheduling.delay`                | `native`      |
| `execution.background`            | `emulated`    |
