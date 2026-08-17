# Feature: Cache

**ID:** F-27
**Category:** cache
**Milestone:** M1
**Status:** Proposed
**Parent epic:** sv-4wh9

## Summary

Caching stores frequently-used files (dependencies, build artifacts) between pipeline runs to speed up execution. GitHub uses the `actions/cache` action. GitLab uses the `cache` keyword with key generation, policy, and fallback keys. Sverka needs a portable cache model with key-based restoration.

## Provider matrix

| Aspect | GitHub Actions | GitLab CI | Sverka (proposed) |
|--------|---------------|-----------|-------------------|
| Construct | `actions/cache` | `cache` | `cache` on Step |
| Semantics | Save/restore files by key | Save/restore files by key with policy | Save/restore files by key |
| Value type | action with `path`, `key`, `restore-keys` | map with `paths`, `key`, `policy`, `when`, `fallback_keys` | `{ paths, key, restoreKeys?, policy? }` |
| Limitations | no policy (always pull-push) | `pull`, `push`, `pull-push` policies | — |
| Provider gap | no policy control | no cross-OS archive option | — |

## GitHub Actions

```yaml
steps:
  - uses: actions/cache@v4
    with:
      path: |
        node_modules
        .cache
      key: ${{ runner.os }}-node-${{ hashFiles('**/bun.lock') }}
      restore-keys: |
        ${{ runner.os }}-node-
```

Cache key supports expressions and `hashFiles()`. `restore-keys` is a fallback list for partial key matching.

## GitLab CI

```yaml
build:
  cache:
    key:
      files:
        - bun.lock
      prefix: node
    paths:
      - node_modules
    policy: pull-push
    when: on_success
    fallback_keys:
      - node-main
```

`key` can be a string or map with `files` (hash of file contents) and `prefix`. `policy`: `pull`, `push`, `pull-push`. `when`: `on_success`, `on_failure`, `always`. `fallback_keys` for fallback restoration.

## Sverka proposal

### Portable model

```ts
interface CacheSpec {
  readonly paths: readonly string[];
  readonly key: string;                    // expression or literal
  readonly restoreKeys?: readonly string[];
  readonly policy?: "pull" | "push" | "pull-push";  // default: pull-push
}
```

Step gets optional `cache?: CacheSpec`.

### Authoring API

```ts
task("build", {
  run: ...,
  cache: {
    paths: ["node_modules", ".cache"],
    key: expr`${runner.os}-node-${hashFiles("bun.lock")}`,
    restoreKeys: [expr`${runner.os}-node-`],
  },
}),
```

### Lowering

- **GitHub target:** `cache` → step with `uses: actions/cache@v4`, `with: { path, key, restore-keys }`. `policy` → not directly supported. `pull` → use `actions/cache/restore` action. `push` → use `actions/cache/save` action.
- **GitLab target:** `cache` → `cache:` keyword. `paths` → `paths`. `key` → `key:` (string). `restoreKeys` → `fallback_keys`. `policy` → `policy`.
- **Native engine:** cache is stored in a local directory keyed by hash. `pull` restores from cache, `push` saves to cache, `pull-push` does both.

### Capability manifest

```ts
"cache": "native",
"cache.policy": "native",        // GitLab
"cache.policy": "emulated",      // GitHub (via separate save/restore actions)
"cache.fallbackKeys": "native",  // both
```

### Portability & divergence

GitHub uses an action; GitLab uses a keyword. GitLab has native policy control; GitHub requires separate save/restore actions for pull-only or push-only. Sverka handles this by emitting the appropriate action(s) on GitHub. Key generation via file hashing (`hashFiles()` on GitHub, `cache:key:files` on GitLab) needs expression translation.

## Non-goals

- Cache segmentation by branch or OS (provider-specific).
- Cache size limits and eviction policies.
- Cross-OS archive option (GitHub-specific).

## Dependencies

- **Depends on:** F-35 (expressions) for cache key expressions.
- **Blocks:** none.

## Open questions

- Should `hashFiles()` be a portable expression function or provider-specific?
- Should the native engine implement its own cache store?
- Should `cache:key:files` (GitLab file-based key) be in the portable model?

## References

- GitHub: https://github.com/actions/cache
- GitLab: https://docs.gitlab.com/ee/ci/yaml/#cache
- Architecture spec: §25, §32 (deferred)
