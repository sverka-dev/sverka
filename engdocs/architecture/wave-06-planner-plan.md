# Wave 6 — Planner Implementation Plan

**Architect:** architect-1
**Spec:** `specs/06-planner/spec.md`
**Package:** `@sverka/planner` → `packages/planner`
**Depends on:** none (planner is standalone in v1 — it produces
`ProjectContext` + `PlanProposal`; it does not build IR Plans or import
`@sverka/core`/`ir`/`runtime`)

This plan is the contract the builder implements against. The spec is the
source of truth; this plan adds sequencing, file layout, conventions, and
edge-case guidance. Where the two disagree, the spec wins.

## 1. Spec amendments applied (architect)

Spec 06 was rewritten for Wave 6 to cut scope from ~14 interfaces to ~10 and
drop all remote/cloud/framework/explainability-step machinery. Amendments
relative to the original spec:

1. **Remote discovery removed.** `RemoteSignal`, `RemoteSignalType`,
   `ProviderMetadata`, `ProviderCredentials`, `CloudCredential`, the remote
   branch of `SignalProvider` — all deleted. Remote is a `runtime-remote`
   wave. `DiscoverOptions.remote`/`remoteSignals`/`credentials` removed.
2. **Framework detection removed.** No consumer needs it in v1.
   `DetectedFramework` deleted.
3. **Infrastructure signal collapsed.** `InfrastructureSignal` deleted;
   dockerfile/docker-compose remain as `LocalSignalType` values.
   `hasContainerBuild` boolean replaces the structured array.
4. **Explainability simplified.** `DiscoveryStep`/`DiscoveryExplanation.steps`
   deleted. `DiscoveryExplanation` is now `{ summary, signalCounts }`.
5. **`plan()` no longer takes `workflowPath`.** Loading/executing a user
   `sverka.config.ts` is deferred to the SDK wave (it requires executing user
   code and is coupled to Workflow→IR-Plan wiring). `plan(context)` does
   default-check synthesis only; `PlanProposal.workflowPath` is always `null`
   in v1.
6. **`ChangedFile` trimmed.** Dropped `additions`/`deletions` line counts
   (require `git diff --numstat` parsing and add complexity for no current
   consumer). Status only, via `git diff --name-status`.
7. **`DiscoverOptions.commit` removed.** Discovery always anchors at HEAD.
8. **`SignalProvider` interface removed.** v1 has one built-in local
   provider; no plugin surface yet (YAGNI).
9. **Error codes trimmed.** `INVALID_CREDENTIALS`/`REMOTE_TIMEOUT` removed
   (no remote). Remaining: `ROOT_NOT_FOUND`, `GIT_UNAVAILABLE`,
   `GIT_NOT_A_REPO`, `TRAVERSAL_FAILED`.
10. **Test command corrected:** `bun test` → `bun run test` (vitest via nx,
    per drill-finding-2026-08-09-bun-test-in).

## 2. Scope

Implement local-only discovery + default plan synthesis for
`@sverka/planner`:

- `createPlanner()` factory (no options; git seam mocked in tests via `vi.mock`).
- `Planner.discover(options)` → `ProjectContext` (validate root, enumerate
  files via git, collect local signals, aggregate, git metadata, explanation).
- `Planner.plan(context)` → `PlanProposal` (default checks from detected
  languages + package managers).
- `DiscoveryError` + `DiscoveryErrorCode`.
- Internal `git-cli.ts` — mockable spawn seam (NOT exported).
- Public re-exports from `src/index.ts`.

**No workspace dependencies.** The planner imports nothing from
`@sverka/core`/`ir`/`runtime` in v1. It uses only Node stdlib (`node:crypto`,
`node:fs`, `node:path`, `node:child_process`).

**Out of scope (do NOT implement in this wave):**
- **Remote discovery / cloud credentials.** Deferred to `runtime-remote`.
- **Framework detection.** Deferred (no consumer).
- **User workflow loading** (`sverka.config.ts`). Deferred to SDK wave (09).
- **`PlanProposal` → IR `Plan` conversion.** That wiring lives in the SDK
  wave; the planner only proposes checks.
