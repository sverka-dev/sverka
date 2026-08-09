# Wave 4 — Runtime Host Executor Implementation Plan

**Architect:** architect-1
**Spec:** `specs/05-runtime-host/spec.md`
**Package:** `@sverka/runtime-host` → `packages/runtime-host`
**Depends on:** Wave 3 (`@sverka/runtime`), Wave 2 (`@sverka/ir`)

This plan is the contract the builder implements against. The spec is the
source of truth; this plan adds sequencing, file layout, conventions, and
edge-case guidance. Where the two disagree, the spec wins — except where the
spec conflicts with the **built** runtime contract, in which case the built
contract wins (see §1 amendments).

## 1. Spec amendments already applied (architect)

Spec 05 was written before `@sverka/runtime` was built. Three mismatches with
the built contract have been corrected in the spec:

1. **`workspace` / `artifactDir` removed from `HostExecutorConfig`.** The
   scheduler passes both per-execution via `ExecuteRequest`
   (`request.workspace`, `request.artifactDir`). The executor must use the
   request fields, not config fields. `canExecute` (which receives only the
   operation) never needed them.
2. **Env building uses `request.credentials` and `request.env`, not
   `operation.credentials` / `operation.env`.** `operation.credentials` is
   `CredentialDeclaration[]` (name/envVar/required — declarations). Resolved
   secret **values** arrive via `request.credentials: Record<string,string>`
   (keyed by envVar). `request.env` carries the operation env vars.
3. All `config.workspace` / `config.artifactDir` references in the data model,
   security table, error rules, and test plan updated to `request.*`.

## 2. Scope

Implement the host process executor for `@sverka/runtime-host`:

- `HostExecutor` class implementing `Executor` from `@sverka/runtime`.
- `HostExecutorConfig` (enabled, allowlist, envAllowlist, env?, maxLogBytes?,
  runAsUid?).
- `CommandAllowlist` interface + `createAllowlist` factory (security primitive).
- Error hierarchy: `HostExecutorError` → `HostTimeoutError`,
  `CommandNotAllowedError`.
- Public re-exports from `src/index.ts`.

**Dependency:** `@sverka/runtime` (Executor, ExecuteRequest, ExecuteResult) +
`@sverka/ir` (PlanOperation). Both `workspace:*`.

**Out of scope (do NOT implement in this wave):**
- **Retry.** The scheduler owns retry (`maxAttempts`/`retryOn`/`backoffSeconds`,
  Wave 3 Slice E). The executor executes **once** and returns a result. Spec
  goal 7 ("support retry policies") is satisfied by returning `status:
  "failure"` results that the scheduler can retry. Spec test plan item 10 is
  an integration concern with the scheduler, not a host-executor unit test —
  exclude it from this package's suite.
- **Actual setuid / privilege dropping.** The executor **validates**
  `runAsUid !== 0` and rejects `sudo`/`su` in the allowlist at construction.
  It does **not** call setuid — sandboxing is the container executors' job.
- Filesystem / network isolation (host processes are ambient; documented
  limitation per spec non-goals).

## 3. Scaffolding status (already done by architect)

- `packages/runtime-host/package.json` — fixed: dist paths are
  `.mjs`/`.d.mts` (matches `core`/`ir`/`runtime`); `@sverka/runtime` and
  `@sverka/ir` added to `dependencies` as `workspace:*`.
- `packages/runtime-host/project.json` — already has `--passWithNoTests` on
  the test target.
- `tsconfig.json`, `tsdown.config.ts` — already match `runtime`; no changes.
- `src/index.ts` — placeholder; builder fills exports.

The builder must run `bun install` once after pulling the new workspace deps.

## 4. File layout

Mirror `core`/`ir`/`runtime` (one module per concern, `__tests__/` co-located):

```
packages/runtime-host/src/
  index.ts              # public re-exports (matches spec §Interfaces)
  errors.ts             # HostExecutorError, HostTimeoutError, CommandNotAllowedError
  config.ts             # HostExecutorConfig (type-only)
  allowlist.ts          # CommandAllowlist interface + createAllowlist
  host-executor.ts      # HostExecutor class
  __tests__/
    errors.test.ts
    allowlist.test.ts
    host-executor.test.ts   # the big one: canExecute, spawn, timeout, env, cwd, artifacts
    public-api.test.ts
    helpers/
      fixtures.ts           # op factory + makeRequest helper
```

