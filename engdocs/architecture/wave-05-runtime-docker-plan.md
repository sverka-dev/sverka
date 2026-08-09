# Wave 5 — Docker Executor Implementation Plan

**Architect:** architect-1
**Spec:** `specs/04-runtime-docker/spec.md`
**Package:** `@sverka/runtime-docker` → `packages/runtime-docker`
**Depends on:** Wave 3 (`@sverka/runtime`), Wave 2 (`@sverka/ir`)

This plan is the contract the builder implements against. The spec is the
source of truth; this plan adds sequencing, file layout, conventions, and
edge-case guidance. Where the two disagree, the spec wins — except where the
spec conflicts with the **built** runtime contract, in which case the built
contract wins (see §1 amendments).

## 1. Spec amendments already applied (architect)

Spec 04 was written before `@sverka/runtime` was built. Mismatches with the
built contract have been corrected in the spec:

1. **`workspace` / `artifactDir` removed from `DockerExecutorConfig`.** The
   scheduler passes both per-execution via `ExecuteRequest`
   (`request.workspace`, `request.artifactDir`). The executor must use the
   request fields, not config fields. `canExecute` (which receives only the
   operation) never needed them.
2. **Env/credentials use `request.*`, not `operation.*` as value sources.**
   `operation.credentials` is `CredentialDeclaration[]` (name/envVar/required
   — declarations). Resolved secret **values** arrive via
   `request.credentials: Record<string,string>` (keyed by envVar).
   `request.env` carries the operation env vars. Error rule #4 and test plan
   item 5 updated accordingly.
