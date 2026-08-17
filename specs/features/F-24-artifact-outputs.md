# Feature: Artifact outputs

**ID:** F-24
**Category:** artifacts
**Milestone:** M0 (already in v0)
**Status:** Proposed
**Parent epic:** sv-4wh9

## Summary

Artifact outputs are files or directories produced by a step and made
available to downstream steps. GitHub uses `actions/upload-artifact`;
GitLab uses `artifacts:paths`. Sverka models artifact outputs as
`OutputDeclaration` with `type: "artifact"` and a `path`, captured via
`exportArtifact` operations and transferred by the native engine's
`ArtifactStore`.

## Provider matrix

| Aspect | GitHub Actions | GitLab CI | Sverka (proposed) |
|--------|---------------|-----------|-------------------|
| Construct | `actions/upload-artifact@v4` | `artifacts:paths` | `OutputDeclaration` (type: artifact, path) |
| Semantics | action uploads files to GitHub storage | job artifacts stored by GitLab | step writes files, engine copies to ArtifactStore |
| Value type | action `with` (name, path) | string array (paths) | typed: artifact + path |
| Limitations | 14-day retention default | `expire_in` configurable | no expiry in v0 |
| Provider gap | — | — | — |

## GitHub Actions

```yaml
jobs:
  build:
    steps:
      - run: mkdir dist && echo "built" > dist/output.txt
      - uses: actions/upload-artifact@v4
        with:
          name: build-dist
          path: dist/
```

`actions/upload-artifact@v4` uploads files/directories to GitHub-hosted
storage. Downloaded by downstream jobs via `actions/download-artifact@v4`.

## GitLab CI

```yaml
build:
  script: [mkdir dist && echo "built" > dist/output.txt]
  artifacts:
    paths: [dist/]
```

`artifacts:paths` specifies files/directories to store. Artifacts are
automatically passed to jobs that declare `needs` or `dependencies`.

## Sverka proposal

### Portable model

`OutputDeclaration` with `type: "artifact"` and `path: string`
(`cdk/model.ts:77-81`). The path is relative to the step workspace.
Synthesis emits `{ kind: "exportArtifact", name, path }` operations
(`core/graph.ts:66`). Artifact outputs must have a path — validation in
`cdk/constructs.ts:18-31` and `core/synthesize.ts:133-141`.

### Authoring API

```ts
// SDK — artifact() helper
import { sh, artifact } from "@sverka/sdk";
sh`mkdir dist && echo "built" > dist/output.txt`
  .outputs({ dist: artifact("dist/") })
  .build(pipeline, "build");

// Construct
new ShellStep(pipeline, "build", {
  command: "mkdir dist && echo built > dist/output.txt",
  outputs: { dist: { type: "artifact", path: "dist/" } },
});

// Decorator
@step({ outputs: { dist: { type: "artifact", path: "dist/" } } })
```

### Lowering

- **GitHub target:** `exportArtifact` → `actions/upload-artifact@v4` step
  with `name: <stepId>-<outputName>`, `path: <path>`
  (`github/lower.ts:374-380`). Preceding `run:` steps are flushed first.
- **GitLab target:** `exportArtifact` → `artifacts:paths: [<path>]`
  (`gitlab/lower.ts:502-503`). All artifact paths collected into one
  `artifacts` block per job.
- **Native engine:** `StepExecutor.executeExportArtifactOperation`
  (`engine-native/step-executor.ts:156-165`) copies the source path to
  `ArtifactStore.store(stepId, name, sourcePath)`. The `ArtifactStore`
  (`engine-native/artifact-store.ts:10-48`) is filesystem-backed — copies
  files/directories recursively, refuses symlinks, prevents path escape.

### Capability manifest

```ts
"output.artifact": "native",
```

### Portability & divergence

GitHub uses a dedicated action for upload/download; GitLab uses `artifacts`
with implicit passing via `needs`. Sverka's `exportArtifact` operation maps
cleanly to both. The native engine uses direct filesystem copy — no
archive/extract overhead.

Artifact naming in GitHub is `<shortStepId>-<outputName>` (e.g.
`build-dist`). This is deterministic but not user-configurable.

## Non-goals

- Artifact expiry / retention (F-26, M1).
- Typed artifact reports (F-46, M1).
- Artifact access control (F-26).

## Dependencies

- **Depends on:** F-09 (shell ops), F-07 (DAG deps — artifact deps).
- **Blocks:** F-25 (artifact import — consuming artifacts).

## Open questions

- Should artifact names be user-configurable instead of `<stepId>-<name>`?
- Should the native engine support artifact compression/archiving?

## References

- GitHub: https://docs.github.com/en/actions/using-workflows/workflow-syntax-for-github-actions#jobsjob_idstepsuses
- GitLab: https://docs.gitlab.com/ee/ci/yaml/#artifacts
- Architecture spec: §12.2, §15
- Source: `packages/cdk/src/model.ts:77-81`, `packages/sdk/src/artifact.ts:1-9`, `packages/core/src/graph.ts:66`, `packages/core/src/synthesize.ts:133-141`, `packages/github/src/lower.ts:374-380`, `packages/gitlab/src/lower.ts:502-503`, `packages/engine-native/src/step-executor.ts:156-165`, `packages/engine-native/src/artifact-store.ts:10-48`
