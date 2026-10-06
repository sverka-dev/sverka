# GitHub Actions compiler

The `github` target compiles a Sverka **Definition Graph** (from
`@sverka/workflow`) into a real GitHub Actions workflow — one job per step,
`needs:` edges from declared dependencies. This is what the Sverka repo
itself runs: `.github/workflows/sverka.yml` is generated output.

## CLI usage

```sh
# Print YAML to stdout
sverka compile --target github

# Write workflow files into a directory
sverka compile --target github --output-dir out/

# Pin every `uses:` ref to a commit SHA (bundled action registry)
sverka compile --target github --pin
```

## Generated workflow shape

Each `ShellStep` becomes a job. Checkout is always emitted first; toolchain
setup and `bun install` follow when configured — the CLI auto-detects the
project toolchain and injects them, while direct `compileGithub` calls emit
only what `config.setup` provides:

```yaml
name: ci
on:
  push: {}
  workflow_dispatch: null
permissions: {}
jobs:
  build:
    runs-on: ubuntu-latest
    permissions:
      actions: read
      contents: read
    steps:
      - name: Checkout
        uses: actions/checkout@<sha> # v4
        with:
          persist-credentials: false
      - name: Setup Bun
        uses: oven-sh/setup-bun@<sha> # v2
      - name: Install dependencies
        run: bun install --frozen-lockfile --ignore-scripts
      - run: bun run build
  typecheck:
    needs: build
    steps: [...]
```

Triggers come from the pipeline's `Entry` definitions (`push` → `on.push`,
`manual` → `workflow_dispatch`, `schedule` → cron). Declared step secrets map
to `${{ secrets.<NAME> }}` in the job's `env`. Pipeline inputs marked
`secret: true` are not emitted as `workflow_dispatch` text fields — they
resolve via `${{ secrets.<NAME> }}` (and via `secrets:` on `workflow_call`).

Set `bootstrap` on a `Pipeline` to control injection into shell and action
jobs (reusable-workflow call jobs are emitted as `uses:` jobs and receive no
bootstrap steps): `"toolchain"` (default) emits checkout + detected
toolchain/dependency setup, `"checkout"` emits checkout only, and `"none"`
emits neither. Note that `gh api` calls using `{owner}/{repo}` placeholders
need repository context — keep `"checkout"`, set `GH_REPO`, or use an
explicit `repos/<owner>/<repo>` path; `"none"` suits only work that never
touches the local repo (webhooks, external APIs).

## Public API

```ts
import { GithubTarget, compileGithub } from "@sverka/compiler";
import type { GithubTargetConfig } from "@sverka/compiler";

const result = compileGithub(graph, config);
// result.artifacts    — GeneratedArtifact[] (workflow YAML files)
// result.diagnostics  — capability + pinning findings
```

`GithubTarget` implements the `Target` contract: `analyze` (capability +
pinning diagnostics), `lower` (graph → `GithubTargetGraph`, or
`GithubTargetGraph[]` when the graph holds multiple pipelines — one
workflow per pipeline that has entries or is called by a call step),
`emit` (graph → YAML artifacts), `compile`
(all three).

```ts
export interface GithubTargetConfig {
  /** Action SHA pinning policy; defaults to `{ mode: "off" }`. */
  readonly pinning?: PinningConfig;
  /** Steps injected into every job after Checkout — toolchain setup. */
  readonly setup?: readonly GithubStep[];
  /** Extra `with:` inputs merged into the Checkout step of every job. */
  readonly checkoutWith?: Record<string, unknown>;
}
```

With `pinning.mode: "strict"`, every `uses:` ref is resolved to a commit SHA
via the bundled registry; refs with no registry entry are emitted as
diagnostics (`error` in strict mode, `warning` otherwise).

## Support levels

| Level         | Meaning                                                        |
| ------------- | -------------------------------------------------------------- |
| `native`      | Target has a direct 1:1 mapping for this feature               |
| `lowered`     | Feature is translated to an equivalent target construct        |
| `emulated`    | Feature is approximated via a combination of target constructs |
| `partial`     | Only some aspects of the feature are supported                 |
| `connector`   | Feature requires a plugin connector to provide                 |
| `unsupported` | Target cannot express this feature; produces a diagnostic      |

## GitHub capability manifest