3. **Test commands corrected:** `bun test` → `bun run test` (vitest via nx,
   not Bun's built-in runner — see drill-finding-2026-08-09-bun-test-in).

## 2. Scope

Implement the Docker executor for `@sverka/runtime-docker`:

- `DockerExecutor` class implementing `Executor` from `@sverka/runtime`.
- `DockerExecutorConfig` (runAs, cacheDir, dockerPath?, dockerHost?,
  maxLogBytes?).
- `verifyImageDigest` function (image digest verification via `docker
  inspect`/`docker pull`).
- `CacheManager` interface + `DockerCacheManager` (filesystem cache
  prepare/collect).
- Error hierarchy: `DockerExecutorError` → `ImageDigestError`,
  `ContainerPolicyError`.
- Internal `docker-cli.ts` — mockable seam for unit tests.
- Public re-exports from `src/index.ts`.

**Dependency:** `@sverka/runtime` (Executor, ExecuteRequest, ExecuteResult) +
`@sverka/ir` (PlanOperation). Both `workspace:*`.

**Out of scope (do NOT implement in this wave):**
- **Retry.** The scheduler owns retry (`maxAttempts`/`retryOn`/`backoffSeconds`,
  Wave 3). The executor executes **once** and returns a result. Spec goal 6
  ("support retry and timeout policies") is satisfied by returning `status:
  "failure"` results that the scheduler can retry.
- **Docker daemon lifecycle.** Assumed available (spec non-goal).
- **Image building/publishing.** Spec non-goal.
- **Podman.** Handled by `runtime-podman`.

## 3. Scaffolding status (already done by architect)

- `packages/runtime-docker/package.json` — fixed: dist paths are
  `.mjs`/`.d.mts` (matches `core`/`ir`/`runtime`/`runtime-host`);
  `@sverka/runtime` and `@sverka/ir` added to `dependencies` as `workspace:*`.
- `packages/runtime-docker/project.json` — already has `--passWithNoTests` on
  the test target.
- `tsconfig.json`, `tsdown.config.ts` — already match `runtime-host`; no
  changes.
- `src/index.ts` — placeholder; builder fills exports.
- `bun install` run; lockfile updated.

## 4. File layout

Mirror `runtime-host` (one module per concern, `__tests__/` co-located):

```
packages/runtime-docker/src/
  index.ts              # public re-exports (matches spec §Interfaces)
  errors.ts             # DockerExecutorError, ImageDigestError, ContainerPolicyError
  config.ts             # DockerExecutorConfig (type-only)
  docker-executor.ts    # DockerExecutor class
  image.ts              # verifyImageDigest
  cache.ts              # CacheManager interface + DockerCacheManager
  internal/
    docker-cli.ts       # runDocker wrapper — mockable seam for unit tests
  __tests__/
    errors.test.ts
    docker-executor.test.ts  # canExecute, buildArgs, buildEnv, policy, timeout, logs
    image.test.ts            # verifyImageDigest (mocked cli)
    cache.test.ts            # DockerCacheManager (filesystem ops)
    public-api.test.ts
    integration.test.ts      # describe.skipIf(!process.env.SVERKA_DOCKER)
    helpers/
      fixtures.ts            # op factory + makeRequest helper
```

`internal/docker-cli.ts` is NOT exported (not in spec §Interfaces). It is the
single mockable seam: unit tests `vi.mock("../internal/docker-cli.js")`.

## 5. Testability design

The executor separates **pure logic** from **side effects**:

- `buildDockerArgs(request): string[]` — constructs the `docker run` arg
  array. Pure. Tested directly (policy flags, network mapping, mounts).
- `buildEnv(request): Record<string,string>` — builds the container env from
  `operation.credentials` (declarations) + `request.credentials` (values) +
  `request.env`. Pure. Tested directly (secrets allowlist, undeclared
  detection).
- Validation (timeout, digest presence, socket deny, secret detection) —
  pure, throws before any spawn.
- `internal/docker-cli.ts` exports `runDocker(args, opts): Promise<DockerCommandResult>`
  — the only side-effectful seam. Wraps `node:child_process` `spawn` of
  `docker`. Default implementation spawns real `docker`. Unit tests mock it
  via `vi.mock`. Integration tests use the real implementation.

`DockerCommandResult` (defined in `internal/docker-cli.ts`, not exported):
```typescript
interface DockerCommandResult {
  readonly stdout: string;
  readonly stderr: string;
  readonly exitCode: number;
  readonly timedOut?: boolean;
}
```

## 6. Implementation order (TDD: tests first, then impl)

### Slice A — Errors (foundation, no deps)
1. `errors.test.ts` — `DockerExecutorError` base (sets `name`, carries `code`
   + `context`), `ImageDigestError` (`IMAGE_DIGEST_MISMATCH`),
   `ContainerPolicyError` (`CONTAINER_POLICY_VIOLATION`), `instanceof` chain.
   Mirror `runtime-host/src/errors.ts` constructor pattern exactly.
2. `errors.ts` — implement. Wire into `index.ts`.

### Slice B — Config + public API skeleton
3. `config.ts` — `DockerExecutorConfig` interface (post-amendment: no
   `workspace`/`artifactDir`).
4. `public-api.test.ts` (skeleton) — assert every exported symbol importable.

### Slice C — Docker CLI seam
5. `internal/docker-cli.ts` — `runDocker(args, opts)` wrapping `spawn("docker",
   [...args])`. Capture stdout/stderr, resolve exitCode, handle timeout via
   `setTimeout` + SIGTERM + SIGKILL grace (mirror `host-executor.ts`
   `spawnProcess` pattern). Return `DockerCommandResult`. No test file of its
   own — covered by `docker-executor.test.ts` via mock, and
   `integration.test.ts` via real Docker.

### Slice D — canExecute + command construction (pure, no mock)
6. `helpers/fixtures.ts` — `makeDockerOp(overrides)` building a minimal
   `PlanOperation` with `executor.type: "docker"`, `executor.image`,
   `executor.imageDigest`, `command`, `args`, `timeoutSeconds`, `resources`,
   `network`, `credentials`, `artifacts`; `makeRequest(op, overrides)`
   building an `ExecuteRequest` with `workspace` (temp dir), `env`,
   `credentials`, `cacheDir`, `artifactDir`.
7. `docker-executor.test.ts` —
   - `canExecute`: true for `executor.type: "docker"`; false for `host`,
     `podman`, `remote`.
   - `buildDockerArgs`: includes `--rm`, `--read-only`, `--cap-drop ALL`,
     `--network none` (for `network: "deny"`), `--user <runAs>`,
     `--memory <resources.memory>`, `--cpus <resources.cpu>`,
     `--timeout <timeoutSeconds>`, `--workdir /workspace`, workspace mount
     with `readonly`, cache mount, artifact mount. Docker socket NEVER in
     any mount.
8. `docker-executor.ts` — implement `DockerExecutor` class: constructor
   stores config; `canExecute` per type check; `buildDockerArgs` constructs
   the arg array per spec §Container execution policy.

### Slice E — Network policy mapping (pure)
9. Extend `docker-executor.test.ts` —
   - `network: "deny"` → `--network none`.
   - `network: "allow-egress"` → no `--network none` (default bridge).
   - `network: "allow-host"` → `--network host`.
10. Implement: map `operation.network` to the correct `--network` flag in
    `buildDockerArgs`.

### Slice F — Timeout enforcement (validation + mocked timeout)
11. Extend tests —
    - Operation without `timeoutSeconds` (or <= 0) → `ContainerPolicyError`
      (`MISSING_TIMEOUT`), no container started.
    - Mock `runDocker` to return `{ timedOut: true, exitCode: 137 }` →
      `status: "failure"`, error contains "timeout".
12. Implement: validate `timeoutSeconds` before spawn; map `timedOut` result
    to failure with timeout error message.

### Slice G — Image digest verification (mocked CLI)
13. `image.test.ts` — mock `internal/docker-cli.ts`:
    - `verifyImageDigest` with matching digest → resolves.
    - `verifyImageDigest` with mismatched digest → throws `ImageDigestError`
      with both digests in `context`.
    - Image not present → mock `docker inspect` to fail, `docker pull` to
      succeed, then `inspect` returns matching digest → resolves.
14. `image.ts` — implement: `docker inspect --format={{.Id}} <image>` to get
    local digest; if not present, `docker pull <image>` then inspect;
    compare with `expectedDigest`; throw `ImageDigestError` on mismatch.
15. Extend `docker-executor.test.ts` — operation without `imageDigest` →
    `ContainerPolicyError` (`MISSING_DIGEST`), no container started.

### Slice H — Secrets allowlist + env building (pure)
16. Extend `docker-executor.test.ts` — `buildEnv`:
    - Only env vars declared in `operation.credentials` get values from
      `request.credentials`.
    - `request.env` vars are included.
    - `request.env` var matching secret denylist pattern (e.g.
      `/SECRET|TOKEN|PASSWORD|KEY/i`) NOT declared in
      `operation.credentials` → `ContainerPolicyError`
      (`UNDECLARED_SECRET`).
    - Docker socket path (`/var/run/docker.sock`) in any mount or env →
      `ContainerPolicyError` (`DOCKER_SOCKET_DENIED`).
17. Implement: `buildEnv` per spec error rule #4 (post-amendment). Secret
    denylist pattern: `/^(?:.*_)?(?:SECRET|TOKEN|PASSWORD|KEY|CREDENTIAL)$/i`.
    Socket detection: check for `docker.sock` in mount sources and env values.

### Slice I — Cache management (filesystem, no Docker)
18. `cache.test.ts` — `DockerCacheManager`:
    - `prepare(inputs, key)` creates `<cacheDir>/<key>` and
      copies/symlinks declared inputs.
    - `collect(outputs, sourceDir)` copies declared outputs back to
      persistent `cacheDir`.
    - Second `prepare` with same key restores from cache (inputs exist).
19. `cache.ts` — implement `CacheManager` interface + `DockerCacheManager`.
    Use `node:fs/promises` (`mkdir`, `copyFile`, `symlink`). No Docker.

### Slice J — Logs, artifacts, log truncation
20. Extend `docker-executor.test.ts` —
    - Mock `runDocker` returning stdout/stderr → `ExecuteResult.logs`
      contains both.
    - Logs exceeding `maxLogBytes` → truncated + notice appended (mirror
      `host-executor.ts` `truncateLogs`).
    - Declared artifact (file under workspace) copied into
      `request.artifactDir` (mirror `host-executor.ts` `collectArtifacts`).
    - Missing artifact → reported in result error, status unchanged.
21. Implement: `execute` calls `runDocker`, builds `ExecuteResult` from
    `DockerCommandResult`, truncates logs, collects artifacts. Use
    `request.workspace` and `request.artifactDir`.

### Slice K — Integration tests (skippable)
22. `integration.test.ts` — `describe.skipIf(!process.env.SVERKA_DOCKER)`:
    - Run `echo hello` in `busybox@<digest>` → `status: "success"`, logs
      contain `hello`.
    - Run `sh -c "exit 1"` → `status: "failure"`, `exitCode: 1`.
    - These require a real Docker daemon; skipped by default.

### Slice L — Public API + gates
23. Complete `index.ts` exports to match spec §Interfaces exactly:
    `DockerExecutor`, `DockerExecutorConfig`, `verifyImageDigest`,
    `CacheManager`, `DockerCacheManager`, `DockerExecutorError`,
    `ImageDigestError`, `ContainerPolicyError`.
24. `public-api.test.ts` — every symbol importable + exercised.
25. Run gates: `bun run test`, `bun run typecheck`, `bun run lint`,
    `bun run build`. All green (lint is pre-existing broken repo-wide —
    sv-ei2; not a blocker for this wave).

## 7. Convention checklist (enforced by reviewer)

- **No `any`.** Use `unknown` + narrow. No `@ts-ignore`/`@ts-expect-error`.
- **`verbatimModuleSyntax: true`** → type-only imports use `import type`.
- **`exactOptionalPropertyTypes: true`** → never assign `undefined` to an
  optional field; use conditional spread.
- **`noUncheckedIndexedAccess: true`** → narrow array/object access.
- **readonly everywhere** — all interface fields are `readonly`.
- **Error `name`** — each error subclass sets `this.name` in the constructor.
- **ESM only** — `.js` specifiers in imports. No `.cjs`/`.mjs` source.
- **Public surface** — only spec §Interfaces symbols exported from
  `src/index.ts`. `internal/docker-cli.ts` is NOT exported.
- **Test command** — `bun run test` (vitest via nx). NEVER `bun test`.

## 8. Edge cases the builder must handle

- **Executor type mismatch** — `canExecute` false for non-docker; direct
  `execute` raises `ContainerPolicyError` (`WRONG_EXECUTOR_TYPE`).
- **Missing timeout** — `ContainerPolicyError` (`MISSING_TIMEOUT`) before
  spawn.
- **Missing digest** — `ContainerPolicyError` (`MISSING_DIGEST`) before spawn.
- **Digest mismatch** — `ImageDigestError` with both digests in `context`.
- **Undeclared secret** — `request.env` var matching denylist but not in
  `operation.credentials` → `ContainerPolicyError` (`UNDECLARED_SECRET`).
- **Docker socket** — any mount/env referencing `docker.sock` →
  `ContainerPolicyError` (`DOCKER_SOCKET_DENIED`).
- **Non-zero exit** — normal result (`status: "failure"`), not an exception.
- **Timeout** — container killed, `status: "failure"`, error indicates
  timeout.
- **Log truncation** — append notice when truncated; never exceed
  `maxLogBytes`.
- **Missing artifact** — reported in result error, status unchanged.
- **`dispose()`** — no-op (no persistent resources); implement to satisfy
  the optional `Executor.dispose` contract.

## 9. Error code map

| Condition                | code                       | error class              |
|--------------------------|----------------------------|--------------------------|
| Wrong executor type      | `WRONG_EXECUTOR_TYPE`      | `ContainerPolicyError`   |
| Missing timeout          | `MISSING_TIMEOUT`          | `ContainerPolicyError`   |
| Missing digest           | `MISSING_DIGEST`           | `ContainerPolicyError`   |
| Image digest mismatch    | `IMAGE_DIGEST_MISMATCH`    | `ImageDigestError`       |
| Undeclared secret        | `UNDECLARED_SECRET`        | `ContainerPolicyError`   |
| Docker socket denied     | `DOCKER_SOCKET_DENIED`     | `ContainerPolicyError`   |

## 10. Gates (reviewer runs these)

```bash
bun install              # resolve new workspace deps
bun run test             # vitest via nx (NOT `bun test`)
bun run typecheck        # strict, no any
bun run lint             # eslint clean (pre-existing sv-ei2 broken repo-wide)
bun run build            # tsdown produces dist/index.mjs + .d.mts
```

Acceptance criteria: test + typecheck + build green; spec §Test plan items
1–8, 10 pass (item 9 integration tests skippable; item 11 commands). Lint is
pre-existing broken (sv-ei2) — not a blocker for this wave.

## 11. ADR

Optional: `engdocs/adr/ADR-008-docker-executor-mockable-cli-seam.md` — one
paragraph recording that the Docker executor separates pure command
construction from the `internal/docker-cli.ts` spawn seam to enable unit
testing without a Docker daemon. File only if the reviewer/mayor wants the
decision durable beyond this plan.
