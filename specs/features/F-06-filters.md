# Feature: Branch, tag & path filters

**ID:** F-06
**Category:** triggers
**Milestone:** M0 (already in v0)
**Status:** Implemented
**Parent epic:** sv-4wh9

## Summary

Filters restrict when a trigger fires based on branch names, tag names, or
changed file paths. Both GitHub Actions and GitLab CI support all three. Sverka
already models them in `TriggerFilter` (`@sverka/cdk`), but the current target
lowering only emits `branches` — `tags` and `paths` are silently dropped. This
spec formalizes the portable model and flags the lowering gap.

## Provider matrix

| Aspect | GitHub Actions | GitLab CI | Sverka (proposed) |
|--------|---------------|-----------|-------------------|
| Construct | `branches`, `tags`, `paths` (+ `-ignore`) | `rules:changes`, `rules:if` branch refs | `TriggerFilter.branches/tags/paths` |
| Semantics | Glob match against ref or changed files | `rules:if` with `$CI_COMMIT_BRANCH`/`$CI_COMMIT_TAG`; `changes:paths` | filter arrays on trigger |
| Value type | string arrays (globs) | string arrays / expressions | `readonly string[]` |
| Limitations | `-ignore` variants for exclusion | no `-ignore` equivalent | no ignore variants in v0 |
| Provider gap | — | — | lowering drops `tags` + `paths` |

## GitHub Actions

```yaml
on:
  push:
    branches: [main, 'releases/**']
    tags: ['v*']
    paths: ['src/**']
    paths-ignore: ['docs/**']
```

`branches`/`tags` use glob patterns (`*`, `**`, `?`, `+`, `[abc]`, `!`).
`paths`/`paths-ignore` use glob patterns against changed files. `-ignore`
variants exclude matching refs/paths.

## GitLab CI

```yaml
build:
  rules:
    - if: $CI_PIPELINE_SOURCE == "push" && $CI_COMMIT_BRANCH == "main"
      changes:
        paths: ['src/**']
```

Branch filtering via `$CI_COMMIT_BRANCH`, tag filtering via `$CI_COMMIT_TAG`.
Path filtering via `rules:changes:paths`. No `-ignore` — use negated `if`
expressions or `changes` + `when: never`.

## Sverka proposal

### Portable model

`TriggerFilter` already exists in `@sverka/cdk` (`model.ts:8-12`):

```ts
interface TriggerFilter {
  readonly branches?: readonly string[];
  readonly tags?: readonly string[];
  readonly paths?: readonly string[];
}
```

Applied to all trigger kinds via `trigger.filter`. No `-ignore` variant in v0 —
propose adding `branchesIgnore`/`tagsIgnore`/`pathsIgnore` as a follow-up (M1).

### Authoring API

```ts
// SDK — trigger factory functions accept an optional filter
import { push } from "@sverka/sdk/context"; // actually from @sverka/cdk re-export
push({ branches: ["main"], tags: ["v*"], paths: ["src/**"] });

// Construct
new Entry(pipeline, {
  trigger: { kind: "push", filter: { branches: ["main"], paths: ["src/**"] } },
  roots: ["build"],
});

// Decorator
@entry({ trigger: { kind: "push", filter: { branches: ["main"] } }, roots: ["build"] })
```

### Lowering

- **GitHub target:** `filter.branches` → `branches:` array. `filter.tags` →
  `tags:` array. `filter.paths` → `paths:` array. **GAP:** current
  `lowerGithub` (`github/lower.ts:198-210`) only collects `branches` — `tags`
  and `paths` are dropped. Fix: extend `collectBranches` to handle all three.
- **GitLab target:** `filter.branches` → `&& $CI_COMMIT_BRANCH == "..."`.
  `filter.tags` → `&& $CI_COMMIT_TAG == "..."`. `filter.paths` →
  `rules:changes:paths`. **GAP:** current `buildSourceRule`
  (`gitlab/lower.ts:333-347`) only handles `branches`.
- **Native engine:** filters are advisory metadata — native execution is
  manual (`sverka run`). No filtering applied.

### Capability manifest

```ts
"trigger.filter.branches": "native",
"trigger.filter.tags": "native",       // model exists, lowering missing
"trigger.filter.paths": "native",      // model exists, lowering missing
```

### Portability & divergence

GitHub uses glob patterns; GitLab uses exact string comparisons for branches
(`$CI_COMMIT_BRANCH == "main"`) and `changes:paths` for paths. Sverka stores
raw string arrays and lowers them to each provider's syntax. Glob-to-exact
conversion for GitLab branch filters is a known limitation (GitLab doesn't
support glob branch matching in `rules:if`).

## Non-goals

- `-ignore` variants (defer to M1).
- Glob pattern translation between providers (GitLab branch matching is exact).

## Dependencies

- **Depends on:** F-02 (push), F-03 (change request) — filters attach to triggers.
- **Blocks:** none.

## Open questions

- Should `paths` use glob or exact matching in the portable model?
- Should `-ignore` variants be added now or in M1?

## References

- GitHub: https://docs.github.com/en/actions/using-workflows/workflow-syntax-for-github-actions#onpushpush_branchespush_branches-ignorepathspaths-ignore
- GitLab: https://docs.gitlab.com/ee/ci/yaml/#ruleschanges
- Architecture spec: §13, §31.3
- Source: `packages/cdk/src/model.ts:8-12`, `packages/github/src/lower.ts:198-237`, `packages/gitlab/src/lower.ts:300-347`
