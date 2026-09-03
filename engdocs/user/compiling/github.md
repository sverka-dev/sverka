# GitHub Actions compiler

> **Work in progress.** The compiler API is functional but the generated
> workflow is a thin wrapper (ADR-004) that installs the Sverka CLI and runs
> `sverka execute`. Native one-job-per-step lowering is planned but not yet
> shipped. Expect breaking changes to config types.

The `@sverka/compiler-github` package compiles a canonical **Plan** (from
`@sverka/ir`) into a GitHub Actions workflow YAML string. Source:
`packages/compiler-github/src/compile.ts`.

## Usage

```ts
import { compileGithubWorkflow } from "@sverka/compiler-github";
import type { GithubCompilerConfig } from "@sverka/compiler-github";
import { createSverka } from "@sverka/sdk";

const sverka = createSverka({ root: process.cwd() });
const plan = await sverka.toPlan();

const config: GithubCompilerConfig = {
  name: "Sverka",
  on: { push: ["main"], pullRequest: [], workflowDispatch: true },
  runner: "ubuntu-latest",
  sverkaVersion: "latest",
  nodeVersion: "24",
  permissions: { contents: "read" },
};

const yaml = compileGithubWorkflow(plan, config);
console.log(yaml);
```

## Public API

```ts
export function compileGithubWorkflow(
  plan: Plan,
  config?: GithubCompilerConfig,
): string;
```

- **`plan`** — a `Plan` from `@sverka/ir` (obtain via `createSverka().toPlan()`
  or build one directly).
- **`config`** — optional compiler configuration. All fields optional;
  sensible defaults apply.
- **Returns** — a GitHub Actions workflow YAML string. Pure and synchronous:
  no I/O, no side effects. The same plan + config always produces the same
  YAML.

## Configuration types

```ts
export interface GithubCompilerConfig {
  /** Workflow name. Defaults to "Sverka". */
  readonly name?: string;
  /** Trigger events. Defaults to push on main + pull_request. */
  readonly on?: GithubTriggers;
  /** Runner image label. Defaults to "ubuntu-latest". */
  readonly runner?: string;
  /** Sverka version to install. Defaults to "latest". */
  readonly sverkaVersion?: string;
  /** Node version for actions/setup-node. Defaults to "24". */
  readonly nodeVersion?: string;
  /** Permissions for the GITHUB_TOKEN. Defaults to { contents: "read" }. */
  readonly permissions?: GithubPermissions;
}

export interface GithubTriggers {
  readonly push?: readonly string[];
  readonly pullRequest?: readonly string[];
  readonly workflowDispatch?: boolean;
}

export interface GithubPermissions {
  readonly contents?: "read" | "write";
  readonly actions?: "read" | "write";
  readonly checks?: "read" | "write";
  readonly securityEvents?: "read" | "write";
  readonly idToken?: "write";
}
```

## Generated workflow shape (ADR-004 thin wrapper)

The compiler produces a **single job** that installs the Sverka CLI and runs
`sverka execute`. The plan's operations are not lowered to individual GitHub
Actions jobs — execution is delegated to Sverka at runtime.

```yaml
name: Sverka
on:
  push:
    branches: [main]
  pull_request: null
permissions:
  contents: read
jobs:
  sverka:
    runs-on: ubuntu-latest
    steps:
      - uses: actions/checkout@v4
      - uses: actions/setup-node@v4
        with:
          node-version: "24"
      - uses: oven-sh/setup-bun@v2
        with:
          version: latest
      - run: bun install -g @sverka/cli@latest
      - run: sverka execute
      - uses: actions/upload-artifact@v4
        if: always()
        with:
          name: sverka-output
          path: .sverka/output/
```

### Credentials

If any operation in the plan declares credentials, the compiler collects the
unique `envVar` names and emits a job-level `env:` block mapping each to
`${{ secrets.<ENV_VAR> }}`:

```yaml
jobs:
  sverka:
    runs-on: ubuntu-latest
    env:
      NPM_TOKEN: ${{ secrets.NPM_TOKEN }}
      SONAR_TOKEN: ${{ secrets.SONAR_TOKEN }}
    steps: ...
```

