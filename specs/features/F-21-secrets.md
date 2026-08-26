# Feature: Secrets

**ID:** F-21
**Category:** secrets
**Milestone:** M0 (already in v0)
**Status:** Proposed
**Parent epic:** sv-4wh9

## Summary

Secrets are sensitive values injected into step environments without being
exposed in logs or compiled output. GitHub uses the `secrets` context; GitLab
uses CI/CD variables marked as masked. Sverka models secrets as a string
array on `Runtime` (names only) and as a `secret` flag on pipeline `Input`.

## Provider matrix

| Aspect | GitHub Actions | GitLab CI | Sverka (proposed) |
|--------|---------------|-----------|-------------------|
| Construct | `secrets` context + `${{ secrets.X }}` | CI/CD variables (masked) | `Runtime.secrets: string[]` + `Input.secret` |
| Semantics | secret value referenced in env via expression | variable injected at runtime, masked in logs | secret name list → env injection |
| Value type | string (context ref) | string (variable) | `readonly string[]` (names) |
| Limitations | must be defined in repo/org settings | must be defined in project settings | names only — values resolved at runtime |
| Provider gap | — | — | — |

## GitHub Actions

```yaml
jobs:
  deploy:
    env:
      NPM_TOKEN: ${{ secrets.NPM_TOKEN }}
    steps: [{ run: npm publish }]
```

Secrets are defined in repo/org settings and referenced via `${{ secrets.X }}`.
They are masked in logs automatically.

## GitLab CI

```yaml
deploy:
  variables:
    NPM_TOKEN: $NPM_TOKEN
  script: [npm publish]
```

CI/CD variables defined in project settings. Variables marked as "masked" are
hidden in logs. Referenced via `$VAR` or `${VAR}`.

## Sverka proposal

### Portable model

Two mechanisms:

1. **Step-level:** `Runtime.secrets?: readonly string[]` (`cdk/model.ts:105`)
   — a list of secret names. The native engine resolves these via
   `SecretProvider` and injects them as env vars. Targets lower them to
   provider secret references.
2. **Pipeline-level:** `Input.secret?: boolean` (`cdk/model.ts:94`) — a
   pipeline input flagged as secret. Lowered to `${{ secrets.X }}` (GitHub)
   or omitted from variables (GitLab — must be set in CI/CD settings).

### Authoring API

```ts
// SDK — step-level secrets
sh`npm publish`.runtime({ secrets: ["NPM_TOKEN"] }).build(pipeline, "deploy");

// With context ref interpolation
import { secrets } from "@sverka/sdk";
sh`echo ${secrets.NPM_TOKEN}`.build(pipeline, "deploy");

// Construct — pipeline-level secret input
new Pipeline(project, "ci", {
  inputs: { npmToken: { type: "string", secret: true, required: true } },
});

// Construct — step-level
new ShellStep(pipeline, "deploy", {
  command: "npm publish",
  runtime: { secrets: ["NPM_TOKEN"] },
});

// Decorator
@step({ runtime: { secrets: ["NPM_TOKEN"] } })
```

### Lowering

- **GitHub target:** `runtime.secrets` → `${{ secrets.X }}` in job env
  (`github/lower.ts:297-301`). Pipeline secret inputs → `${{ secrets.X }}` in
  workflow env (`github/lower.ts:432-442`).
- **GitLab target:** `runtime.secrets` → `$X` in job variables
  (`gitlab/lower.ts:428-432`). **Note:** these self-referential assignments
  (e.g., `NPM_TOKEN: $NPM_TOKEN`) are redundant because GitLab CI/CD
  variables are already available as environment variables. A future revision
  should omit runtime secret names from the generated variables block.
  Pipeline secret inputs → **omitted** from
  variables (`gitlab/lower.ts:579`) — must be defined in GitLab CI/CD
  settings. This is correct: GitLab secrets are project settings, not
  pipeline config.
- **Native engine:** `StepExecutor.buildShellEnv`
  (`engine-native/step-executor.ts:200-208`) resolves secret names via the
  `secrets` map (from `SecretProvider`) and injects them as env vars.

### Capability manifest

```ts
"secrets.runtime": "native",
"secrets.pipeline-input": "native",
```

### Portability & divergence

GitHub secrets are referenced via `${{ secrets.X }}` expressions in the
workflow file. GitLab secrets are CI/CD variables set in project settings —
they are NOT in the `.gitlab-ci.yml` file. Sverka handles this correctly:
GitHub lowering emits the expression; GitLab lowering omits the variable
(the user must configure it in GitLab settings).

## Non-goals

- OIDC / identity federation (F-38, M1).
- Secret stores / vaults (GitLab `secrets:vault`).
- Secret rotation or scoped access.

## Dependencies

- **Depends on:** F-09 (shell ops), F-20 (env vars — secrets are injected as env).
- **Blocks:** none.

## Open questions

- Should the native engine warn if a secret name is not resolvable at runtime?
- Should `Input.secret` support a default value (currently it cannot — secrets
  have no defaults)?

## References

- GitHub: https://docs.github.com/en/actions/security-guides/encrypted-secrets
- GitLab: https://docs.gitlab.com/ee/ci/variables/#protect-a-cicd-variable
- Architecture spec: §14.1, §12.1, §12.3
- Source: `packages/cdk/src/model.ts:94,105`, `packages/github/src/lower.ts:297-301`, `packages/gitlab/src/lower.ts:428-432`, `packages/engine-native/src/step-executor.ts:200-208`
