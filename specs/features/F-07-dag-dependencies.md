# Feature: Step DAG & dependencies

**ID:** F-07
**Category:** scheduling
**Milestone:** M0 (already in v0)
**Status:** Proposed
**Parent epic:** sv-4wh9

## Summary

Steps depend on other steps for ordering, scalar values, or artifacts. Sverka
models three dependency kinds — control, value, and artifact — in the
Definition Graph. Both targets lower all dependencies to `needs`. The engine
schedules steps in topological order.

## Provider matrix

| Aspect | GitHub Actions | GitLab CI | Sverka (proposed) |
|--------|---------------|-----------|-------------------|
| Construct | `jobs.<id>.needs` | `needs` | `Dependency` (control/value/artifact) |
| Semantics | job waits for named jobs | job waits for named jobs | typed dep with producer + optional output |
| Value type | string or array of strings | string or array | `Dependency` union |
| Limitations | no value passing (artifacts only) | artifacts via `needs` + dependencies | value deps resolved in-memory by engine |
| Provider gap | — | — | all deps flatten to `needs` (value/artifact lost) |

## GitHub Actions

```yaml
jobs:
  build:
    runs-on: ubuntu-latest
    steps: [{ run: echo build }]
  test:
    needs: build
    runs-on: ubuntu-latest
    steps: [{ run: echo test }]
```

`needs` creates a job DAG. GitHub has no native value passing between jobs —
artifacts or outputs are required.

## GitLab CI

```yaml
build:
  stage: build
  script: [echo build]
test:
  stage: stage-1
  needs: [build]
  script: [echo test]
```

`needs` creates a cross-stage dependency. Artifacts from needed jobs are
available if `dependencies` is set or `needs` is used (implicit artifact pass).

## Sverka proposal

### Portable model

The Definition Graph models three dependency kinds
(`core/graph.ts:79-82`):

```ts
type Dependency =
  | { kind: "control"; producer: string }
  | { kind: "value"; producer: string; output: string }
  | { kind: "artifact"; producer: string; output: string };
```

- **Control:** explicit `dependsOn` on a Step — ordering only.
- **Value:** a `StepRef` with type `string`/`number`/`boolean` in `inputs` —
  scalar value consumed from a producer's output.
- **Artifact:** a `StepRef` with type `artifact` in `inputs` — file/directory
  consumed from a producer's artifact output.

Synthesis (`core/synthesize.ts:148-205`) generates these: `dependsOn` → control
dep; `StepRef` in inputs → value or artifact dep; a more-specific dep replaces
a control dep for the same producer.

### Authoring API

```ts
// SDK — sh builder
sh`echo build`.build(pipeline, "build")
sh`echo test`.dependsOn(["build"]).build(pipeline, "test")

// Value dependency via StepRef interpolation
sh`echo ${buildRef.result}`.build(pipeline, "test") // auto-creates value dep

// Construct
new ShellStep(pipeline, "test", {
  command: "echo test",
  dependsOn: ["build"],          // control dep
  inputs: [stepRef("build", "result", "string")], // value dep
});

// Decorator
@step({ dependsOn: ["build"] })
```

### Lowering

- **GitHub target:** all dependency kinds → `needs` array
  (`github/lower.ts:309-326`). Value/artifact distinction is lost — GitHub
  jobs communicate via artifacts/outputs, not in-memory values.
- **GitLab target:** all dependency kinds → `needs` array
  (`gitlab/lower.ts:395-468`). `importArtifact` operations also add `needs`
  for the producer job.
- **Native engine:** Scheduler (`engine-native/scheduler.ts`) topologically
  sorts steps by dependencies. Value deps resolved via `ValueStore`; artifact
  deps resolved via `ArtifactStore`.

### Capability manifest

```ts
"graph.dependencies": "native",
```

### Portability & divergence

GitHub and GitLab both flatten dependencies to `needs`. Sverka's typed
dependency model (control/value/artifact) is richer — the engine uses the
distinction for in-memory value transfer, but targets lose it. This is
acceptable: targets need ordering (`needs`); value/artifact transfer is
handled by output/artifact operations, not the dependency edge itself.

## Non-goals

- Conditional dependencies (F-11).
- Failure-tolerant dependencies / `continue-on-error` (F-12).

## Dependencies

- **Depends on:** F-09 (shell ops) — steps contain shell operations.
- **Blocks:** F-08 (stages — GitLab stages derived from dependency depth).

## Open questions

- Should targets emit GitHub `outputs` for value deps to enable cross-job
  value passing, or is artifact-only sufficient?

## References

- GitHub: https://docs.github.com/en/actions/using-workflows/workflow-syntax-for-github-actions#jobsjob_idneeds
- GitLab: https://docs.gitlab.com/ee/ci/yaml/#needs
- Architecture spec: §11.4, §16
- Source: `packages/core/src/graph.ts:79-82`, `packages/core/src/synthesize.ts:148-205`, `packages/github/src/lower.ts:309-326`, `packages/gitlab/src/lower.ts:395-468`