| Capability                           | Support       |
| ------------------------------------ | ------------- |
| `trigger.push`                       | `native`      |
| `trigger.changeRequest`              | `native`      |
| `trigger.manual`                     | `native`      |
| `runtime.host`                       | `native`      |
| `runtime.container`                  | `native`      |
| `operation.shell`                    | `native`      |
| `operation.import`                   | `lowered`     |
| `output.scalar`                      | `lowered`     |
| `output.artifact`                    | `native`      |
| `graph.dependencies`                 | `native`      |
| `graph.matrix`                       | `native`      |
| `matrix.include`                     | `native`      |
| `matrix.exclude`                     | `native`      |
| `matrix.failFast`                    | `native`      |
| `matrix.maxParallel`                 | `native`      |
| `trigger.schedule`                   | `native`      |
| `step.beforeScript`                  | `native`      |
| `step.afterScript`                   | `native`      |
| `step.continueOnError`               | `native`      |
| `policy.retry`                       | `unsupported` |
| `execution.workdir`                  | `native`      |
| `execution.shell`                    | `native`      |
| `environment.variables`              | `native`      |
| `secrets.runtime`                    | `native`      |
| `secrets.pipeline-input`             | `native`      |
| `concurrency.interruptible`          | `partial`     |
| `environment.permissions`            | `native`      |
| `runner.selection`                   | `native`      |
| `runner.group`                       | `native`      |
| `secrets.oidc`                       | `native`      |
| `secrets.oidc.multiAudience`         | `unsupported` |
| `workflow.rules`                     | `partial`     |
| `workflow.rules.changes`             | `unsupported` |
| `workflow.rules.exists`              | `unsupported` |
| `workflow.defaults`                  | `native`      |
| `workflow.defaults.shell`            | `native`      |
| `workflow.defaults.workdir`          | `native`      |
| `workflow.defaults.env`              | `unsupported` |
| `workflow.defaults.beforeScript`     | `lowered`     |
| `workflow.defaults.afterScript`      | `lowered`     |
| `workflow.defaults.timeout`          | `unsupported` |
| `workflow.defaults.retry`            | `unsupported` |
| `workflow.defaults.interruptible`    | `unsupported` |
| `artifact.report`                    | `emulated`    |
| `artifact.report.junit`              | `emulated`    |
| `artifact.report.coverage`           | `emulated`    |
| `artifact.report.dotenv`             | `emulated`    |
| `artifact.report.sast`               | `emulated`    |
| `artifact.report.dast`               | `emulated`    |
| `artifact.report.dependencyScanning` | `emulated`    |
| `artifact.report.containerScanning`  | `emulated`    |
| `artifact.report.licenseScanning`    | `emulated`    |
| `artifact.report.performance`        | `emulated`    |
| `artifact.report.metrics`            | `emulated`    |
| `artifact.report.terraform`          | `emulated`    |
| `artifact.report.quality`            | `emulated`    |
| `artifact.report.sarif`              | `emulated`    |
| `workflow.inputs`                    | `native`      |
| `workflow.inputs.choice`             | `native`      |
| `workflow.inputs.array`              | `unsupported` |
| `workflow.inputs.pattern`            | `unsupported` |
| `environment.services`               | `native`      |
| `environment.services.ports`         | `native`      |
| `deployment.environment`             | `native`      |
| `deployment.environment.action`      | `unsupported` |
| `deployment.environment.tier`        | `unsupported` |
| `artifact.retention`                 | `native`      |
| `artifact.access`                    | `unsupported` |
| `cache`                              | `native`      |
| `cache.policy`                       | `emulated`    |
| `cache.fallbackKeys`                 | `native`      |
| `concurrency.group`                  | `native`      |
| `concurrency.cancelInProgress`       | `native`      |
| `reusable.pipeline`                  | `native`      |
| `reusable.pipeline.inputs`           | `native`      |
| `reusable.pipeline.outputs`          | `native`      |
| `reusable.component`                 | `native`      |
| `reusable.component.versioning`      | `native`      |
| `reusable.childPipeline`             | `unsupported` |
| `reusable.downstream`                | `emulated`    |
| `deployment.release`                 | `emulated`    |
| `deployment.pages`                   | `native`      |
| `import.github`                      | `native`      |
| `import.include`                     | `emulated`    |
| `scheduling.delay`                   | `emulated`    |
| `execution.background`               | `emulated`    |
