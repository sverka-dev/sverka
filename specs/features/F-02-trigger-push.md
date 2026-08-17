# Feature: Push trigger

**ID:** F-02
**Category:** triggers
**Milestone:** M0 (already in v0)
**Status:** Proposed
**Parent epic:** sv-4wh9

## Summary

The push trigger starts a pipeline when commits are pushed to the repository. Both GitHub Actions and GitLab CI support this natively. Sverka already maps `trigger.push` in the 08/09 target specs. This spec formalizes the portable model and identifies gaps in the current lowering.

## Provider matrix

| Aspect | GitHub Actions | GitLab CI | Sverka (proposed) |
|--------|---------------|-----------|-------------------|
| Construct | `on: push` | `rules: if $CI_PIPELINE_SOURCE == "push"` | `trigger.push` |
| Semantics | Runs on push to any or filtered branches/tags | Runs when pipeline source is push | Pipeline starts on push event |
| Value type | string or map with filters | rule expression | trigger kind + optional filters |
| Limitations | branch/tag/path filters via globs | branch filter via `$CI_COMMIT_BRANCH` | filters via F-06 |
| Provider gap | — | — | current lowering omits branch/tag/path filters |

## GitHub Actions

```yaml
on:
  push:
    branches:
      - main
      - 'releases/**'
    paths:
      - 'src/**'
```

The `push` event supports `branches`, `branches-ignore`, `tags`, `tags-ignore`, `paths`, `paths-ignore` filters. Glob patterns use `*`, `**`, `?`, `+`, `!`.

## GitLab CI

```yaml
build:
  rules:
    - if: $CI_PIPELINE_SOURCE == "push" && $CI_COMMIT_BRANCH == "main"
  script:
    - echo "building"
```

GitLab uses `rules:if` with `$CI_PIPELINE_SOURCE` and `$CI_COMMIT_BRANCH` / `$CI_COMMIT_TAG` variables. Path filtering uses `rules:changes:paths`.

## Sverka proposal

### Portable model

The Definition Graph `Entry` node already supports `trigger: { kind: "push" }`. Add optional `filter` object (see F-06) for branch/tag/path filtering.

### Authoring API

```ts
// SDK
defineWorkflow({
  name: "CI",
  workflow: pipeline(...),
  triggers: [trigger.push()],
});

// With filters
triggers: [trigger.push({ branches: ["main"], paths: ["src/**"] })],

// Construct
new Entry(pipeline, { trigger: { kind: "push" } });

// Decorator
@entry({ trigger: { kind: "push" } })
```

### Lowering

- **GitHub target:** `trigger.push` → `on: push`. Filters → `branches`/`tags`/`paths` keys.
- **GitLab target:** `trigger.push` → `rules: if: $CI_PIPELINE_SOURCE == "push"`. Branch filters → `&& $CI_COMMIT_BRANCH == "main"`. Path filters → `rules:changes:paths`.
- **Native engine:** push trigger is manual-only (user runs `sverka run`). No event detection.

### Capability manifest

```ts
"trigger.push": "native",
```

### Portability & divergence

Both providers support push natively. The divergence is in filter syntax (glob vs variable expressions) — handled by F-06. Current 08/09 specs lower the trigger kind but omit filters. This spec formalizes the filter integration.

## Non-goals

- Push event activity types (GitHub has none for push).
- Webhook-level configuration.

## Dependencies

- **Depends on:** F-06 (filters) for branch/tag/path filtering.
- **Blocks:** none.

## Open questions

- Should the current 08/09 specs be amended to include filter lowering, or should that be a separate task?

## References

- GitHub: https://docs.github.com/en/actions/using-workflows/workflow-syntax-for-github-actions#onpushpush_branchespush_branches-ignorepathspaths-ignore
- GitLab: https://docs.gitlab.com/ee/ci/yaml/#rules
- Architecture spec: §25, §31.3
