# Sverka Audit Fixes Megaplan

> **Goal:** Fix the 6 critical audit findings from the 2026-02 critical review.
> Each finding kills a piece of the product story. Fix them in priority order:
> AI agent value first, dead code last.

> **Source:** Critical audit session. Findings persisted in `bd memories` under
> `audit-1` through `audit-6`. See `AGENTS.md` → Critical Audit Findings.

## Priorities (ordered by product impact)

### Phase 1: stdout/stderr in JSON output [CRITICAL — unblocks AI agent story]
**Why:** `sverka run --format json` gives `{stepId, status, error}` but not the
actual command output. Agent gets "step failed with exit code 1" but not WHY.
Defeats the entire "one command replaces N round-trips" promise.

| Task | What | Files | Effort |
|------|------|-------|--------|
| 1.1 | Extend `RunEvent` types: add `stdout`, `stderr`, `exitCode` to `step-failed` and `step-succeeded` | `packages/runtime/src/engine-native/types.ts` | Small |
| 1.2 | Emit stdout/stderr/exitCode in engine when shell completes | `packages/runtime/src/engine-native/engine.ts` | Small |
| 1.3 | Include stdout/stderr/exitCode in JSON output `steps[]` | `packages/cli/src/commands/run.ts` | Small |
| 1.4 | Add integration test: failing step includes stdout/stderr in JSON | `packages/cli/src/__tests__/run-integration.test.ts` | Small |
| 1.5 | Validate: `sverka run --format json` on failing config shows real error | manual | Small |

**Branch:** `fix/json-stdout-stderr`
**Acceptance:** Agent can see WHY a step failed from JSON alone, without
running the command separately.

### Phase 2: Connect findings pipeline OR remove --evaluate [CRITICAL]
**Why:** `--evaluate` reports `findings:0 verdict:pass` — false negative.
`collectFindings` reads SARIF from `.sverka/artifacts/` but no check produces
SARIF, no config declares outputs, dir is never created. The "unique value
proposition" (structured findings) doesn't work.

| Task | What | Files | Effort |
|------|------|-------|--------|
| 2.1 | Decision: connect or remove? If connect: 2.2-2.5. If remove: 2.6. | — | Trivial |
| 2.2 | Create artifact dir on run start | `packages/cli/src/commands/run.ts` | Trivial |
| 2.3 | Add `outputs: { sarif: { type: "artifact", path: "report.sarif" } }` to check resolver | `packages/verification/src/checks/resolver.ts` | Small |
| 2.4 | Save shell stdout to artifact dir when step declares outputs | `packages/runtime/src/engine-native/step-executor.ts` | Medium |
| 2.5 | Document: how to make a check produce SARIF | `skills/sverka/SKILL.md` | Small |
| 2.6 | (alt) Remove `--evaluate` flag, mark findings/policy as future | `packages/cli/src/commands/run.ts`, `packages/cli/src/main.ts` | Small |

**Branch:** `fix/findings-pipeline`
**Acceptance:** Either `--evaluate` shows real findings from real checks, OR
`--evaluate` is removed and findings/policy is documented as future.

### Phase 3: Fix integration test bugs [HIGH]
**Why:** Integration test `VALID_CONFIG` uses `dependencies: [{ kind: "control",
producer: "build" }]` — the same non-existent prop that was a silent bug in
sverka.config.ts. Tests validate the bug, not the feature. `placeSarif()`
manually writes SARIF because `echo build` doesn't produce it.

| Task | What | Files | Effort |
|------|------|-------|--------|
| 3.1 | Fix `VALID_CONFIG`: `dependencies: [...]` → `dependsOn: ["build"]` | `packages/cli/src/__tests__/run-integration.test.ts` | Trivial |
| 3.2 | Fix `placeSarif`: use a step that actually produces SARIF, or document as manual | same file | Small |
| 3.3 | Add real end-to-end test: config with `dependsOn` → run → verify deps respected | same file | Small |
| 3.4 | Add test: failing step → JSON includes error message | same file | Small |

