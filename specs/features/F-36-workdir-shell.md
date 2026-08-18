# Feature: Working directory & shell selection

**ID:** F-36
**Category:** execution
**Milestone:** M0 (already in v0, partial)
**Status:** Proposed
**Parent epic:** sv-4wh9

## Summary

Steps may need to run in a specific directory or with a specific shell. GitHub supports `working-directory` and `shell` at step and defaults level. GitLab has no native equivalents — uses repo root and runner default shell. Sverka needs portable `workdir` and `shell` properties.

## Provider matrix

| Aspect | GitHub Actions | GitLab CI | Sverka (proposed) |
|--------|---------------|-----------|-------------------|
| Construct | `working-directory`, `shell` | (none) | `workdir`, `shell` on Step |
| Semantics | Run command in specified directory with specified shell | Uses repo root and runner default | Run in directory with shell |
| Value type | string (path), string (shell name) | n/a | string, string |
| Limitations | — | no native support | GitLab: emulated via cd + explicit shell |
| Provider gap | — | no equivalent | — |

## GitHub Actions

```yaml
defaults:
  run:
    working-directory: ./src
    shell: bash

jobs:
  build:
    steps:
      - run: make build
        working-directory: ./src
        shell: bash
```

Shell options: `bash`, `pwsh`, `python`, `sh`, `cmd`, `powershell`, or custom template.

## GitLab CI

No native equivalent. All commands run in the repository root (`$CI_PROJECT_DIR`) with the runner's default shell.

## Sverka proposal

### Portable model

Add optional `workdir?: string` and `shell?: string` to Step.

### Authoring API

```ts
// SDK
task("build", {
  run: { command: "make", args: ["build"] },
  workdir: "./src",
  shell: "bash",
}),
```

### Lowering

- **GitHub target:** `workdir` → `working-directory:`. `shell` → `shell:`.
- **GitLab target:** `workdir` → prepend `cd <workdir> &&` to each script entry. `shell` → not directly supported. Emit warning. Could wrap command in explicit shell invocation (e.g., `bash -c "..."`).
- **Native engine:** `workdir` → set `cwd` option on `child_process.spawn`. `shell` → use specified shell binary.

### Capability manifest

```ts
"execution.workdir": "native",       // GitHub
"execution.workdir": "emulated",     // GitLab (cd prefix)
"execution.shell": "native",         // GitHub
"execution.shell": "unsupported",    // GitLab
```

### Portability & divergence

GitHub supports both natively. GitLab supports neither. Sverka emulates `workdir` on GitLab by prepending `cd` to commands. `shell` selection is dropped on GitLab with a warning. This is a known limitation.

## Non-goals

- Custom shell templates (GitHub's `shell: python {0}` syntax).
- `defaults.run` at workflow level (covered by F-45).

## Dependencies

- **Depends on:** F-09 (shell operations).
- **Blocks:** F-45 (defaults — `defaults.run` includes workdir and shell).

## Implementation design

### Model changes

`Runtime.workingDir` already exists. Add `shell?: string` to `Runtime`:

```ts
export interface Runtime {
  readonly mode?: "host" | "container";
  readonly image?: string;
  readonly env?: Readonly<Record<string, string>>;
  readonly secrets?: readonly string[];
  readonly workingDir?: string;
  readonly shell?: string;         // NEW: "bash" | "sh" | "pwsh" | etc.
}
```

No new model entity. `shell` lives on `Runtime` alongside `workingDir` —
both are execution-environment properties, not step-structure properties.

### GitHub target

Add `workingDirectory?: string` and `shell?: string` to `GithubStep`:
```ts
export interface GithubStep {
  // ...existing fields...
  readonly workingDirectory?: string;
  readonly shell?: string;
}
```

In `lowerOperations`, when `flushRun` creates a run step, attach
`workingDirectory` and `shell` from `step.runtime`:
```ts
function flushRun(): void {
  if (runLines.length === 0) return;
  steps.push({
    run: runLines.join("\n"),
    ...(step.runtime.workingDir ? { workingDirectory: step.runtime.workingDir } : {}),
    ...(step.runtime.shell ? { shell: step.runtime.shell } : {}),
  });
  runLines = [];
}
```

Only `run` steps get these fields — checkout, upload, download steps don't.

### GitLab target

GitLab has no native `working-directory` or `shell`. Emulate `workdir` by
prepending `cd <workdir>` as the first script entry. The path is shell-quoted
to prevent injection and handle spaces. All subsequent commands run in that
directory (GitLab script entries share one shell).

```ts
if (step.runtime.workingDir) {
  script.unshift(`cd ${shellQuoteSingle(step.runtime.workingDir)}`);
}
```

`shell` selection: emit a diagnostic warning. GitLab runners use their
default shell — overriding it per-job isn't supported.

### Native engine

`workingDir` already works (step-executor.ts:107-108 resolves it relative
to the step workspace). No changes needed.

`shell` selection: deferred. The host driver uses `spawn` with `shell: false`
and an allowlist — wrapping commands in a specific shell would bypass the
allowlist security model. This requires a security review before implementing.

### Capability manifests

GitHub: add `"execution.workdir": "native"`, `"execution.shell": "native"`
GitLab: add `"execution.workdir": "emulated"`, `"execution.shell": "unsupported"`

### SDK

No changes needed. `sh().runtime({ workingDir: "./src", shell: "bash" })`
already flows through to `StepProps.runtime` → `StepDefinition.runtime`.

## Open questions

- Should `shell` support a custom command template? → No (non-goal).
- Should the GitLab `cd` emulation handle relative vs absolute paths? →
  Relative paths are relative to `$CI_PROJECT_DIR` (the repo root). Absolute
  paths work as-is. No special handling needed.
- Should `workdir` be validated to be within the workspace? → No for M0.
  The native engine already resolves relative paths under the workspace.

## Test plan

1. GitHub: `workingDir` → `working-directory:` on run steps
2. GitHub: `shell` → `shell:` on run steps
3. GitHub: no `workingDir`/`shell` → no extra fields on run steps
4. GitHub: `working-directory` not on checkout/upload/download steps
5. GitLab: `workingDir` → `cd <workdir>` prepended to script
6. GitLab: no `workingDir` → no `cd` prefix
7. GitLab: `shell` → diagnostic warning emitted
8. Native engine: `workingDir` already works (existing tests pass)
9. `Runtime.shell` field accepted by Step/ShellStep
10. Capability manifests updated for both targets

## References

- GitHub: https://docs.github.com/en/actions/using-workflows/workflow-syntax-for-github-actions#jobsjob_idstepsworking-directory
- GitHub: https://docs.github.com/en/actions/using-workflows/workflow-syntax-for-github-actions#jobsjob_idstepsshell
- Architecture spec: §25, §31.3
