# Feature: Stages & ordering

**ID:** F-08
**Category:** scheduling
**Milestone:** M0 (already in v0)
**Status:** Implemented
**Parent epic:** sv-4wh9

## Summary

Stages group jobs by topological level for ordered execution. GitLab CI uses
explicit `stages`; GitHub Actions uses implicit ordering via `needs`. Sverka
has no explicit stage concept in the Definition Graph — the GitLab target
derives stages from dependency depth, and GitHub relies on `needs`.

## Provider matrix

| Aspect | GitHub Actions | GitLab CI | Sverka (proposed) |
|--------|---------------|-----------|-------------------|
| Construct | implicit via `needs` | `stages` (global) + `stage` (per job) | derived from dependency depth |
| Semantics | jobs run when `needs` are met | jobs in same stage run in parallel; stages run sequentially | topological level = stage |
| Value type | n/a | string array (`stages`) + string (`stage`) | computed `stage-N` |
| Limitations | no visual stage grouping | fixed stage list | no user-defined stage names |
| Provider gap | — | — | stage names are auto-generated (`build`, `stage-1`, ...) |

## GitHub Actions

```yaml
jobs:
  build:
    runs-on: ubuntu-latest
    steps: [{ run: echo build }]
  test:
    needs: build
    runs-on: ubuntu-latest
    steps: [{ run: echo test }]
```

GitHub has no `stages` key — ordering is entirely via `needs`. Jobs without
`needs` run in parallel.

## GitLab CI

```yaml
stages: [build, test, deploy]
build:
  stage: build
  script: [echo build]
test:
  stage: test
  needs: [build]
  script: [echo test]
```

`stages` defines the global order. Jobs in the same stage run in parallel.
Stages run sequentially. `needs` can override stage ordering for cross-stage
dependencies.

## Sverka proposal

### Portable model

No explicit stage field in the Definition Graph. The GitLab target computes
stages from topological depth (`gitlab/lower.ts:205-263`):

- Level 0 (no dependencies) → `build`
- Level N → `stage-N`

The GitHub target does not emit stages — it uses `needs` for ordering.

Propose: no change to the portable model. Stages are a target-specific
lowering concern, not a portable concept. User-defined stage names could be
added as a future extension (M1) via a `stage?: string` field on Step.

### Authoring API

No direct stage authoring — stages are implicit from dependencies:

```ts
// SDK — stages emerge from dependsOn
sh`echo build`.build(pipeline, "build")
sh`echo test`.dependsOn(["build"]).build(pipeline, "test") // → stage-1

// Construct — same
new ShellStep(pipeline, "build", { command: "echo build" });
new ShellStep(pipeline, "test", { command: "echo test", dependsOn: ["build"] });
```

### Lowering

- **GitHub target:** no stages emitted. Ordering via `needs` (F-07).
- **GitLab target:** `computeStages` (`gitlab/lower.ts:205-263`) assigns each
  job a stage based on its topological level. `stages:` list emitted in
  dependency order. Cycle detection throws `LOWER_FAILED`.
- **Native engine:** Scheduler topological sort — no stage concept needed.

### Capability manifest

```ts
"scheduling.stages": "native",  // GitLab; GitHub uses needs
```

### Portability & divergence

GitLab requires stages; GitHub doesn't have them. Sverka auto-generates stage
names from dependency depth, which is correct but not user-friendly. The
generated names (`build`, `stage-1`, `stage-2`) are functional but opaque.

## Non-goals

- User-defined stage names (M1 extension).
- Parallel stage execution control (`max-parallel` — F-16).

## Dependencies

- **Depends on:** F-07 (DAG deps) — stages derived from dependency depth.
- **Blocks:** none.

## Open questions

- Should a `stage?: string` field be added to `StepProps` for user-defined
  stage names, or is auto-generation sufficient for v0?
- Should the `build` stage name be configurable?

## References

- GitHub: https://docs.github.com/en/actions/using-workflows/workflow-syntax-for-github-actions#jobsjob_idneeds
- GitLab: https://docs.gitlab.com/ee/ci/yaml/#stages
- Architecture spec: §16, §18.2
- Source: `packages/gitlab/src/lower.ts:205-263`, `packages/gitlab/src/lower.ts:243-245`
