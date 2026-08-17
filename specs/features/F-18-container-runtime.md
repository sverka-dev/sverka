# Feature: Container runtime

**ID:** F-18
**Category:** runner
**Milestone:** M0 (already in v0)
**Status:** Proposed
**Parent epic:** sv-4wh9

## Summary

The container runtime executes shell commands inside an OCI container for
isolation and reproducibility. GitHub Actions uses the `container` key;
GitLab CI uses `image`. Sverka models container as `Runtime.mode: "container"`
with an `image` field, and implements it via `DockerDriver` in the native
engine.

## Provider matrix

| Aspect | GitHub Actions | GitLab CI | Sverka (proposed) |
|--------|---------------|-----------|-------------------|
| Construct | `container` | `image` | `Runtime.mode: "container"` + `Runtime.image` |
| Semantics | job runs inside the named container | job runs inside the named image | step runs in Docker container |
| Value type | string or map (image, env, volumes) | string or map (name, entrypoint) | string (OCI ref) |
| Limitations | no digest pinning in v0 | no digest pinning in v0 | digest verification in native engine |
| Provider gap | — | — | — |

## GitHub Actions

```yaml
jobs:
  build:
    runs-on: ubuntu-latest
    container: node:22
    steps: [{ run: echo build }]
```

`container` runs all steps inside the specified image. The `runs-on` is still
required (selects the host runner that launches the container).

## GitLab CI

```yaml
build:
  image: node:22
  script: [echo build]
```

`image` selects the container image for the job. No `runs-on` equivalent —
the runner pulls and runs the image directly.

## Sverka proposal

### Portable model

`Runtime.mode: "container"` + `Runtime.image: string` (`cdk/model.ts:101-106`).
The image is an OCI reference string (e.g. `"node:22"`, `"ubuntu:latest"`).
Both targets require `image` when mode is `"container"` — a missing image
throws `LOWER_FAILED`.

### Authoring API

```ts
// SDK — with image helper
import { sh, image, images } from "@sverka/sdk";
sh`echo build`.runtime({ mode: "container", image: "node:22" }).build(pipeline, "build");
sh`echo build`.runtime({ mode: "container", image: images.node[22].ref }).build(pipeline, "build");

// Construct
new ShellStep(pipeline, "build", {
  command: "echo build",
  runtime: { mode: "container", image: "node:22" },
});

// Decorator
@step({ runtime: { mode: "container", image: "node:22" } })
```

### Lowering

- **GitHub target:** container mode → `container: <image>`
  (`github/lower.ts:279-290`). Missing image throws. `runs-on: ubuntu-latest`
  is still emitted (required to host the container).
- **GitLab target:** container mode → `image: <image>`
  (`gitlab/lower.ts:409-422`). Missing image throws.
- **Native engine:** `DockerDriver` (`runtime-docker/docker-driver.ts:19-59`).
  `canExecute` checks mode is `"container"` and image is non-empty. Execution
  via `docker run --rm --read-only --cap-drop=ALL --user=<uid:gid>
  --network=none` with workspace mounted at `/workspace`. Optional digest
  verification via `verifyImageDigest`. Timeout via `--stop-timeout`.

### Capability manifest

```ts
"runtime.container": "native",
```

### Portability & divergence

Both providers support container execution. GitHub still requires `runs-on`
(the host that runs the container); GitLab does not. Sverka hardcodes
`runs-on: ubuntu-latest` for GitHub container jobs.

The native `DockerDriver` applies security hardening (`--read-only`,
`--cap-drop=ALL`, `--network=none`) that neither provider applies by default.
This is stricter than compiled output — compiled pipelines run in the
provider's own container isolation.

## Non-goals

- Container services / sidecars (F-19, M1).
- Custom entrypoint or volumes.
- Container registry authentication (deferred).

## Dependencies

- **Depends on:** F-09 (shell ops).
- **Blocks:** none.

## Open questions

- Should `Runtime` support `imageDigest` for supply-chain pinning in compiled
  output (the native engine already supports it)?
- Should `--network=none` be configurable for steps that need network access?

## References

- GitHub: https://docs.github.com/en/actions/using-workflows/workflow-syntax-for-github-actions#jobsjob_idcontainer
- GitLab: https://docs.gitlab.com/ee/ci/yaml/#image
- Architecture spec: §14.1, §22.4
- Source: `packages/cdk/src/model.ts:101-106`, `packages/sdk/src/images.ts:1-36`, `packages/github/src/lower.ts:279-290`, `packages/gitlab/src/lower.ts:409-422`, `packages/runtime-docker/src/docker-driver.ts:19-101`