- **Persistent caching of discovery results.** In-memory only; v1 has no
  cache.

## 3. Scaffolding status (already present; builder fixes two items)

- `packages/planner/package.json` — **fix:** dist paths are `.js`/`.d.ts`;
  must be `.mjs`/`.d.mts` to match `core`/`ir`/`runtime`/`runtime-host`.
  No `dependencies` needed (standalone). `devDependencies` already present
  (`tsdown`, `typescript`, `vitest`).
- `packages/planner/project.json` — **fix:** lint target uses
  `eslint src --ext .ts`; remove `--ext .ts` (ESLint 9 flat config, per
  sv-ei2 / drill-finding). Test target already has `--passWithNoTests`.
- `tsconfig.json`, `tsdown.config.ts` — already match siblings; no changes.
- `src/index.ts` — placeholder; builder fills exports.
- Run `bun install` after `package.json` edit.

## 4. File layout

Mirror `runtime-host` (one module per concern, `__tests__/` co-located):

```
packages/planner/src/
  index.ts              # public re-exports (matches spec §Interfaces)
  errors.ts             # DiscoveryError, DiscoveryErrorCode
  planner.ts            # Planner interface, createPlanner, discover + plan
  detect.ts             # pure detection rules: signals, languages, pkgmgrs, monorepo
  explain.ts            # build Explanation { summary, signalCounts }
  internal/
    git-cli.ts          # GitCli seam + createGitCli (spawn) — NOT exported
  __tests__/
    helpers/
      fixtures.ts       # build temp git repos in os.tmpdir() per test
    discover.test.ts    # test plan 1-7, 9, 10
    plan.test.ts        # test plan 8
    errors.test.ts      # test plan 9 (error codes)
    public-api.test.ts  # exports match spec §Interfaces
```

## 5. Conventions

- **No `any`.** `cause` is `unknown`; narrow in tests. Strict TS.
- **Pure/impure split.** `detect.ts` and `explain.ts` are pure functions
  over a file list + signal list. All git/filesystem I/O goes through the
  `GitCli` seam and `node:fs`. `planner.ts` orchestrates; the seam is the
  only impure boundary, and it is injectable.
- **Determinism.** No `Date.now()` / timestamps in any output. `fetchedAt`
  is gone (no remote). Identical fixture + identical git mock → identical
  `ProjectContext`.
- **Side-effect freedom.** `discover()` only reads. Test plan item 10
  asserts no new files appear under root after a run.
- **Exports.** Only what spec §Interfaces lists is exported from
  `src/index.ts`. `GitCli`/`createGitCli`/`detect.ts`/`explain.ts` are
  internal.
- **Errors.** `DiscoveryError` extends `Error`; sets `name`, `code`, `cause`.
  Throw, don't return, for the four unrecoverable codes.

## 6. Implementation steps (builder, TDD — tests first)

1. **Fix scaffolding.** Edit `package.json` dist paths → `.mjs`/`.d.mts`.
   Edit `project.json` lint → `eslint src`. `bun install`.
2. **`errors.ts` + `errors.test.ts`.** `DiscoveryError`, `DiscoveryErrorCode`
   union (4 codes). Test construction, name, code, cause chaining.
3. **`internal/git-cli.ts`.** `GitCli` interface (`run(args, cwd)`), default
   `createGitCli()` using `node:child_process` `spawn` (collect stdout, reject
   on non-zero with stderr in cause). No unit test for the real spawn; it is
   mocked everywhere else.
4. **`__tests__/helpers/fixtures.ts`.** Helper to create a temp dir, `git
   init`, write files, `git add`/`commit`, optionally set a baseRef commit.
   Returns `{ root, git: GitCli-mock-or-real }`. Use the real git for an
   integration test (guarded) and a recorded mock for unit tests.
5. **`detect.ts` + `discover.test.ts` (TDD).** Pure functions:
   - `detectSignals(files): LocalSignal[]` — match manifest/lockfile/
     dockerfile/docker-compose/ci-definition/monorepo-marker rules.
   - `detectLanguages(files): DetectedLanguage[]` — extension counts,
     confidence `min(1, count/10)`.
   - `detectPackageManagers(files, packageJson?): DetectedPackageManager[]`
     — lockfile map + `packageManager` field override.
   - `detectMonorepo(files, packageJson?): MonorepoMarker | null`.
   Write failing tests first (test plan 1-4), then implement.