### Permissions

The `permissions` field maps camelCase keys to the kebab-case keys GitHub
Actions expects (e.g. `securityEvents` → `security-events`). Defaults to
`{ contents: "read" }`.

## CLI usage

```sh
# Print YAML to stdout
sverka compile --target github

# Write to a file
sverka compile --target github --output .github/workflows/sverka.yml
```

> **Note:** `sverka synth --target github` is a **stub** and returns
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

## GitHub capability manifest

> **Note:** This manifest is from the `@sverka/github` native target package (Wave H). The shipped `@sverka/compiler-github` thin-wrapper compiler does not use capability analysis — it delegates everything to `sverka execute`. This manifest documents the **planned** native lowering support matrix.

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
| `matrix.include` | `native` |
| `matrix.exclude` | `native` |
| `matrix.failFast` | `native` |
| `matrix.maxParallel` | `native` |
| `trigger.schedule` | `native` |
| `step.beforeScript` | `native` |
| `step.afterScript` | `native` |
| `step.continueOnError` | `native` |
| `policy.retry` | `unsupported` |
| `execution.workdir` | `native` |
| `execution.shell` | `native` |
| `environment.variables` | `native` |
| `secrets.runtime` | `native` |
| `secrets.pipeline-input` | `native` |
| `concurrency.interruptible` | `partial` |
| `environment.permissions` | `native` |
| `runner.selection` | `native` |
| `runner.group` | `native` |
| `secrets.oidc` | `native` |
| `secrets.oidc.multiAudience` | `unsupported` |
| `workflow.rules` | `partial` |
| `workflow.rules.changes` | `unsupported` |
| `workflow.rules.exists` | `unsupported` |
| `workflow.defaults` | `native` |
| `workflow.defaults.shell` | `native` |
| `workflow.defaults.workdir` | `native` |
| `workflow.defaults.env` | `unsupported` |
| `workflow.defaults.beforeScript` | `lowered` |
| `workflow.defaults.afterScript` | `lowered` |
| `workflow.defaults.timeout` | `unsupported` |
| `workflow.defaults.retry` | `unsupported` |
| `workflow.defaults.interruptible` | `unsupported` |
| `artifact.report` | `emulated` |
| `artifact.report.junit` | `emulated` |
| `artifact.report.coverage` | `emulated` |
| `artifact.report.dotenv` | `emulated` |
| `artifact.report.sast` | `emulated` |
| `artifact.report.dast` | `emulated` |
| `artifact.report.dependencyScanning` | `emulated` |
| `artifact.report.containerScanning` | `emulated` |
| `artifact.report.licenseScanning` | `emulated` |
| `artifact.report.performance` | `emulated` |
| `artifact.report.metrics` | `emulated` |
| `artifact.report.terraform` | `emulated` |
| `artifact.report.quality` | `emulated` |
| `artifact.report.sarif` | `emulated` |
| `workflow.inputs` | `native` |
| `workflow.inputs.choice` | `native` |
| `workflow.inputs.array` | `unsupported` |
| `workflow.inputs.pattern` | `unsupported` |
| `environment.services` | `native` |
| `environment.services.ports` | `native` |
| `deployment.environment` | `native` |
| `deployment.environment.action` | `unsupported` |
| `deployment.environment.tier` | `unsupported` |
| `artifact.retention` | `native` |
| `artifact.access` | `unsupported` |
| `cache` | `native` |
| `cache.policy` | `emulated` |
| `cache.fallbackKeys` | `native` |
| `concurrency.group` | `native` |
| `concurrency.cancelInProgress` | `native` |
| `reusable.pipeline` | `native` |
| `reusable.pipeline.inputs` | `native` |
| `reusable.pipeline.outputs` | `native` |
| `reusable.component` | `native` |
| `reusable.component.versioning` | `native` |
| `reusable.childPipeline` | `unsupported` |
| `reusable.downstream` | `emulated` |
| `deployment.release` | `emulated` |
| `deployment.pages` | `native` |
| `import.github` | `native` |
| `import.include` | `emulated` |
| `scheduling.delay` | `emulated` |
| `execution.background` | `emulated` |
