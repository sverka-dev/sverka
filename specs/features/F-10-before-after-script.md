# Feature: Before/after script

**ID:** F-10
**Category:** execution
**Milestone:** M1
**Status:** Proposed
**Parent epic:** sv-4wh9

## Summary

GitLab CI supports `before_script` (runs before the main script) and `after_script` (runs after, even on failure). GitHub Actions has no direct equivalent — users insert setup/teardown steps manually. Sverka should support this as optional Step-level pre/post hooks.

## Provider matrix

| Aspect | GitHub Actions | GitLab CI | Sverka (proposed) |
|--------|---------------|-----------|-------------------|
| Construct | (none — manual steps) | `before_script`, `after_script` | `beforeScript`, `afterScript` on Step |
| Semantics | n/a | `before_script` runs before `script`; `after_script` runs after, even on failure | pre/post operations around main operations |
| Value type | n/a | array of strings | array of operations |
| Limitations | — | `after_script` always runs (even on failure) | — |
| Provider gap | no equivalent | — | GitHub: lowered as first/last steps |

## GitHub Actions

No native equivalent. Users manually add setup steps before and cleanup steps after:

```yaml
steps:
  - name: Setup
    run: |
      export PATH=$PATH:/custom/bin
      install-deps
  - name: Main
    run: make test
  - name: Cleanup
    if: always()
    run: cleanup
```

## GitLab CI

```yaml
test:
  before_script:
    - export PATH=$PATH:/custom/bin
    - install-deps
  script:
    - make test
  after_script:
    - cleanup
```

Key semantic: `after_script` runs even if `script` fails. `before_script` and `script` run in the same shell context; `after_script` runs in a fresh shell.

## Sverka proposal

### Portable model

Add optional `beforeScript?: readonly Operation[]` and `afterScript?: readonly Operation[]` to Step. `afterScript` operations are marked as always-run (equivalent to `if: always()`).

### Authoring API

```ts
// SDK
task("test", {
  run: { command: "make", args: ["test"] },
  beforeScript: [sh`install-deps`],
  afterScript: [sh`cleanup`],
}),
```

### Lowering

- **GitHub target:** `beforeScript` → inserted as steps before main operations. `afterScript` → inserted as steps after main operations with `if: always()`.
- **GitLab target:** `beforeScript` → `before_script:`. `afterScript` → `after_script:`.
- **Native engine:** `beforeScript` operations run first, then main operations, then `afterScript` operations (regardless of main operation success).

### Capability manifest

```ts
"execution.beforeScript": "native",   // GitLab
"execution.beforeScript": "lowered",  // GitHub (emulated as steps)
"execution.afterScript": "native",    // GitLab
"execution.afterScript": "lowered",   // GitHub (emulated as steps with if: always())
```

### Portability & divergence

GitLab has native support with a specific semantic: `after_script` runs in a fresh shell. On GitHub, Sverka emulates this with `if: always()` steps. The fresh-shell semantic is lost on GitHub — `afterScript` runs in the same shell context. This is a minor divergence documented in the diagnostic.

## Non-goals

- `default`-level before/after script (F-45 covers defaults).
- Per-operation hooks (hooks are Step-level only).

## Dependencies

- **Depends on:** F-09 (shell operations).
- **Blocks:** F-45 (defaults — `default` can include `before_script`/`after_script`).

## Open questions

- Should `afterScript` run if `beforeScript` fails? (GitLab: no.)
- Should the fresh-shell semantic of GitLab `after_script` be documented as a known divergence?

## References

- GitLab: https://docs.gitlab.com/ee/ci/yaml/#before_script
- GitLab: https://docs.gitlab.com/ee/ci/yaml/#after_script
- Architecture spec: §25, §32 (deferred)
