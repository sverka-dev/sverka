# Feature: Runner selection & labels

**ID:** F-37
**Category:** runner
**Milestone:** M1
**Status:** Accepted
**Parent epic:** sv-4wh9

## Summary

Runner selection controls which machine executes a job. GitHub uses `runs-on` with labels (ubuntu-latest, windows-latest, self-hosted, custom). GitLab uses `tags` (array of runner tags). Sverka needs a portable runner selection model.

## Provider matrix

| Aspect | GitHub Actions | GitLab CI | Sverka (proposed) |
|--------|---------------|-----------|-------------------|
| Construct | `runs-on` | `tags` | `runner` on Step |
| Semantics | Select runner by label(s) | Select runner by tag(s) | Select runner by label(s) |
| Value type | string, array, or object with `group`/`labels` | array of strings | `{ labels: string[] }` |
| Limitations | label must match available runner | tags are case-sensitive | — |
| Provider gap | — | — | label/tag normalization |

## GitHub Actions

```yaml
jobs:
  build:
    runs-on: ubuntu-latest
  test:
    runs-on:
      group: my-runner-group
      labels: [self-hosted, linux, x64]
  multi:
    runs-on: [self-hosted, linux]
```

GitHub-hosted labels: `ubuntu-latest`, `ubuntu-24.04`, `windows-latest`, `macos-latest`, etc. Self-hosted: `self-hosted` + custom labels. Object form supports runner groups.

## GitLab CI

```yaml
build:
  tags:
    - linux
    - x64
  script: make build
```

Tags are case-sensitive. Runner must have all specified tags to pick up the job.

## Sverka proposal

### Portable model

```ts
interface RunnerSpec {
  readonly labels: readonly string[];
  readonly group?: string;  // GitHub runner group
}
```

Step gets optional `runner?: RunnerSpec`. When not specified, uses provider default (GitHub: `ubuntu-latest`, GitLab: runners configured to accept untagged jobs; if no eligible runner exists, the job remains pending).

### Authoring API

```ts
task("build", {
  run: ...,
  runner: { labels: ["linux", "x64"] },
}),

// With runner group (GitHub)
task("build", {
  run: ...,
  runner: { labels: ["self-hosted", "linux"], group: "my-runner-group" },
}),
```

### Lowering

- **GitHub target:** `runner.labels` → `runs-on:` (string if one label, array if multiple). `runner.group` → `runs-on: { group: ..., labels: [...] }`.
- **GitLab target:** `runner.labels` → `tags:`. `runner.group` → not supported (emit warning).
- **Native engine:** `runner` is metadata. The native engine runs on the host machine regardless of labels.

### Capability manifest

```ts
"runner.selection": "native",
"runner.group": "native",       // GitHub
"runner.group": "unsupported",  // GitLab
```

### Portability & divergence

GitHub uses `runs-on` with labels and optional groups. GitLab uses `tags`. Both select runners by matching labels/tags. Runner groups are GitHub-only. Sverka normalizes to a `labels` array and lowers to the appropriate keyword.

## Non-goals

- Runner provisioning and auto-scaling.
- Runner architecture detection (arm64 vs x64).
- GitHub-hosted vs self-hosted distinction in the portable model.

## Dependencies

- **Depends on:** F-17 (host runtime), F-18 (container runtime).
- **Blocks:** none.

## Decisions (open questions resolved)

- **No `kind` field.** The `labels` array is sufficient. `ubuntu-latest` vs
  `self-hosted` is implicit in the label choice. Adding a `kind` field would
  leak provider concepts into the portable model.
- **No label validation.** Labels are provider-specific and may change.
  Validation would require maintaining a registry. Users get feedback at
  runtime when no runner matches.
- **Native engine ignores `runner.labels`.** The native engine runs on the
  host machine. Runner labels are metadata for target compilation only.

## References

- GitHub: https://docs.github.com/en/actions/using-workflows/workflow-syntax-for-github-actions#jobsjob_idruns-on
- GitLab: https://docs.gitlab.com/ee/ci/yaml/#tags
- Architecture spec: §25, §32 (deferred)
