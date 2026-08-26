# Feature: Reusable workflows & pipelines

**ID:** F-31
**Category:** reusable
**Milestone:** M2
**Status:** Proposed
**Parent epic:** sv-4wh9

## Summary

Reusable workflows let you define a pipeline once and call it from multiple places. GitHub uses `workflow_call` trigger with `uses`, `with`, and `secrets`. GitLab uses `include` (config merging) and `trigger:include` (child pipelines). The models are structurally different — GitHub calls workflows as jobs; GitLab merges configs at parse time.

## Provider matrix

| Aspect | GitHub Actions | GitLab CI | Sverka (proposed) |
|--------|---------------|-----------|-------------------|
| Construct | `workflow_call` + `uses` + `with` + `secrets` | `include` + `trigger:include` | `pipeline()` composition |
| Semantics | Reusable workflow called as a job | Config merged at parse time or child pipeline triggered | Compose pipelines as steps |
| Value type | workflow file ref + inputs + secrets | file refs + inputs | pipeline ref + inputs |
| Limitations | max 10 levels of workflows (including caller) | include merges flatly | — |
| Provider gap | call-based | merge-based | different composition models |

## GitHub Actions

```yaml
# reusable-workflow.yml
on:
  workflow_call:
    inputs:
      env:
        type: string
        required: true
    secrets:
      API_KEY:
        required: true

jobs:
  deploy:
    steps:
      - run: deploy ${{ inputs.env }}

# caller workflow
jobs:
  deploy-staging:
    uses: ./.github/workflows/reusable-workflow.yml
    with:
      env: staging
    secrets:
      API_KEY: ${{ secrets.STAGING_API_KEY }}
```

## GitLab CI

```yaml
# config.yml
include:
  - project: group/shared
    file: deploy.yml
    inputs:
      env: staging

# deploy.yml
spec:
  inputs:
    env:
      type: string

deploy:
  script: deploy $[[ inputs.env ]]
```

## Sverka proposal

### Portable model

Sverka's `pipeline()` is the reusable unit. A pipeline can be composed into another pipeline as a step. The composed pipeline receives inputs and produces outputs.

```ts
interface ReusablePipeline {
  readonly pipeline: PipelineDefinition;
  readonly inputs: Record<string, unknown>;
}
```

### Authoring API

```ts
// Define a reusable pipeline
const deploy = definePipeline({
  name: "deploy",
  inputs: { env: { type: "string", required: true } },
  workflow: pipeline(
    task("deploy", { run: sh`deploy ${inputs.env}` }),
  ),
});

// Use it
defineWorkflow({
  name: "CI",
  workflow: pipeline(
    task("build", { run: sh`make build` }),
    deploy({ env: "staging" }),
  ),
}),
```

### Lowering

- **GitHub target:** reusable pipeline → separate workflow file with `on: workflow_call`. Call site → `jobs.<id>.uses:` with `with:` and `secrets:`.
- **GitLab target:** reusable pipeline → separate YAML file with `spec:inputs`. Call site → `include:` with `inputs:`.
- **Native engine:** inline the pipeline at the call site. Inputs are passed as environment variables.

### Capability manifest

```ts
"reusable.pipeline": "native",
"reusable.pipeline.inputs": "native",
"reusable.pipeline.outputs": "native",
```

### Portability & divergence

GitHub calls reusable workflows as jobs (separate execution context). GitLab merges included configs at parse time (same execution context). Sverka's portable model is composition-based — the pipeline is a unit that can be inlined or called. The lowering strategy differs per provider.

## Non-goals

- Cross-repository workflow calls (F-34).
- Dynamic child pipelines (F-33).
- Reusable components (F-32).

## Dependencies

- **Depends on:** F-47 (typed inputs).
- **Blocks:** F-32 (components), F-33 (child pipelines), F-34 (downstream projects).

## Open questions

- Should reusable pipelines be inlined at synthesis time or kept as references in the IR?
- How are outputs from reusable pipelines propagated to the caller?
- Should there be a limit on nesting depth?

## References

- GitHub: https://docs.github.com/en/actions/using-workflows/reusing-workflows
- GitLab: https://docs.gitlab.com/ee/ci/yaml/#include
- GitLab: https://docs.gitlab.com/ee/ci/yaml/#trigger
- Architecture spec: §25, §32 (deferred)
