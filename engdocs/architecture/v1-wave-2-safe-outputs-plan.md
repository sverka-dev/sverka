# v1 Wave 2 Plan — Safe-outputs

**Spec:** 25-safe-outputs
**Bead:** sv-wthn.2.4
**Packages:** `@sverka/workflow` (model), `@sverka/compiler` (github/gitlab lowering), `@sverka/runtime` (engine enforcement)
**Date:** 2026-08-31
**Base branch:** `v1-w2-mcp-ai` (stacks on Wave 1)

## Scope

Add `StepPermissions` (`{ write: WriteDeclaration[] }`) to `StepDefinition`.
Steps are read-only by default. Synthesis validates declarations. GHA
target scopes job `permissions:` from write kinds. GitLab target injects
only write-kind variables. Native engine restricts secret injection for
write-less steps.

## Files

| File | Action |
|---|---|
| `packages/workflow/src/cdk/model.ts` | **Edit** — add `WriteDeclaration`, `StepPermissions` interfaces. |
| `packages/workflow/src/cdk/constructs.ts` | **Edit** — add `permissions?: StepPermissions` to `StepProps` + `Step`; copy in constructor. |
| `packages/workflow/src/cdk/index.ts` | **Edit** — export `WriteDeclaration`, `StepPermissions`. |
| `packages/workflow/src/core/graph.ts` | **Edit** — add `permissions?: StepPermissions` to `StepDefinition`; re-export types. |
| `packages/workflow/src/core/synthesize.ts` | **Edit** — `collectStepOptionalFields` includes `permissions`. |
| `packages/workflow/src/core/validate.ts` | **Edit** — validate `WriteDeclaration` non-empty `kind`/`target` (`INVALID_WRITE_DECLARATION`). |
| `packages/workflow/src/core/errors.ts` | **Edit** — add `INVALID_WRITE_DECLARATION` to `SynthesisErrorCode`. |
| `packages/compiler/src/github/lower.ts` | **Edit** — `resolveJobPermissions` extended: map write kinds to GHA permissions; read-only default `permissions: {}`. |
| `packages/compiler/src/github/capabilities.ts` | **Edit** — add `step.permissions: native`. |
| `packages/compiler/src/gitlab/lower.ts` | **Edit** — inject write-kind variables for steps with `permissions.write`. |
| `packages/compiler/src/gitlab/capabilities.ts` | **Edit** — add `step.permissions: native`. |
| `packages/runtime/src/engine-native/step-executor.ts` | **Edit** — restrict secret injection for steps without `permissions.write`. |
| `packages/workflow/src/cdk/__tests__/*.test.ts` | **Edit** — model/synthesize tests (items 1–4). |
| `packages/compiler/src/github/__tests__/safe-outputs.test.ts` | **New** — GHA lowering tests (items 5–8). |
| `packages/compiler/src/gitlab/__tests__/safe-outputs.test.ts` | **New** — GitLab lowering tests (item 9). |
| `packages/runtime/src/engine-native/__tests__/safe-outputs.test.ts` | **New** — engine enforcement tests (items 10–11). |

## TDD steps

1. Add `WriteDeclaration` + `StepPermissions` to cdk/model.ts + export.
   Write model test item 12 (export assertion).
2. Add `permissions?` to `StepProps`/`Step`/`StepDefinition`; wire
   `synthesize` propagation. Write items 1, 4 (synthesize propagation,
   read-only default).
3. Add `INVALID_WRITE_DECLARATION` to `SynthesisErrorCode` + validation in
   `validate.ts`. Write items 2–3 (empty kind/target rejected).
4. Write GHA tests items 5–6 (write → scoped permissions, no write →
   `permissions: {}`). Implement `WRITE_KIND_TO_GHA_PERMISSION` map +
   extend `resolveJobPermissions`.
5. Write item 7 (unknown kind → `contents: read` + warn diagnostic).
6. Write item 8 (deployPages precedence over permissions.write).
7. Write GitLab test item 9 (write-kind variables injected). Implement
   GitLab lowering.
8. Write engine tests items 10–11 (secret restriction for write-less
   steps). Implement in `step-executor.ts`.
9. Add `step.permissions: native` to github/gitlab capability manifests.
10. Run gates: `bun run test`, `bun run typecheck`, `bun run lint`,
    `bun run build`. All green.

## Commit hygiene

Stage ONLY `packages/workflow/src/**` (model, constructs, graph, synthesize,
validate, errors, tests) + `packages/compiler/src/{github,gitlab}/**` +
`packages/runtime/src/engine-native/step-executor.ts` + tests +
`specs/25-safe-outputs/spec.md` + this plan + `bun.lock` (if deps change —
none expected). EXCLUDE city.toml, agents/, .devin/, .gc/, .beads/,
formulas/, engdocs/adr/.
