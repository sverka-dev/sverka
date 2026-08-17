# Feature: Dynamic child pipelines

**ID:** F-33
**Category:** reusable
**Milestone:** M2
**Status:** Proposed
**Parent epic:** sv-4wh9

## Summary

Dynamic child pipelines are generated at runtime — a step produces a YAML file that becomes a new pipeline. GitLab supports this natively via `trigger:include` with `artifact`. GitHub has `workflow_run` (triggers after another workflow) but no native dynamic generation. Sverka needs a portable dynamic pipeline model.

## Provider matrix

| Aspect | GitHub Actions | GitLab CI | Sverka (proposed) |
|--------|---------------|-----------|-------------------|
| Construct | `workflow_run` (limited) | `trigger:include` + `artifact` | `trigger.childPipeline` |
| Semantics | Triggers workflow after another completes | Generates child pipeline from artifact YAML | Generate and trigger child pipeline |
| Value type | event ref | include ref + artifact path | generator step + pipeline ref |
| Limitations | no dynamic generation | child pipeline from generated YAML | — |
| Provider gap | no dynamic generation | — | GitHub: emulated or unsupported |

## GitHub Actions

```yaml
# Parent workflow
on: push
jobs:
  generate:
    outputs:
      matrix: ${{ steps.generate.outputs.matrix }}
    steps:
      - id: generate
        run: echo "matrix=..." >> "$GITHUB_OUTPUT"

  child:
    needs: generate
    uses: ./.github/workflows/child.yml
    with:
      matrix: ${{ needs.generate.outputs.matrix }}
```

GitHub doesn't support true dynamic child pipelines. The closest pattern is generating outputs and passing them to a reusable workflow.

## GitLab CI

```yaml
generate:
  script:
    - generate-pipeline > child-pipeline.yml
  artifacts:
    paths:
      - child-pipeline.yml

trigger_child:
  trigger:
    include:
      - artifact: child-pipeline.yml
        job: generate
```

GitLab generates a YAML file, declares it as an artifact, and triggers a child pipeline from it. The child pipeline is fully dynamic.

## Sverka proposal

### Portable model

```ts
interface ChildPipelineTrigger {
  readonly generator: string;        // step that produces the pipeline YAML
  readonly artifact: string;          // artifact name containing the YAML
}
```

### Authoring API

```ts
task("generate", {
  run: sh`generate-pipeline > child-pipeline.yml`,
  artifacts: [artifact("child-pipeline", "child-pipeline.yml")],
}),
task("trigger-child", {
  trigger: { childPipeline: { generator: "generate", artifact: "child-pipeline" } },
}).dependsOn("generate"),
```

### Lowering

- **GitHub target:** not natively supported. Emit warning: "Dynamic child pipelines are not supported by GitHub Actions. Consider using reusable workflows with generated inputs." Alternatively, emulate by generating a workflow file and committing it (not recommended).
- **GitLab target:** `trigger.childPipeline` → `trigger: include: [{ artifact: <path>, job: <generator> }]`.
- **Native engine:** execute the generator step, parse the produced YAML, create a sub-pipeline and execute it.

### Capability manifest

```ts
"reusable.childPipeline": "native",       // GitLab
"reusable.childPipeline": "unsupported",  // GitHub
```

### Portability & divergence

Dynamic child pipelines are a GitLab-specific feature with no GitHub equivalent. Sverka marks this as unsupported on GitHub with a clear diagnostic. The native engine can support it for local testing.

## Non-goals

- Parent-child pipeline variable forwarding (`trigger:forward`).
- Multi-project child pipelines (F-34).
- Child pipeline status mirroring.

## Dependencies

- **Depends on:** F-24 (artifact outputs), F-31 (reusable workflows).
- **Blocks:** none.

## Open questions

- Should the native engine support dynamic child pipelines?
- Is there a GitHub emulation path that doesn't require committing generated files?
- Should `trigger:forward` (GitLab) be in the portable model?

## References

- GitLab: https://docs.gitlab.com/ee/ci/yaml/#triggerinclude
- GitLab: https://docs.gitlab.com/ee/ci/parent_child_pipelines.html
- GitHub: https://docs.github.com/en/actions/using-workflows/events-that-trigger-workflows#workflow_run
- Architecture spec: §25, §32 (deferred)
