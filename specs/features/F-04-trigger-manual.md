# Feature: Manual trigger

**ID:** F-04
**Category:** triggers
**Milestone:** M0 (already in v0)
**Status:** Proposed
**Parent epic:** sv-4wh9

## Summary

The manual trigger allows a user to start a pipeline by hand — via GitHub's "Run workflow" UI or GitLab's "Run pipeline" / manual job execution. Sverka already maps `trigger.manual` in the 08/09 specs. This spec proposes adding typed inputs so users can pass parameters when triggering manually.

## Provider matrix

| Aspect | GitHub Actions | GitLab CI | Sverka (proposed) |
|--------|---------------|-----------|-------------------|
| Construct | `on: workflow_dispatch` | `when: manual` + `rules` | `trigger.manual` |
| Semantics | Workflow runs from UI with typed inputs | Job runs when user clicks "play" | Pipeline starts on manual invocation |
| Value type | map with `inputs` (typed) | `when: manual` (boolean-ish) | trigger kind + optional typed inputs |
| Limitations | inputs: boolean, choice, number, environment, string | `manual_confirmation` for custom message | typed inputs lowered to GitHub, emulated on GitLab |
| Provider gap | — | no typed inputs on manual trigger | GitLab inputs via `spec:inputs` (different mechanism) |

## GitHub Actions

```yaml
on:
  workflow_dispatch:
    inputs:
      environment:
        type: choice
        options:
          - staging
          - production
        required: true
      debug:
        type: boolean
        default: false
```

Input types: `boolean`, `choice`, `number`, `environment`, `string`. Each input has `description`, `required`, `default`, `options` (for choice).

## GitLab CI

```yaml
deploy:
  when: manual
  manual_confirmation: "Deploy to production. Are you sure?"
  script:
    - echo "deploying"
```

GitLab manual jobs are per-job (`when: manual`), not per-pipeline. `manual_confirmation` adds a custom confirmation message. GitLab has no per-manual-trigger typed inputs — pipeline-level inputs use `spec:inputs` (for included configs) or CI/CD variables with `description`/`options`.

## Sverka proposal

### Portable model

`Entry` node with `trigger: { kind: "manual" }`. Add optional `inputs: Record<string, ManualInput>` where `ManualInput` has `type`, `description`, `required`, `default`, `options`.

```ts
interface ManualInput {
  readonly type: "string" | "boolean" | "number" | "choice";
  readonly description?: string;
  readonly required?: boolean;
  readonly default?: string | boolean | number;
  readonly options?: readonly string[]; // for choice type
}
```

### Authoring API

```ts
// SDK
triggers: [
  trigger.manual({
    inputs: {
      environment: { type: "choice", options: ["staging", "production"], required: true },
      debug: { type: "boolean", default: false },
    },
  }),
],

// Construct
new Entry(pipeline, {
  trigger: { kind: "manual", inputs: { env: { type: "string", required: true } } },
});

// Decorator
@entry({ trigger: { kind: "manual" } })
```

### Lowering

- **GitHub target:** `trigger.manual` → `on: workflow_dispatch`. `inputs` → `workflow_dispatch.inputs` with type mapping (choice→choice, boolean→boolean, number→number, string→string).
- **GitLab target:** `trigger.manual` → `rules: if: $CI_PIPELINE_SOURCE == "web"` (pipeline-level manual). `inputs` → CI/CD variables with `description`/`options` at the `variables` level. `manual_confirmation` not lowered (per-job concept).
- **Native engine:** `sverka run` prompts for inputs via CLI, or accepts them via flags (`--input environment=staging`).

### Capability manifest

```ts
"trigger.manual": "native",
"trigger.manual.inputs": "native",  // GitHub; lowered on GitLab via variables
```

### Portability & divergence

GitHub has typed inputs at the workflow level. GitLab has per-job `when: manual` and pipeline-level `spec:inputs` — different mechanisms. Sverka's portable model uses GitHub-style typed inputs and lowers them to GitLab CI/CD variables with descriptions. The `environment` input type (GitHub-specific) maps to a `choice` type.

## Non-goals

- GitLab `when: manual` per-job manual execution (this is a job-level concept, not a trigger).
- Approval workflows and required reviewers.

## Dependencies

- **Depends on:** F-47 (typed inputs) — shares the input type model.
- **Blocks:** none.

## Open questions

- Should GitLab `when: manual` be a separate feature (job-level manual execution)?
- How should `environment` input type (GitHub-specific) be handled portably?

## References

- GitHub: https://docs.github.com/en/actions/using-workflows/workflow-syntax-for-github-actions#onworkflow_dispatchinputs
- GitLab: https://docs.gitlab.com/ee/ci/yaml/#when
- Architecture spec: §25, §31.3
