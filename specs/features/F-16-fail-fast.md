# Feature: Fail-fast & max-parallel

**ID:** F-16
**Category:** matrix
**Milestone:** M1
**Status:** Proposed
**Parent epic:** sv-4wh9

## Summary

When a matrix expands into many parallel jobs, two controls matter: fail-fast (cancel remaining jobs when one fails) and max-parallel (limit concurrent jobs). GitHub supports both via `strategy.fail-fast` and `strategy.max-parallel`. GitLab has no direct equivalent. Sverka should support both, with GitLab emulation.

## Provider matrix

| Aspect | GitHub Actions | GitLab CI | Sverka (proposed) |
|--------|---------------|-----------|-------------------|
| Construct | `strategy.fail-fast`, `strategy.max-parallel` | (none) | `failFast`, `maxParallel` on matrix |
| Semantics | Cancel matrix jobs on first failure; limit concurrency | n/a | Cancel on failure; limit concurrency |
| Value type | boolean (default true), number | n/a | boolean, number |
| Limitations | — | no native support | GitLab: emulated by native engine only |
| Provider gap | — | no equivalent | — |

## GitHub Actions

```yaml
strategy:
  fail-fast: true
  max-parallel: 4
  matrix:
    node: [18, 20, 22, 24, 26]
```

`fail-fast` defaults to `true` — if any matrix job fails, all in-progress and queued jobs are cancelled. `max-parallel` limits how many matrix jobs run simultaneously.

## GitLab CI

No direct equivalent. Jobs run independently. Parallelism is controlled by runner capacity, not configuration.

## Sverka proposal

### Portable model

Add to `MatrixSpec` (F-15):

```ts
interface MatrixSpec {
  // ... dimensions, include, exclude (F-15)
  readonly failFast?: boolean;      // normalized to true when omitted
  readonly maxParallel?: number;
}
```

When `failFast` is omitted, it is normalized to `true` before lowering. This
matches GitHub's default and is the safer choice for CI (fail fast to save
runner minutes). All targets consume the normalized value — no target
independently chooses a different default.

### Authoring API

```ts
task("test", {
  run: ...,
  matrix: {
    dimensions: { node: [18, 20, 22, 24, 26] },
    failFast: false,
    maxParallel: 4,
  },
}),
```

### Lowering

- **GitHub target:** `failFast` → `strategy.fail-fast`. `maxParallel` → `strategy.max-parallel`.
- **GitLab target:** not supported natively. `failFast` and `maxParallel` are ignored in YAML output. Emit info diagnostic: "fail-fast and max-parallel are not supported by GitLab CI. Use runner concurrency limits instead."
- **Native engine:** `failFast` — cancel all pending matrix step instances when one fails. `maxParallel` — limit concurrent execution to N instances.

### Capability manifest

```ts
// githubCapabilities:
"matrix.failFast": "native",
"matrix.maxParallel": "native",
// gitlabCapabilities:
"matrix.failFast": "unsupported",
"matrix.maxParallel": "unsupported",
// nativeCapabilities:
"matrix.failFast": "emulated",
"matrix.maxParallel": "emulated",
```

### Portability & divergence

These are GitHub-only features. On GitLab, they are dropped with an info diagnostic. The native engine honors both for local execution. This is an acceptable divergence — these are optimization controls, not semantic requirements.

## Non-goals

- Runner-level concurrency limits (provider infrastructure concern).
- Priority-based scheduling.

## Dependencies

- **Depends on:** F-15 (matrix expansion).
- **Blocks:** none.

## Open questions

- Should the native engine warn when `maxParallel` exceeds CPU cores?
- Resolved: `failFast` defaults to `true` (normalized before lowering).

## References

- GitHub: https://docs.github.com/en/actions/using-workflows/workflow-syntax-for-github-actions#jobsjob_idstrategyfail-fast
- Architecture spec: §25, §32 (deferred)
