# GitHub Actions compiler

The `@sverka/compiler-github` package compiles a Plan to a GitHub Actions
workflow YAML string. Source: `packages/compiler-github/src/compile.ts`.

## Usage

```ts
import { compileGithubWorkflow } from "@sverka/compiler-github";
import type { Plan } from "@sverka/ir";

const yaml = compileGithubWorkflow(plan, {
  name: "Sverka",
  runner: "ubuntu-latest",
  sverkaVersion: "latest",
  nodeVersion: "24",
  on: {
    push: ["main"],
    pullRequest: [],
    workflowDispatch: true,
  },
  permissions: {
    contents: "read",
    securityEvents: "write",
  },
});
```

## Config

All fields optional. Defaults apply when omitted.

| Field            | Type                | Default          | Description                    |
|------------------|---------------------|------------------|--------------------------------|
| `name`           | `string`            | `"Sverka"`       | Workflow name                  |
| `on`             | `GithubTriggers`    | push + pull_request | Trigger events              |
| `runner`         | `string`            | `"ubuntu-latest"`| Runner image label             |
| `sverkaVersion`  | `string`            | `"latest"`       | Sverka version to install      |
| `nodeVersion`    | `string`            | `"24"`           | Node version for setup-node    |
| `permissions`    | `GithubPermissions` | `{ contents: "read" }` | Token permissions       |

### Triggers

| Field              | Type       | Description                          |
|--------------------|------------|--------------------------------------|
| `push`             | `string[]` | Branches to trigger on push          |
| `pullRequest`      | `string[]` | Branches for pull request (empty = all) |
| `workflowDispatch` | `boolean`  | Enable manual dispatch               |

### Permissions

| Field            | Type             | Description              |
|------------------|------------------|--------------------------|
| `contents`       | `"read" \| "write"` | Repository contents  |
| `actions`        | `"read" \| "write"` | Actions API          |
| `checks`         | `"read" \| "write"` | Checks API           |
| `securityEvents` | `"read" \| "write"` | Security events      |
| `idToken`        | `"write"`        | OIDC token (write only)  |

Permission keys are converted from camelCase to kebab-case in the YAML
output (e.g. `securityEvents` → `security-events`).

## Output

The generated workflow:

1. Checks out the repository.
2. Sets up Node.js and Bun.
3. Installs Sverka globally.
4. Runs `sverka execute`.
5. Uploads `.sverka/output/` as an artifact.

### Credential mapping

Credentials declared in the Plan are mapped to job-level `env:` entries
referencing GitHub secrets. Each credential's `envVar` becomes
`${{ secrets.<ENV_VAR> }}`.

### Example output

```yaml
name: Sverka
on:
  push:
    branches:
      - main
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
      - run: bun install -g sverka@latest
      - run: sverka execute
      - uses: actions/upload-artifact@v4
        if: always()
        with:
          name: sverka-output
          path: .sverka/output/
```
