# Feature: Matrix expansion

**ID:** F-15
**Category:** matrix
**Milestone:** M1
**Status:** Proposed
**Parent epic:** sv-4wh9

## Summary

Matrix expansion fans out one step into N parallel executions, each with different variable values — test across multiple Node versions, OSes, or configurations. GitHub uses `strategy.matrix` with include/exclude. GitLab uses `parallel:matrix`. Sverka needs a portable matrix model that lowers to both.

## Provider matrix

| Aspect | GitHub Actions | GitLab CI | Sverka (proposed) |
|--------|---------------|-----------|-------------------|
| Construct | `strategy.matrix` | `parallel:matrix` | `matrix` on Step |
| Semantics | Fan out job per matrix combination | Fan out job per matrix combination | Fan out step per combination |
| Value type | map of var→array | array of variable hashes | `{ dimensions, include?, exclude? }` |
| Limitations | max 256 jobs per matrix | max 200 parallel jobs | — |
| Provider gap | — | no include/exclude | include/exclude is GitHub-only |

## GitHub Actions

```yaml
strategy:
  matrix:
    node: [18, 20, 22]
    os: [ubuntu-latest, windows-latest]
    include:
      - node: 22
        os: macos-latest
        experimental: true
    exclude:
      - node: 18
        os: windows-latest
```

Matrix variables accessed via `${{ matrix.var }}`. `include` adds combinations or extends existing ones. `exclude` removes combinations (partial match).

## GitLab CI

```yaml
test:
  parallel:
    matrix:
      - node: [18, 20, 22]
        os: [ubuntu, windows]
  script:
    - echo "Testing with Node $NODE_VERSION on $OS"
```

Variables accessed as `$VARIABLE` (uppercase). No `include`/`exclude` — all combinations are explicit in the array.

## Sverka proposal

### Portable model

Add optional `matrix?: MatrixSpec` to Step:

```ts
interface MatrixSpec {
  readonly dimensions: Record<string, readonly (string | number)[]>;
  readonly include?: readonly Record<string, string | number>[];
  readonly exclude?: readonly Record<string, string | number>[];
}
```

### Authoring API

```ts
// SDK
task("test", {
  run: { command: "make", args: ["test"] },
  matrix: {
    dimensions: { node: [18, 20, 22], os: ["ubuntu", "windows"] },
    exclude: [{ node: 18, os: "windows" }],
  },
}),
```

### Lowering

- **GitHub target:** `matrix` → `strategy.matrix`. `dimensions` → matrix variables. `include` → `include:`. `exclude` → `exclude:`. Matrix variables referenced as `${{ matrix.var }}` in expressions.
- **GitLab target:** `matrix` → `parallel:matrix`. `dimensions` → array of variable hashes (expand cross-product). `include` → append to matrix array. `exclude` → not supported natively — filter at synthesis time and emit warning.
- **Native engine:** expand matrix at plan time. Create N step instances, each with matrix variables injected as environment variables. Execute in parallel.

### Capability manifest

```ts
"matrix.expansion": "native",
"matrix.include": "native",       // GitHub
"matrix.include": "lowered",      // GitLab (appended to array)
"matrix.exclude": "native",       // GitHub
"matrix.exclude": "emulated",     // GitLab (filtered at synthesis)
```

### Portability & divergence

GitHub has include/exclude; GitLab doesn't. Sverka handles exclude by filtering combinations at synthesis time for GitLab (the resulting matrix array simply omits excluded combinations). This preserves semantics — the excluded combinations never appear in the generated YAML.

## Non-goals

- Dynamic matrix values (computed at runtime).
- Matrix-level fail-fast and max-parallel (F-16).

## Dependencies

- **Depends on:** F-07 (DAG dependencies — matrix-expanded steps are separate DAG nodes).
- **Blocks:** F-16 (fail-fast & max-parallel).

## Open questions

- Should matrix variables be typed (string | number) or just string?
- Should the native engine cap parallelism?
- How are matrix variables referenced in Sverka expressions? (`${matrix.var}`?)

## References

- GitHub: https://docs.github.com/en/actions/using-workflows/workflow-syntax-for-github-actions#jobsjob_idstrategymatrix
- GitLab: https://docs.gitlab.com/ee/ci/yaml/#parallelmatrix
- Architecture spec: §25, §32 (deferred)
