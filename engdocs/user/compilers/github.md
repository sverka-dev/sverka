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
