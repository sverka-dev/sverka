# Feature: Typed inputs

**ID:** F-47
**Category:** workflow-control
**Milestone:** M1
**Status:** Proposed
**Parent epic:** sv-4wh9

## Summary

Typed inputs allow pipelines and reusable components to declare parameters with types, descriptions, defaults, and validation. GitHub uses `workflow_dispatch.inputs` and `workflow_call.inputs` with types (string, boolean, choice, number, environment). GitLab uses `spec:inputs` with types, defaults, options, regex validation, and rules. Sverka needs a portable typed input model.

## Provider matrix

| Aspect | GitHub Actions | GitLab CI | Sverka (proposed) |
|--------|---------------|-----------|-------------------|
| Construct | `inputs` (workflow_dispatch, workflow_call) | `spec:inputs` | `inputs` on Pipeline |
| Semantics | Declare typed parameters for workflow | Declare typed parameters for component/pipeline | Declare typed parameters |
| Value type | map with type, description, required, default, options | map with type, default, description, options, regex, rules | map with type, description, required, default, options |
| Limitations | limited types (string, boolean, choice, number, environment) | string, boolean, number, array, + regex validation | — |
| Provider gap | no regex validation | no `environment` type | — |

## GitHub Actions

```yaml
on:
  workflow_dispatch:
    inputs:
      environment:
        type: choice
        options: [staging, production]
        required: true
      debug:
        type: boolean
        default: false
      version:
        type: string
        description: "Version to deploy"
```

## GitLab CI

```yaml
spec:
  inputs:
    environment:
      type: string
      default: staging
      description: "Deployment environment"
      options: [staging, production]
      rules:
        - if: $ENV == "production"
          when: required
    version:
      type: string
      pattern: /^v\d+\.\d+\.\d+$/
      description: "Semantic version"
```

GitLab `spec:inputs` supports `type` (string, boolean, number, array), `default`, `description`, `options`, `pattern` (regex), and `rules` (conditional required).

## Sverka proposal

### Portable model

```ts
interface InputSpec {
  readonly type: "string" | "boolean" | "number" | "choice" | "array";
  readonly description?: string;
  readonly required?: boolean;
  readonly default?: string | boolean | number | readonly string[];
  readonly options?: readonly string[];       // for choice type
  readonly pattern?: string;                   // regex validation
}
```

Pipeline gets optional `inputs: Record<string, InputSpec>`.

### Authoring API

```ts
definePipeline({
  name: "deploy",
  inputs: {
    environment: {
      type: "choice",
      options: ["staging", "production"],
      required: true,
      description: "Deployment environment",
    },
    version: {
      type: "string",
      pattern: "^v\\d+\\.\\d+\\.\\d+$",
      description: "Semantic version",
    },
  },
  workflow: pipeline(...),
}),
```

### Lowering

- **GitHub target:** `inputs` → `workflow_dispatch.inputs` or `workflow_call.inputs`. `type` mapping: `choice` → `choice`, `boolean` → `boolean`, `number` → `number`, `string` → `string`, `array` → not supported (emit warning). `pattern` → not supported (emit warning). `options` → `options`.
- **GitLab target:** `inputs` → `spec:inputs`. `type` → `type`. `pattern` → `pattern`. `options` → `options`. `required` → `rules: [{ if: ..., when: required }]` or implicit. `choice` type → `type: string` with `options`.
- **Native engine:** validate inputs against specs before execution. Prompt for missing required inputs via CLI.

### Capability manifest

```ts
"workflow.inputs": "native",
"workflow.inputs.pattern": "native",       // GitLab
"workflow.inputs.pattern": "unsupported",  // GitHub
"workflow.inputs.array": "native",         // GitLab
"workflow.inputs.array": "unsupported",    // GitHub
```

### Portability & divergence

Both providers support typed inputs but with different type sets and validation features. GitLab has regex validation and array type. GitHub has `environment` type. Sverka normalizes to a union of both. `pattern` and `array` are GitLab-only. `environment` is GitHub-only (mapped to `choice`).

## Non-goals

- Input `rules` with conditional required logic (GitLab-specific, complex).
- Input propagation to child pipelines.
- Input transformation and normalization.

## Dependencies

- **Depends on:** F-04 (manual trigger — uses inputs), F-31 (reusable workflows — use inputs).
- **Blocks:** F-04, F-31, F-32, F-44.

## Open questions

- Should `environment` be a separate type or mapped to `choice`?
- Should `pattern` be validated at synthesis time or runtime?
- Should the native engine support interactive input prompts?

## References

- GitHub: https://docs.github.com/en/actions/using-workflows/workflow-syntax-for-github-actions#onworkflow_dispatchinputs
- GitHub: https://docs.github.com/en/actions/using-workflows/reusing-workflows#using-inputs-and-secrets-in-a-reusable-workflow
- GitLab: https://docs.gitlab.com/ee/ci/yaml/#specinputs
- Architecture spec: §25, §32 (deferred)
