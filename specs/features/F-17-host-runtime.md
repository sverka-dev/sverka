# Feature: Host runtime

**ID:** F-17
**Category:** runner
**Milestone:** M0 (already in v0)
**Status:** Proposed
**Parent epic:** sv-4wh9

## Summary

The host runtime executes shell commands directly on the host machine — no
container isolation. GitHub Actions uses `runs-on` labels; GitLab CI uses the
runner's default environment. Sverka models host as `Runtime.mode: "host"`
(the default) and implements it via `HostDriver` in the native engine.

## Provider matrix

| Aspect | GitHub Actions | GitLab CI | Sverka (proposed) |
|--------|---------------|-----------|-------------------|
| Construct | `runs-on: ubuntu-latest` | no `image` key | `Runtime.mode: "host"` (default) |
| Semantics | job runs on a GitHub-hosted or self-hosted runner | job runs on runner default | step runs on host process |
| Value type | string or array of labels | n/a (implicit) | `"host"` enum |
| Limitations | runner image is fixed by label | runner environment varies | no runner labels in v0 |
| Provider gap | — | — | GitHub always emits `ubuntu-latest` (hardcoded) |

## GitHub Actions

```yaml
jobs:
  build:
    runs-on: ubuntu-latest
    steps: [{ run: echo build }]
```

`runs-on` selects the runner image. Common values: `ubuntu-latest`,
`macos-latest`, `windows-latest`, or self-hosted labels.

## GitLab CI

```yaml
build:
  script: [echo build]
  # no image key → runner default environment
```

When no `image` is specified, the job runs in the runner's default
environment (typically the shell on the runner host).

## Sverka proposal

### Portable model

`Runtime.mode?: "host" | "container"` (`cdk/model.ts:102`). When mode is
undefined or `"host"`, the step runs on the host. This is the default —
`Step.runtime` defaults to `{}` (`cdk/constructs.ts:113`).

### Authoring API

```ts
// SDK — host is the default, no explicit setting needed
sh`echo build`.build(pipeline, "build");

// Explicit
sh`echo build`.runtime({ mode: "host" }).build(pipeline, "build");

// Construct
new ShellStep(pipeline, "build", { command: "echo build", runtime: { mode: "host" } });

// Decorator
@step({ runtime: { mode: "host" } })
```

### Lowering

- **GitHub target:** host mode → `runs-on: ubuntu-latest` (hardcoded,
  `github/lower.ts:259`). **GAP:** runner label is not configurable — all
  host jobs emit `ubuntu-latest`. No support for `macos-latest` or
  self-hosted labels.
- **GitLab target:** host mode → no `image` key emitted
  (`gitlab/lower.ts:413-422`). The job runs in the runner's default
  environment.
- **Native engine:** `HostDriver` (`runtime-host/host-driver.ts:20-197`).
  `canExecute` checks mode is undefined or `"host"` and the command binary is
  in the allowlist. Commands are spawned with `shell: false` (direct exec,
  no shell interpretation). Env is built from `envAllowlist` + step env.

### Capability manifest

```ts
"runtime.host": "native",
```

### Portability & divergence

GitHub requires a `runs-on` label; Sverka hardcodes `ubuntu-latest`. GitLab
doesn't need an image key for host execution. The native engine uses direct
process spawning with an allowlist — more restrictive than either provider.

The hardcoded `ubuntu-latest` is a v0 limitation. Runner label selection
(F-37) is deferred to M1.

## Non-goals

- Runner label selection / self-hosted runners (F-37, M1).
- macOS/Windows host execution.

## Dependencies

- **Depends on:** F-09 (shell ops).
- **Blocks:** none.

## Open questions

- Should `runs-on` be configurable via `Runtime` (e.g. `runtime.runner`)?
- Should the host driver allowlist be relaxed or configurable per-step?

## References

- GitHub: https://docs.github.com/en/actions/using-workflows/workflow-syntax-for-github-actions#jobsjob_idruns-on
- GitLab: https://docs.gitlab.com/ee/ci/yaml/#image
- Architecture spec: §14.1, §22.4
- Source: `packages/cdk/src/model.ts:101-107`, `packages/github/src/lower.ts:257-260`, `packages/runtime-host/src/host-driver.ts:20-197`
