# Feature: Workflow rules & auto-cancel

**ID:** F-42
**Category:** workflow-control
**Milestone:** M1
**Status:** Proposed
**Parent epic:** sv-4wh9

## Summary

Workflow-level rules control whether an entire pipeline runs. GitLab uses `workflow:rules` with `if`, `changes`, `exists`, and `when`. GitHub has no direct equivalent — workflow-level `if` doesn't exist; triggers with filters serve a similar purpose. Sverka needs a portable pipeline-level gate.

## Provider matrix

| Aspect | GitHub Actions | GitLab CI | Sverka (proposed) |
|--------|---------------|-----------|-------------------|
| Construct | trigger filters (approximate) | `workflow:rules` | `pipelineRules` on Pipeline |
| Semantics | Filter when workflow triggers | Determine if pipeline should run | Gate pipeline execution |
| Value type | trigger filter maps | array of rule objects | array of rule objects |
| Limitations | no workflow-level if | — | GitHub: emulated via trigger filters |
| Provider gap | no workflow-level rules | — | — |

## GitLab CI

```yaml
workflow:
  rules:
    - if: $CI_COMMIT_BRANCH == "main"
      variables:
        DEPLOY_TARGET: production
    - if: $CI_PIPELINE_SOURCE == "merge_request_event"
    - when: never
```

`workflow:rules` determines whether the pipeline runs at all. If no rule matches, the pipeline is not created. Per-rule `variables` set pipeline-level variables.

## GitHub Actions

No workflow-level `if`. The closest equivalent is trigger filters:

```yaml
on:
  push:
    branches: [main]
  pull_request:
    branches: [main]
```

This filters when the workflow triggers, but doesn't support the full `rules` model (no `exists`, no per-rule variables, no `when: never` fallback).

## Sverika proposal

### Portable model

```ts
interface PipelineRule {
  readonly if?: ExpressionString;
  readonly changes?: readonly string[];
  readonly exists?: readonly string[];
  readonly variables?: Record<string, string>;
  readonly when?: "always" | "never";
}
```

Pipeline gets optional `rules?: readonly PipelineRule[]`.

### Authoring API

```ts
defineWorkflow({
  name: "CI",
  pipelineRules: [
    { if: expr`${git.branch} == "main"`, variables: { DEPLOY_TARGET: "production" } },
    { if: expr`${event.source} == "merge_request"`, when: "always" },
    { when: "never" },
  ],
  workflow: pipeline(...),
}),
```

### Lowering

- **GitHub target:** `pipelineRules` → no direct equivalent. Approximate: if rules are static (branch/tag/source checks), translate to trigger filters. If rules use `exists` or `when: never` fallback, emit warning that GitHub doesn't support workflow-level rules.
- **GitLab target:** `pipelineRules` → `workflow:rules:` array. Direct mapping.
- **Native engine:** evaluate pipeline rules before execution. If no rule matches, skip the pipeline.

### Capability manifest

```ts
"workflow.rules": "native",          // GitLab
"workflow.rules": "partial",         // GitHub (trigger filters approximation)
```

### Portability & divergence

GitLab's `workflow:rules` is a pipeline-level gate. GitHub has no equivalent — trigger filters approximate the `if` condition but don't support `exists`, `when: never`, or per-rule `variables`. Sverka lowers what it can to GitHub trigger filters and warns about unsupported features.

## Non-goals

- `workflow:auto_cancel` (covered by F-29).
- `workflow:name` (covered by F-01).
- Per-rule `needs` (GitLab-specific).

## Dependencies

- **Depends on:** F-41 (rules — same model, pipeline scope), F-35 (expressions).
- **Blocks:** none.

## Open questions

- Should pipeline rules and step rules share the same interface?
- Should the GitHub approximation be best-effort or should it refuse to lower unsupported rules?
- Should pipeline rules support `changes` (GitLab-only)?

## References

- GitLab: https://docs.gitlab.com/ee/ci/yaml/#workflowrules
- Architecture spec: §25, §32 (deferred)