**Branch:** `fix/integration-test-bugs`
**Acceptance:** Integration tests test real behavior, not bugs.

### Phase 4: Revert CDK-style dependsOn [MEDIUM]
**Why:** `sverka validate` already catches `dependsOn: ["typechek"]` typos.
CDK-style Step-objects duplicates existing protection. In CDK objects are
needed for cross-scope references; in sverka all steps are in one Pipeline.

| Task | What | Files | Effort |
|------|------|-------|--------|
| 4.1 | Revert `StepProps.dependsOn` to `readonly string[]` | `packages/workflow/src/cdk/constructs.ts` | Trivial |
| 4.2 | Revert constructor Step→id resolution | same file | Trivial |
| 4.3 | Remove CDK-style tests | `packages/workflow/src/cdk/__tests__/constructs.test.ts` | Trivial |
| 4.4 | Revert sverka.config.ts to string IDs | `sverka.config.ts` | Trivial |
| 4.5 | Update skill: remove CDK-style section | `skills/sverka/SKILL.md` | Trivial |

**Branch:** `revert/cdk-style-dependson`
**Acceptance:** `dependsOn` is `string[]` only. validate catches typos.

### Phase 5: Delete dead compilers [MEDIUM]
**Why:** Temporal/dagger/inngest/drone compilers (28 files) are not used by
`sverka run` and have no real users. Speculative architecture from v0
CI-portability era. 80% of code serves 0% of users.

| Task | What | Files | Effort |
|------|------|-------|--------|
| 5.1 | Delete `packages/compiler/src/temporal/` | 7 files | Trivial |
| 5.2 | Delete `packages/compiler/src/dagger/` | 7 files | Trivial |
| 5.3 | Delete `packages/compiler/src/inngest/` | 7 files | Trivial |
| 5.4 | Delete `packages/compiler/src/drone/` | 7 files | Trivial |
| 5.5 | Remove from barrel exports | `packages/compiler/src/index.ts` | Trivial |
| 5.6 | Remove from CLI choices if present | `packages/cli/src/main.ts` | Trivial |
| 5.7 | Run typecheck + test + lint to verify no regressions | — | Small |

**Branch:** `cleanup/dead-compilers`
**Acceptance:** 28 fewer files. No regressions. GitHub/GitLab compilers remain.

### Phase 6: Fix ensureConstructsDependency [LOW]
**Why:** Adds `@sverka/cdk` (empty package, 0 tracked files) instead of
`@sverka/workflow` (the real Construct API package).

| Task | What | Files | Effort |
|------|------|-------|--------|
| 6.1 | Change `ensureConstructsDeclared` to add `@sverka/workflow` not `@sverka/cdk` | `packages/cli/src/internal/config.ts` | Trivial |
| 6.2 | Update `isLocalWorkspace` to check for `@sverka/workflow` | same file | Trivial |
| 6.3 | Update `getDefaultConstructsVersion` to resolve `@sverka/workflow` | same file | Trivial |
| 6.4 | Test: `sverka init` adds `@sverka/workflow` to package.json | `packages/cli/src/__tests__/init.test.ts` | Small |

**Branch:** `fix/ensure-constructs-dependency`
**Acceptance:** `sverka init` adds `@sverka/workflow`, not `@sverka/cdk`.

## Execution order

Phases 1-3 are sequential (each depends on prior). Phases 4-6 can run in
parallel after Phase 3. Phase 5 can run in parallel with anything.

```
Phase 1 (JSON stdout/stderr) ──┐
                               ├─► Phase 3 (fix integration tests)
Phase 2 (findings pipeline)  ──┘
                               
Phase 4 (revert CDK)     ──► (independent, after Phase 3)
Phase 5 (delete dead)    ──► (independent, anytime)
Phase 6 (fix init dep)   ──► (independent, anytime)
```

## Validation gates (every phase)

```bash
bun run typecheck
bun run test
bun run lint
sverka run --format json
```

All must pass before phase is complete.
