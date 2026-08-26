# Feature: Change request trigger

**ID:** F-03
**Category:** triggers
**Milestone:** M0 (already in v0)
**Status:** Proposed
**Parent epic:** sv-4wh9

## Summary

The change request trigger starts a pipeline when a pull request (GitHub) or merge request (GitLab) is opened, updated, or closed. Sverka calls this `trigger.changeRequest` to stay provider-neutral. Both providers support it natively. This spec formalizes the portable model and identifies gaps in activity type mapping.

## Provider matrix

| Aspect | GitHub Actions | GitLab CI | Sverka (proposed) |
|--------|---------------|-----------|-------------------|
| Construct | `on: pull_request` / `pull_request_target` | `rules: if $CI_PIPELINE_SOURCE == "merge_request_event"` | `trigger.changeRequest` |
| Semantics | Runs on PR activity types (opened, synchronize, reopened, closed, edited, labeled, etc.) | Runs on MR events | Pipeline starts on PR/MR event |
| Value type | string or map with `types` + branch/path filters | rule expression | trigger kind + optional activity types + filters |
| Limitations | `pull_request_target` runs in base branch context (security implications) | MR pipeline runs in merge ref, not target branch | no `pull_request_target` equivalent |
| Provider gap | `pull_request_target` has no GitLab equivalent | — | `pull_request_target` as provider extension |

## GitHub Actions

```yaml
on:
  pull_request:
    types:
      - opened
      - synchronize
    branches:
      - main
```

Activity types (illustrative, not exhaustive — see [GitHub docs](https://docs.github.com/en/actions/reference/workflows-and-actions/workflow-syntax#onpull_requestpull_request_target): `opened`, `synchronize`, `reopened`, `closed`, `edited`, `labeled`, `unlabeled`, `assigned`, `unassigned`, `review_requested`, `ready_for_review`, `converted_to_draft`, `milestoned`, `demilestoned`, `locked`, `unlocked`, `enqueued`, `dequeued`, `review_request_removed`, `auto_merge_enabled`, `auto_merge_disabled`.

`pull_request_target` is a separate event that runs in the base branch context with write token — security-sensitive.

## GitLab CI

```yaml
build:
  rules:
    - if: $CI_PIPELINE_SOURCE == "merge_request_event"
  script:
    - echo "building"
```

GitLab MR pipelines run in a merge ref (`refs/merge-requests/:iid/head`). No activity type filtering — the pipeline runs on any MR event (push to source branch, open, reopen, update).

## Sverka proposal

### Portable model

`Entry` node with `trigger: { kind: "changeRequest" }`. Add optional `activityTypes?: string[]` for GitHub activity type filtering (omitted = all types). Add optional `filter` object (F-06).

### Authoring API

```ts
// SDK
triggers: [trigger.changeRequest()],
triggers: [trigger.changeRequest({ activityTypes: ["opened", "synchronize"] })],

// Construct
new Entry(pipeline, { trigger: { kind: "changeRequest", activityTypes: ["opened"] } });

// Decorator
@entry({ trigger: { kind: "changeRequest" } })
```

### Lowering

- **GitHub target:** `trigger.changeRequest` → `on: pull_request`. `activityTypes` → `types:` array. Filters → `branches`/`paths`.
- **GitLab target:** `trigger.changeRequest` → `rules: if: $CI_PIPELINE_SOURCE == "merge_request_event"`. `activityTypes` omitted (GitLab has no equivalent) with info diagnostic. Branch filters → `$CI_MERGE_REQUEST_TARGET_BRANCH_NAME`.
- **Native engine:** not applicable (manual execution only).

### Capability manifest

```ts
"trigger.changeRequest": "native",
```

### Portability & divergence

`activityTypes` is GitHub-only. GitLab runs on all MR events — no way to filter to "opened only". Sverka lowers `activityTypes` on GitHub and drops it on GitLab with an info diagnostic.

`pull_request_target` is a security-sensitive GitHub variant with no GitLab equivalent. Propose as a GitHub provider extension (`github.native({ trigger: "pull_request_target" })`), not in the portable model.

## Non-goals

- `pull_request_target` in the portable model (provider extension only).
- MR-level approval gating.

## Dependencies

- **Depends on:** F-06 (filters) for branch/path filtering.
- **Blocks:** none.

## Open questions

- Should `activityTypes` be a typed enum or free-form strings?
- Should `pull_request_target` be exposed as a separate trigger kind or a flag on `changeRequest`?

## References

- GitHub: https://docs.github.com/en/actions/using-workflows/workflow-syntax-for-github-actions#onpull_requestpull_request_targetpathspaths-ignore
- GitLab: https://docs.gitlab.com/ee/ci/yaml/#rulesif
- Architecture spec: §25, §31.3
