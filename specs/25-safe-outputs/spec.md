# Spec 25 — Safe-outputs

**Status:** Active
**Source:** specs/architecture-spec.md §14 (Runtime/Step), §17 (plugins), §19 (Target contract)
**Package:** `@sverka/workflow` (model: `StepPermissions`), `@sverka/compiler` (github/gitlab lowering), `@sverka/runtime` (engine: enforce read-only default)
**Bead:** sv-wthn.2.4
**Related:** Spec 05 (synthesis), Spec 08 (github target), Spec 09 (gitlab target), Spec 10 (engine-native)

## Overview

Step-level write permissions. Steps are **read-only by default** — they may
read inputs, references, and the source workspace, but must not mutate
external state (create PRs, post comments, deploy, push). A step that needs
to write declares its writes explicitly via `permissions: { write:
WriteDeclaration[] }`. Synthesis validates that declared writes are
well-formed; the native engine enforces the read-only default at runtime
(no write operations unless declared); targets lower the declarations to
provider-specific permission scoping (GHA: job `permissions` block;
GitLab: separate stage with restricted variables).

Inspired by gh-aw safe-outputs: make the side-effect surface of each step
auditable and explicit.

## Goals

- `StepPermissions` added to `StepDefinition`: `{ write: WriteDeclaration[] }`.
- `WriteDeclaration` type: `{ kind, target, description? }` — declares what
  the step writes (e.g. `{ kind: "pull-request", target: "comment" }`).
- `StepProps` / `Step` gain `permissions?: StepPermissions` (CDK authoring).
- `synthesize()` propagates `step.permissions` onto `StepDefinition`.
- Validation at synthesis: write declarations must have non-empty `kind`
  and `target` (`INVALID_WRITE_DECLARATION`).
- Native engine: **read-only default enforced** — a step with no
  `permissions.write` runs with a restricted env (no write tokens injected);
  a step with declarations runs normally. The engine does NOT intercept
  individual syscalls (out of scope) — it controls credential/token
  injection, which is the practical write barrier.
- GHA target: `resolveJobPermissions` extended — a step with
  `permissions.write` gets a scoped `permissions:` block derived from write
  kinds (e.g. `pull-request` → `pull-requests: write`); steps without
  writes get `permissions: {}` (read-only) at the job level.
- GitLab target: steps with writes are lowered into a separate stage with
  restricted CI variables (only write tokens for declared kinds are
  injected).
- `step.permissions` capability declared in target manifests
  (`native` for GHA/GitLab, `native` for engine).

## Non-goals

- Syscall-level sandboxing (seccomp, filesystem read-only mounts) — out of
  scope; the enforcement is at credential-injection level. Container-level
  sandboxing is a follow-up.
- Write declaration schema validation per `kind` (e.g. validating that a
  `pull-request` write has a specific `target` value) — the `kind`/`target`
  are free-form strings validated only for non-emptiness. A registry of
  known write kinds is a follow-up.
- Runtime interception of write attempts (the engine doesn't detect "this
  step tried to push but didn't declare it") — that requires syscall
  sandboxing, explicitly out of scope.
- Pipeline-level permissions (already exist as `PermissionLevel` for GHA
  token scopes) — this spec adds **step-level write declarations**, a
  distinct concept. No conflict.

## Interfaces

### Model (`@sverka/workflow` cdk/model.ts)

```ts
export interface WriteDeclaration {
  readonly kind: string;        // e.g. "pull-request", "comment", "deploy", "push"
  readonly target: string;      // e.g. "comment", "production", "main"
  readonly description?: string;
}

export interface StepPermissions {
  readonly write: readonly WriteDeclaration[];
}
```

`StepProps` and `Step` gain `readonly permissions?: StepPermissions;`.
`StepDefinition` gains `readonly permissions?: StepPermissions;`.

### Engine (`@sverka/runtime` engine-native)

No new interface. The engine reads `step.permissions` to decide credential
injection: steps without `permissions.write` receive no write-capable
secrets/tokens. This is enforced in `step-executor.ts` where secrets are
resolved — a step with no writes gets an empty (or read-only) secret set.

### GHA target (`@sverka/compiler` github)

`resolveJobPermissions(step)` extended:
- If `step.permissions?.write` is non-empty: derive a `permissions:` block
  from write kinds via a `WRITE_KIND_TO_GHA_PERMISSION` map
  (`pull-request` → `pull-requests: write`, `deploy` → `deployments: write`,
  `push` → `contents: write`, `comment` → `issues: write`,
  `id-token` → `id-token: write`). Unknown kinds → `contents: read` (safe
  default) + a `warn` diagnostic.
- If `step.permissions` is absent or `write` is empty: `permissions: {}`
  (explicit read-only job) — **unless** the step already has higher
  permissions from `deployPages`/`identity` (existing logic takes
  precedence).

### GitLab target (`@sverka/compiler` gitlab)

Steps with `permissions.write` are annotated with a `variables` block
containing only the CI variables needed for the declared write kinds. Steps
without writes get no write-capable variables. No structural change to
stages (GitLab doesn't have per-job token scoping like GHA — the variable
injection is the practical enforcement).

## Data models

### Write kind → GHA permission map

```ts
const WRITE_KIND_TO_GHA_PERMISSION: Readonly<Record<string, string>> = {
  "pull-request": "pull-requests: write",
  "comment": "issues: write",
  "deploy": "deployments: write",
  "push": "contents: write",
  "id-token": "id-token: write",
  "pages": "pages: write",
};
```

Unknown kinds default to `contents: read` + a `warn` diagnostic
(`unknown-write-kind`).

## Error handling

- `INVALID_WRITE_DECLARATION` (`SynthesisError`): a `WriteDeclaration` with
  empty `kind` or `target`. Raised at synthesis validation.
- Unknown write kind: **non-fatal** — `warn` diagnostic from target
  `analyze()`, job gets `contents: read` (safe default).
- No new error class. Synthesis errors use existing `SynthesisError`;
  target diagnostics use existing `TargetDiagnostic`.

## Test plan

1. `StepPermissions` with one write declaration synthesizes onto
   `StepDefinition.permissions` (verify via synthesize + graph inspect).
2. `WriteDeclaration` with empty `kind` → `SynthesisError(
   INVALID_WRITE_DECLARATION)`.
3. `WriteDeclaration` with empty `target` → `SynthesisError(
   INVALID_WRITE_DECLARATION)`.
4. Step with no `permissions` → `StepDefinition.permissions` is `undefined`
   (read-only default).
5. GHA: step with `permissions.write: [{ kind: "pull-request", target:
   "comment" }]` → job `permissions: { "pull-requests": "write" }`.
6. GHA: step with no writes → job `permissions: {}` (read-only).
7. GHA: step with unknown write kind `foo` → job `permissions: { "contents":
   "read" }` + `warn` diagnostic (`unknown-write-kind`).
8. GHA: step with `deployPages` operation AND `permissions.write` → existing
   `deployPages` permissions take precedence (pages:write + id-token:write).
9. GitLab: step with writes → job `variables` includes only write-kind
   variables; step without writes → no write variables.
10. Engine: step with no `permissions.write` → secrets resolved for that
    step exclude write-capable tokens (verify via mock secret provider).
11. Engine: step with `permissions.write` → secrets resolved normally.
12. `StepPermissions`, `WriteDeclaration` exported from `@sverka/workflow`.
13. `step.permissions` capability in github/gitlab manifests: `native`.