No `internal/` needed — `allowlist.ts` is public (spec exports it).

## 5. Implementation order (TDD: tests first, then impl)

### Slice A — Errors (foundation, no deps)
1. `errors.test.ts` — `HostExecutorError` base (sets `name`, carries `code` +
   `context`), `HostTimeoutError` (`HOST_TIMEOUT`), `CommandNotAllowedError`
   (`COMMAND_NOT_ALLOWED`), `instanceof` chain. Mirror `runtime/src/errors.ts`
   constructor pattern exactly.
2. `errors.ts` — implement. Wire into `index.ts`.

### Slice B — Allowlist (security primitive, no deps)
3. `allowlist.test.ts` — `createAllowlist(["node","/usr/bin/git"])`:
   `isAllowed("node")` true, `isAllowed("git")` false (bare name must match
   entry exactly), `isAllowed("/usr/bin/git")` true, `isAllowed("/bin/sh")`
   false. Empty allowlist → nothing allowed.
4. `allowlist.ts` — `CommandAllowlist` interface + `createAllowlist`. Matching
   rule: an entry matches a command if (a) entry is an absolute path and
   equals the command exactly, or (b) entry is a bare name and equals the
   command's basename. **No globs** (spec: deterministic matching).

### Slice C — Config + public API skeleton
5. `config.ts` — `HostExecutorConfig` interface (per spec, post-amendment:
   no `workspace`/`artifactDir`).
6. `public-api.test.ts` (skeleton) — assert every exported symbol importable.

### Slice D — HostExecutor core (canExecute + spawn + output + exit code)
7. `helpers/fixtures.ts` — `makeHostOp(overrides)` building a minimal
   `PlanOperation` with `executor.type: "host"`, `command`, `args`,
   `timeoutSeconds`; `makeRequest(op, overrides)` building an `ExecuteRequest`
   with `workspace` (a temp dir), `env`, `credentials`, `cacheDir`,
   `artifactDir`.
8. `host-executor.test.ts` —
   - `canExecute`: false when `enabled: false`; true for `executor.type:
     "host"` + allowed command + valid timeout; false for `type: "docker"`;
     false when command not in allowlist; false when `timeoutSeconds` missing.
   - spawn `node -e "console.log('hello')"` → `status: "success"`,
     `exitCode: 0`, logs contain `hello`.
   - spawn `node -e "process.exit(1)"` → `status: "failure"`, `exitCode: 1`.
   - stdout + stderr both captured into `logs`.
9. `host-executor.ts` — implement: construction stores config; `canExecute`
   per spec eligibility formula; `execute` validates (enabled, type, timeout,
   allowlist), builds env, spawns via `node:child_process` `spawn`, captures
   stdout+stderr, resolves `ExecuteResult`. Use `request.workspace` as cwd.

### Slice E — Timeout
10. Extend `host-executor.test.ts` — `timeoutSeconds: 0.1` running
    `node -e "setTimeout(()=>{},5000)"` → killed, `status: "failure"`, error
    contains "timeout". Use **real** short timeouts (not fake timers — spawn
    uses real timers internally).
11. Implement: SIGTERM on expiry, SIGKILL after 2s grace, record timeout
    failure. `MISSING_TIMEOUT` raised before spawn if `timeoutSeconds` absent
    or <= 0.

### Slice F — Environment bounding
12. Extend tests — spawn `node -e "console.log(process.env.FOO)"`:
    - host env var not in `envAllowlist` → absent from child.
    - `envAllowlist: ["PATH"]` → PATH present.
    - `request.env: { FOO: "bar" }` → FOO present.
    - `request.credentials: { SECRET: "s" }` → SECRET present.
13. Implement env building per spec step 5 (post-amendment): start empty,
    forward `envAllowlist` from `process.env`, merge `config.env`, merge
    `request.credentials`, merge `request.env`.

### Slice G — Working directory constraint
14. Extend tests —
    - cwd is `request.workspace` by default (spawn
      `node -e "console.log(process.cwd())"`).
    - `operation.workingDir` relative to workspace honored.
    - `operation.workingDir` resolving outside workspace →
      `HostExecutorError` (`WORKDIR_OUTSIDE_WORKSPACE`).
15. Implement: resolve `operation.workingDir` against `request.workspace`;
    reject if the resolved path escapes `request.workspace` (use
    `path.resolve` + startsWith check).

