# Feature: Workflow naming & run name

**ID:** F-01
**Category:** workflow-control
**Milestone:** M0 (already in v0)
**Status:** Proposed
**Parent epic:** sv-4wh9

## Summary

Every pipeline has a display name shown in the provider UI. GitHub also supports a per-run name that can include expressions (e.g. "Deploy to prod by @${{ github.actor }}"). GitLab supports a pipeline name via `workflow:name` with CI/CD variables. Sverka already has a `name` field on the workflow; this spec proposes adding an optional `runName` expression field for per-run naming.

## Provider matrix

| Aspect | GitHub Actions | GitLab CI | Sverka (proposed) |
|--------|---------------|-----------|-------------------|
| Construct | `name`, `run-name` | `workflow:name` | `name`, `runName` |
| Semantics | `name` = workflow display; `run-name` = per-run display with expressions | `workflow:name` = pipeline display name with variables | `name` = pipeline display; `runName` = per-run expression |
| Value type | string (both) | string or CI/CD variable | string (name), expression string (runName) |
| Limitations | `run-name` only in GitHub | `workflow:name` only in GitLab | `runName` optional, lowered where supported |
| Provider gap | — | no per-run name equivalent | `runName` lowers to GitHub `run-name`, omitted on GitLab |

## GitHub Actions

`name` sets the workflow display name in the Actions tab. `run-name` sets the per-run name in the run list, can include expressions.

```yaml
name: CI
run-name: Deploy to ${{ inputs.target }} by @${{ github.actor }}
on: push
jobs:
  build:
    runs-on: ubuntu-latest
    steps:
      - run: echo "building"
```

Gotcha: if `name` is omitted, GitHub uses the file path. If `run-name` is omitted, GitHub uses event-specific info (commit message or PR title).

## GitLab CI

`workflow:name` sets the pipeline display name. Can use CI/CD variables.

```yaml
workflow:
  name: "Pipeline for $CI_COMMIT_BRANCH"
stages:
  - build
build:
  stage: build
  script:
    - echo "building"
```

Gotcha: GitLab has no per-run name concept — the pipeline name is set once per pipeline.

## Sverka proposal

### Portable model

The Definition Graph's `PipelineDefinition` (`core/graph.ts:38-44`) has an `id`
field (the construct path, e.g. `"ci"`) but no display `name` field. The compat
`WorkflowDefinition` (`sdk/src/types.ts:13`) has `name: string` for
`sverka.config.ts`. Propose: add an optional `name?: string` to `PipelineProps`
(defaulting to the construct `id`) and an optional `runName?: ExpressionString`
for per-run naming. When `runName` is present, it carries an expression that
evaluates at runtime to produce a per-run display name.

### Authoring API

```ts
// SDK
defineWorkflow({
  name: "CI",
  runName: expr`Deploy to ${inputs.target} by @${git.actor}`,
  workflow: pipeline(...),
});

// Construct
const project = new Project("ci");
const pipeline = new Pipeline(project, "CI", {
  runName: expr`Deploy to ${inputs.target}`,
});

// Decorator
@pipeline({ name: "CI", runName: expr`Deploy to ${inputs.target}` })
class CI { ... }
```

### Lowering

- **GitHub target:** `name` → `name:`, `runName` → `run-name:` with expression translation.
- **GitLab target:** `name` → `workflow:name:` with variable translation. `runName` omitted (no equivalent); emit a diagnostic at `info` level.
- **Native engine:** `name` used in CLI output. `runName` evaluated and displayed in run output.

### Capability manifest

```ts
"workflow.name": "native",
"workflow.runName": "native",  // GitHub only; GitLab unsupported
```

### Portability & divergence

`runName` is GitHub-only. On GitLab, the target emits `workflow:name` from the static `name` field and drops `runName` with an info diagnostic. No portable fallback needed — `runName` is cosmetic.

## Non-goals

- Dynamic name generation via arbitrary TypeScript functions (only expression strings).
- GitLab pipeline name with complex variable expressions beyond what `workflow:name` supports.

## Dependencies

- **Depends on:** F-35 (expressions) — `runName` uses expression syntax.
- **Blocks:** none.

## Open questions

- Should `runName` be evaluated by the native engine or passed through as a template?
- Should GitLab `workflow:name` support be added even without `runName`?

## References

- GitHub: https://docs.github.com/en/actions/using-workflows/workflow-syntax-for-github-actions#name
- GitLab: https://docs.gitlab.com/ee/ci/yaml/#workflowname
- Architecture spec: §25 (Feature Matrix)
