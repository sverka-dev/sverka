# Feature: Defaults

**ID:** F-45
**Category:** workflow-control
**Milestone:** M1
**Status:** Accepted
**Parent epic:** sv-4wh9

## Summary

Defaults provide pipeline-wide settings that apply to all steps unless overridden. GitHub uses `defaults.run` (shell, working-directory) at workflow and job level. GitLab uses `default` (image, services, cache, before_script, after_script, etc.) at global level. Sverka needs a portable defaults model. The portable model covers pipeline-wide defaults only; job-level overrides are handled by per-step properties.

## Provider matrix

| Aspect | GitHub Actions | GitLab CI | Sverka (proposed) |
|--------|---------------|-----------|-------------------|
| Construct | `defaults.run` | `default` | `defaults` on Pipeline |
| Semantics | Apply shell/workdir to all steps | Apply image/services/cache/script to all jobs | Apply settings to all steps |
| Value type | map with `shell`, `working-directory` | map with image, services, cache, before_script, after_script, etc. | map with shared step properties |
| Limitations | only shell and workdir | broad set of defaults | — |
| Provider gap | limited scope | broad scope | portable subset |

## GitHub Actions

```yaml
defaults:
  run:
    shell: bash
    working-directory: ./src

jobs:
  build:
    defaults:
      run:
        working-directory: ./build
    steps:
      - run: make build
```

`defaults.run` sets `shell` and `working-directory` for all steps in the workflow (or job if job-level). Job-level overrides workflow-level.

## GitLab CI

```yaml
default:
  image: node:24
  cache:
    paths: [node_modules]
  before_script:
    - install-deps
  after_script:
    - cleanup
  services:
    - name: postgres:16
      alias: postgres
  tags:
    - linux
  retry:
    max: 1
  timeout: 1h
  interruptible: true
```

`default` applies to all jobs. Supported keys: `image`, `services`, `cache`, `before_script`, `after_script`, `tags`, `retry`, `timeout`, `interruptible`, `artifacts`, `id_tokens`.

## Sverka proposal

### Portable model

```ts
interface PipelineDefaults {
  readonly shell?: string;
  readonly workdir?: string;
  readonly env?: Record<string, string>;
  readonly beforeScript?: readonly Operation[];
  readonly afterScript?: readonly Operation[];
  readonly timeout?: string;
  readonly retry?: RetryPolicy;
  readonly interruptible?: boolean;
}
```

Pipeline gets optional `defaults?: PipelineDefaults`. Step-level properties override pipeline defaults.

### Authoring API

```ts
defineWorkflow({
  name: "CI",
  defaults: {
    shell: "bash",
    workdir: "./src",
    beforeScript: [sh`install-deps`],
  },
  workflow: pipeline(
    task("build", { run: sh`make build` }),  // inherits defaults
    task("test", { run: sh`make test`, workdir: "./tests" }),  // overrides workdir
  ),
}),
```

### Lowering

- **GitHub target:** `defaults.shell` → `defaults.run.shell`. `defaults.workdir` → `defaults.run.working-directory`. Other defaults → not supported at workflow level (emit warning, apply per-step instead).
- **GitLab target:** `defaults` → `default:` keyword. `shell` → not supported (emit warning). `workdir` → not supported (emit warning). `beforeScript` → `before_script`. `afterScript` → `after_script`. `timeout` → `timeout`. `retry` → `retry`. `interruptible` → `interruptible`.
- **Native engine:** apply defaults to each step before execution. Step-level overrides take precedence.

### Capability manifest

```ts
// githubCapabilities:
"workflow.defaults": "native",
"workflow.defaults.shell": "native",
"workflow.defaults.beforeScript": "lowered",  // per-step
// gitlabCapabilities:
"workflow.defaults": "native",
"workflow.defaults.shell": "unsupported",
"workflow.defaults.beforeScript": "native",
```

### Portability & divergence

GitHub's `defaults` is narrow (shell, workdir only). GitLab's `default` is broad (image, services, cache, scripts, tags, retry, timeout, interruptible). Sverka's portable model covers a portable subset of both. Each provider lowers what it supports and warns about the rest.

## Non-goals

- `default:image` and `default:services` (covered by F-18 and F-19, applied as defaults).
- `default:cache` (covered by F-27, applied as default).
- `default:tags` (covered by F-37, applied as default).

## Dependencies

- **Depends on:** F-09 (shell operations), F-10 (before/after script), F-13 (timeout), F-14 (retry), F-29 (interruptible), F-36 (workdir/shell).
- **Blocks:** none.

## Decisions (open questions resolved)

- **Only a subset of Step properties are eligible for defaults.** The
  portable model covers: `shell`, `workdir`, `env`, `beforeScript`,
  `afterScript`, `timeout`, `retry`, `interruptible`. Other step properties
  (runner, identity, rules, outputs) are too step-specific to default.
- **Nested override: pipeline → step.** Step-level properties override
  pipeline defaults. This is simple and matches both GitHub and GitLab
  semantics.
- **No `image` and `services` as defaults in this feature.** Those are
  covered by F-18 (container runtime) and F-19 (services). Applying them
  as defaults is a future enhancement.

## References

- GitHub: https://docs.github.com/en/actions/using-workflows/workflow-syntax-for-github-actions#defaults
- GitLab: https://docs.gitlab.com/ee/ci/yaml/#default
- Architecture spec: §25, §32 (deferred)