### Slice H — Privilege escalation prevention (construction-time)
16. Extend tests — constructing `HostExecutor` with `runAsUid: 0` throws
    `HostExecutorError` (`PRIVILEGE_ESCALATION`); allowlist containing
    `sudo` or `su` throws at construction.
17. Implement: validate in constructor; do not actually setuid.

### Slice I — Artifacts + log truncation
18. Extend tests —
    - declared artifact (a file written under workspace) copied into
      `request.artifactDir`.
    - missing artifact path → reported in result error, status unchanged.
    - output exceeding `maxLogBytes` → truncated + notice appended.
19. Implement: copy artifacts after process exit; truncate logs with notice.

### Slice J — Public API + gates
20. Complete `index.ts` exports to match spec §Interfaces exactly.
21. `public-api.test.ts` — every symbol importable + exercised.
22. Run gates: `bun run test`, `bun run typecheck`, `bun run lint`,
    `bun run build`. All green.

## 6. Convention checklist (enforced by reviewer)

- **No `any`.** Use `unknown` + narrow. No `@ts-ignore`/`@ts-expect-error`.
- **`verbatimModuleSyntax: true`** → type-only imports use `import type`.
- **`exactOptionalPropertyTypes: true`** → never assign `undefined` to an
  optional field; use conditional spread.
- **`noUncheckedIndexedAccess: true`** → narrow array/object access.
- **readonly everywhere** — all interface fields are `readonly`.
- **Error `name`** — each error subclass sets `this.name` in the constructor.
- **ESM only** — `.js` specifiers in imports. No `.cjs`/`.mjs` source.
- **Public surface** — only spec §Interfaces symbols exported from
  `src/index.ts`.
- **Test command** — `bun run test` (vitest via nx). NEVER `bun test`.

## 7. Edge cases the builder must handle

- **Executor disabled** — `canExecute` returns false for all; direct
  `execute` raises `HostExecutorError` (`EXECUTOR_DISABLED`).
- **Wrong type** — `canExecute` false; direct `execute` raises
  `HostExecutorError` (`WRONG_EXECUTOR_TYPE`).
- **Spawn failure** — binary not found → `status: "failure"`, `error`
  describing the spawn error (not an exception).
- **Non-zero exit** — normal result (`status: "failure"`), not an exception.
- **Timeout grace** — SIGTERM, then SIGKILL after 2s. Do not leak the process.
- **Log truncation** — append a notice when truncated; never exceed
  `maxLogBytes`.
- **Working directory escape** — reject `..` traversal outside workspace.
- **Empty allowlist** — nothing allowed; `canExecute` false for any command.
- **`dispose()`** — no-op (no persistent resources); implement to satisfy the
  optional `Executor.dispose` contract.

## 8. Error code map

| Condition                | code                    | error class              |
|--------------------------|-------------------------|--------------------------|
| Executor disabled        | `EXECUTOR_DISABLED`     | `HostExecutorError`      |
| Wrong executor type      | `WRONG_EXECUTOR_TYPE`   | `HostExecutorError`      |
| Missing timeout          | `MISSING_TIMEOUT`       | `HostExecutorError`      |
| Command not allowed      | `COMMAND_NOT_ALLOWED`   | `CommandNotAllowedError` |
| Timeout exceeded         | `HOST_TIMEOUT`          | `HostTimeoutError`       |
| Privilege escalation     | `PRIVILEGE_ESCALATION`  | `HostExecutorError`      |
| Workdir outside workspace| `WORKDIR_OUTSIDE_WORKSPACE` | `HostExecutorError`   |

## 9. Gates (reviewer runs these)

```bash
bun install              # resolve new workspace deps
bun run test             # vitest via nx (NOT `bun test`)
bun run typecheck        # strict, no any
bun run lint             # eslint clean
bun run build            # tsdown produces dist/index.mjs + .d.mts
```

Acceptance criteria: all gates green; spec §Test plan items 1–9, 11 pass
(item 10 retry is scheduler-owned — excluded, see §2).

## 10. ADR

Optional: `engdocs/adr/ADR-008-host-executor-no-retry-no-setuid.md` — one
paragraph recording that the host executor does not retry (scheduler-owned)
and does not setuid (validates only; sandboxing is container executors' job).
File only if the reviewer/mayor wants the decision durable beyond this plan.