6. **`explain.ts` + test.** `buildExplanation(signals): DiscoveryExplanation`
   — `signalCounts` per type + one-line summary. Test plan 6.
7. **`planner.ts` discover() + tests.** Orchestrate: validate root (`fs`),
   git availability (probe `git --version` via seam → `GIT_UNAVAILABLE`),
   repo check (`git rev-parse --show-toplevel` → `GIT_NOT_A_REPO`), enumerate
   (`git ls-files`, `git status --porcelain`), apply `maxDepth`,
   call detect.*, collect git metadata (`rev-parse HEAD`, dirty, `diff
   --name-status baseRef..HEAD` when baseRef set), assemble `ProjectContext`.
   Test plan 5, 7, 9, 10.
8. **`planner.ts` plan() + `plan.test.ts`.** Default-check table (spec §Plan
   synthesis). Stable `id = "prop-" + sha256(checkId+reason).slice(0,16)`.
   `signalRef` is `${type}:${path}` of the triggering manifest/lockfile
   signal, or `null` for pure defaults. `notes` records drivers.
   Test plan 8.
9. **`public-api.test.ts`.** Assert `src/index.ts` exports exactly the spec
   list (types + `createPlanner` + `DiscoveryError`).
10. **Gates.** `bun run test` (planner), `bun run typecheck`, `bun run lint`,
    `bun run build` for planner; then full monorepo `bun run test/typecheck/
    lint/build` (16 projects) to catch entangled breakage.

## 7. Edge cases

- **Root exists but is not a git repo.** `GIT_NOT_A_REPO` (do not fall back
  to non-git enumeration in v1 — git is required).
- **`git` not on PATH.** Probe once; `GIT_UNAVAILABLE`.
- **Empty repo (no commits).** `git rev-parse HEAD` fails → treat `commit`
  as `""`, `dirty` true, `changedFiles` empty. Do not throw (a fresh repo is
  valid). Document this in `notes`.
- **`baseRef` does not resolve.** `git diff` fails → `TRAVERSAL_FAILED`
  (reuse code; message names the bad ref).
- **Permission error reading a file.** `TRAVERSAL_FAILED` with cause.
- **`maxDepth`.** Applied to the enumerated file list (path depth from
  root). No `exclude` option in v1 (gitignore via git covers the real need;
  `exclude` was dropped to avoid a glob-matcher dependency — YAGNI).
- **No signals at all.** `ProjectContext` still valid; `languages`/
  `packageManagers` empty; `plan()` returns empty `checks` + explanatory
  note.
- **Multiple package managers.** All detected ones returned (e.g. npm +
  cargo in a polyglot repo).

## 8. Test plan → spec mapping

| Spec test plan | File | Notes |
|---|---|---|
| 1 local signals | `discover.test.ts` | via fixtures |
| 2 languages | `discover.test.ts` | extension counts |
| 3 package managers | `discover.test.ts` | lockfile + `packageManager` override |
| 4 monorepo | `discover.test.ts` | all tools + workspace resolution |
| 5 git metadata | `discover.test.ts` | baseRef present + omitted |
| 6 explainability | `discover.test.ts` | `signalCounts` + `summary` |
| 7 determinism | `discover.test.ts` | two runs, deep-equal |
| 8 plan synthesis | `plan.test.ts` | Node/Python/Rust/Go/empty |
| 9 error cases | `errors.test.ts` + `discover.test.ts` | 4 codes |
| 10 side-effect freedom | `discover.test.ts` | snapshot root before/after |

## 9. Acceptance

- All planner tests pass (`bun run test` for planner).
- Full monorepo green: test, typecheck, lint, build across 16 projects.
- `src/index.ts` exports match spec §Interfaces exactly; no `any`.
- `discover()` is side-effect free (test plan 10).
- Determinism test passes (test plan 7).
- No workspace dependencies added (planner standalone).
