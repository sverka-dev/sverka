# Feature: Environment variables

**ID:** F-20
**Category:** environment
**Milestone:** M0 (already in v0)
**Status:** Proposed
**Parent epic:** sv-4wh9

## Summary

Environment variables pass configuration to shell commands. Both providers
support env vars at workflow, job, and step levels. Sverka models env as a
`Record<string, string>` on `Runtime`, lowered to job-level env/variables.
The native engine injects env into the spawned process.

## Provider matrix

| Aspect | GitHub Actions | GitLab CI | Sverka (proposed) |
|--------|---------------|-----------|-------------------|
| Construct | `env` (workflow/job/step) | `variables` (global/job) | `Runtime.env` |
| Semantics | key-value pairs injected into step env | key-value pairs injected into job env | key-value pairs on step runtime |
| Value type | string map | string map | `Record<string, string>` |
| Limitations | values can use `${{ }}` expressions | values can use `$VAR` references | literal strings (expressions via F-35) |
| Provider gap | — | — | env expressions not lowered (see F-35) |

## GitHub Actions

```yaml
env:
  CI: true
jobs:
  build:
    env:
      NODE_ENV: production
    steps:
      - run: echo $NODE_ENV
```

`env` can be set at workflow, job, or step level. Values support `${{ }}`
expression interpolation.

## GitLab CI

```yaml
variables:
  CI: "true"
build:
  variables:
    NODE_ENV: production
  script: [echo $NODE_ENV]
```

`variables` can be global or per-job. Values are injected as env vars.
References use `$VAR` or `${VAR}` syntax.

## Sverka proposal

### Portable model

`Runtime.env?: Readonly<Record<string, string>>` (`cdk/model.ts:104`). Set
on a `Step` via `StepProps.runtime.env`. Values are literal strings —
expression interpolation is handled by F-35 (context refs in `sh` templates).

Pipeline-level inputs with non-secret defaults are also lowered to env vars
(see F-04 / F-21).

### Authoring API

```ts
// SDK — sh builder
sh`echo $NODE_ENV`.runtime({ env: { NODE_ENV: "production" } }).build(pipeline, "build");

// With context ref interpolation (resolved at runtime)
import { env } from "@sverka/sdk";
sh`echo ${env.CI_TRACE}`.build(pipeline, "trace"); // env.CI_TRACE is a ContextRef

// Construct
new ShellStep(pipeline, "build", {
  command: "echo build",
  runtime: { env: { NODE_ENV: "production" } },
});

// Decorator
@step({ runtime: { env: { NODE_ENV: "production" } } })
```

### Lowering

- **GitHub target:** `runtime.env` → job `env:` block
  (`github/lower.ts:292-303`). Pipeline inputs with defaults → workflow `env:`
  (`github/lower.ts:432-442`).
- **GitLab target:** `runtime.env` → job `variables:` block
  (`gitlab/lower.ts:409-435`). Pipeline inputs with non-secret defaults →
  global `variables:` (`gitlab/lower.ts:576-587`).
- **Native engine:** `StepExecutor.buildShellEnv`
  (`engine-native/step-executor.ts:193-224`) injects `runtime.env` into the
  process env. `SVERKA_OUTPUT_DIR` and `SVERKA_STEP_ID` are reserved and
  overwritten last to prevent tampering.

### Capability manifest

```ts
"environment.variables": "native",
```

### Portability & divergence

Both providers support env vars natively. Sverka's `Runtime.env` is per-step
(there is no workflow-level env in the portable model — pipeline inputs fill
that role). Context refs (`env.X`) in `sh` templates are resolved by the
native engine but NOT lowered to `${{ }}` or `$VAR` in compiled output — see
F-35 for the expression lowering gap.

## Non-goals

- Workflow-level env vars (use pipeline inputs).
- Env var interpolation in compiled targets (F-35 gap).

## Dependencies

- **Depends on:** F-09 (shell ops), F-35 (expressions — context refs).
- **Blocks:** none.

## Open questions

- Should pipeline-level env vars be separate from pipeline inputs?
- Should the native engine allow overriding `SVERKA_*` reserved vars?

## References

- GitHub: https://docs.github.com/en/actions/using-workflows/workflow-syntax-for-github-actions#env
- GitLab: https://docs.gitlab.com/ee/ci/yaml/#variables
- Architecture spec: §14.1, §12.3
- Source: `packages/cdk/src/model.ts:101-107`, `packages/github/src/lower.ts:292-303`, `packages/gitlab/src/lower.ts:409-435`, `packages/engine-native/src/step-executor.ts:193-224`
