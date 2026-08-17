# Feature: Shell operations

**ID:** F-09
**Category:** execution
**Milestone:** M0 (already in v0)
**Status:** Verified (M0)
**Parent epic:** sv-4wh9

## Summary

Shell operations are the fundamental execution unit — a command string run in
a shell. Both GitHub Actions (`steps[*].run`) and GitLab CI (`script`) support
this natively. Sverka models it as `ShellStep` (construct) and the `sh` tagged
template (SDK), lowering to `OperationDefinition` kind `shell` in the graph.

## Provider matrix

| Aspect | GitHub Actions | GitLab CI | Sverka (proposed) |
|--------|---------------|-----------|-------------------|
| Construct | `steps[*].run` | `script` (array) | `ShellStep.command` / `sh` template |
| Semantics | string run in runner shell | array of strings run sequentially | single command string per shell op |
| Value type | string | string or string array | string |
| Limitations | one shell per step | multiple scripts per job | consecutive shell ops combined in lowering |
| Provider gap | — | — | — |

## GitHub Actions

```yaml
steps:
  - run: echo "building"
  - run: |
      echo "multi-line"
      echo "script"
```

`run` executes a string in the runner's default shell (`bash` on Linux).
Multi-line strings via YAML literal block scalar.

## GitLab CI

```yaml
build:
  script:
    - echo "building"
    - echo "second command"
```

`script` is an array of command strings executed sequentially in the runner's
shell.

## Sverka proposal

### Portable model

`ShellStep` (`cdk/constructs.ts:136-143`) has a `command: string` field.
Synthesis emits `{ kind: "shell", command }` as an `OperationDefinition`
(`core/graph.ts:64`). A step can have multiple operations — consecutive
shell ops are combined in lowering.

### Authoring API

```ts
// SDK — sh tagged template
import { sh } from "@sverka/sdk";
sh`echo "building"`.build(pipeline, "build");

// With interpolation (auto-collects Reference inputs)
sh`echo ${git.branch}`.build(pipeline, "echo-branch");

// Construct
new ShellStep(pipeline, "build", { command: "echo building" });

// Decorator
@step({ command: "echo building" })
```

### Lowering

- **GitHub target:** shell ops → `run:` steps. Consecutive `shell` +
  `exportOutput` ops are combined into one `run:` step with newlines
  (`github/lower.ts:332-358`). A `actions/checkout@v4` step is prepended to
  every job.
- **GitLab target:** shell ops → `script:` array entries
  (`gitlab/lower.ts:489-491`). If no operations produce script lines,
  `echo 'no operations'` is emitted.
- **Native engine:** `StepExecutor.executeShellOperation`
  (`engine-native/step-executor.ts:98-132`) interpolates `${ref}` placeholders,
  builds env, and calls `driver.executeShell`. The command is run via the
  runtime driver (host: direct spawn with `shell: false`; docker: `sh -c`).

### Capability manifest

```ts
"operation.shell": "native",
```

### Portability & divergence

Both providers support shell commands natively. Sverka's `sh` tagged template
interpolates `Reference` values as `${step.output}` or `${namespace.field}`
placeholders — these are resolved by the native engine at runtime. In compiled
targets, the placeholders are passed through as literal strings (see F-35 for
expression lowering gaps).

## Non-goals

- Shell selection (`bash`/`sh`/`pwsh`) — no `shell` field in v0 (see F-36).
- Multi-line script authoring helpers (use template literals).

## Dependencies

- **Depends on:** none.
- **Blocks:** F-13 (timeout), F-36 (workdir/shell), F-07 (deps — steps are
  dependency nodes).

## Open questions

- Should the `sh` template support multi-line commands natively (it does via
  template literals — is this sufficient)?
- Should `actions/checkout@v4` be auto-prepended, or should it be configurable?

## References

- GitHub: https://docs.github.com/en/actions/using-workflows/workflow-syntax-for-github-actions#jobsjob_idstepsrun
- GitLab: https://docs.gitlab.com/ee/ci/yaml/#script
- Architecture spec: §9.1, §15
- Source: `packages/cdk/src/constructs.ts:136-143`, `packages/core/src/graph.ts:63-65`, `packages/sdk/src/sh.ts:85-117`, `packages/github/src/lower.ts:332-394`, `packages/engine-native/src/step-executor.ts:98-132`
