# Feature: Downstream project pipelines

**ID:** F-34
**Category:** reusable
**Milestone:** M2
**Status:** Proposed
**Parent epic:** sv-4wh9

## Summary

Downstream project pipelines trigger CI in another repository or project. GitLab supports this natively via `trigger:project`. GitHub uses `repository_dispatch` event or cross-repo `workflow_call`. Sverka needs a portable downstream trigger model.

## Provider matrix

| Aspect | GitHub Actions | GitLab CI | Sverka (proposed) |
|--------|---------------|-----------|-------------------|
| Construct | `repository_dispatch` | `trigger:project` | `trigger.downstream` |
| Semantics | Send dispatch event to another repo | Trigger pipeline in another project | Trigger pipeline in another project |
| Value type | event + repo | project path + branch | project ref + inputs |
| Limitations | requires workflow listening for dispatch | requires API token | — |
| Provider gap | — | — | different trigger mechanisms |

## GitHub Actions

```yaml
steps:
  - run: |
      gh api repos/other-org/other-repo/dispatches \
        -f event_type=sverka-trigger \
        -f client_payload='{"env":"staging"}'
```

GitHub uses `repository_dispatch` API to trigger workflows in other repos. The target repo must have a workflow listening for `repository_dispatch`.

## GitLab CI

```yaml
trigger_downstream:
  trigger:
    project: group/other-project
    branch: main
    inputs:
      env: staging
  variables:
    DOWNSTREAM_ENV: staging
```

GitLab natively supports multi-project pipelines via `trigger:project`. The trigger job waits for the downstream pipeline (with `strategy: depend`).

## Sverka proposal

### Portable model

```ts
interface DownstreamTrigger {
  readonly project: string;        // org/repo or group/project
  readonly branch?: string;
  readonly inputs?: Record<string, unknown>;
}
```

### Authoring API

```ts
task("trigger-downstream", {
  trigger: { downstream: { project: "group/other-project", branch: "main", inputs: { env: "staging" } } },
}),
```

### Lowering

- **GitHub target:** `trigger.downstream` → step that calls `gh api repos/<project>/dispatches` with event type and client payload. Requires `gh` CLI and `GITHUB_TOKEN` with appropriate scope.
- **GitLab target:** `trigger.downstream` → `trigger: project: <project>, branch: <branch>`. Inputs → `inputs:`. Add `strategy: depend` to wait for completion.
- **Native engine:** not applicable (no cross-project triggering locally).

### Capability manifest

```ts
"reusable.downstream": "native",       // GitLab
"reusable.downstream": "emulated",     // GitHub (via API call)
```

### Portability & divergence

GitLab has native multi-project pipeline support. GitHub requires an API call via `gh` CLI. Sverka emulates on GitHub by generating a dispatch API call step. The semantic difference: GitLab's trigger job waits for the downstream pipeline; GitHub's dispatch is fire-and-forget (the caller doesn't wait for the downstream workflow to complete).

## Non-goals

- Downstream pipeline status mirroring (`trigger:strategy: mirror`).
- Cross-provider triggering (GitHub → GitLab or vice versa).
- Downstream artifact download (`needs:project`).

## Dependencies

- **Depends on:** F-31 (reusable workflows).
- **Blocks:** none.

## Open questions

- Should the GitHub emulation wait for the downstream workflow to complete?
- Should cross-provider triggering be supported?
- How are authentication tokens handled for downstream projects?

## References

- GitLab: https://docs.gitlab.com/ee/ci/yaml/#triggerproject
- GitHub: https://docs.github.com/en/actions/using-workflows/events-that-trigger-workflows#repository_dispatch
- Architecture spec: §25, §32 (deferred)
