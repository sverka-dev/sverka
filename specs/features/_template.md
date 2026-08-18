<!-- Copy this file to <id>-<slug>.md and fill in every section. Do not leave
placeholder text in committed specs. Keep sections in this order so the
overview page can index them uniformly. -->

# Feature: <Human-readable name>

**ID:** F-NN
**Category:** triggers | scheduling | execution | environment | artifacts | cache | secrets | outputs | matrix | concurrency | deployment | reusable | expressions | runner | workflow-control | import
**Milestone:** M0 (already in v0) | M1 | M2 | M3 | new
**Status:** Proposed | Draft | Accepted
**Parent epic:** sv-4wh9

## Summary

One paragraph: what this capability is, why a verification workflow needs it,
and the one-line portable idea Sverka adopts.

## Provider matrix

The core comparison. Keep rows identical across all feature specs so the
overview page can stitch them together.

| Aspect        | GitHub Actions                | GitLab CI                  | Sverka (proposed)            |
|---------------|-------------------------------|----------------------------|------------------------------|
| Construct     | `yaml key`                    | `keyword`                  | `portable node / op`         |
| Semantics     | one line                      | one line                   | one line                     |
| Value type    | string/array/map/bool         | string/array/map/bool      | typed IR node                |
| Limitations   | one line                      | one line                   | one line                     |
| Provider gap  | —                             | —                          | —                            |

## GitHub Actions

Authoritative keys, sub-keys, semantics, a minimal example, and gotchas.
Reference the exact key path(s) from the workflow syntax.

```yaml
# minimal GitHub example
```

## GitLab CI

Authoritative keywords, sub-keys, semantics, a minimal example, and gotchas.

```yaml
# minimal GitLab example
```

## Sverka proposal

### Portable model

How the Definition Graph represents this provider-neutrally (IR node shape,
fields, defaults).

### Authoring API

How users express it across the three authoring layers — Construct, SDK,
Decorator. Show the canonical snippet.

```ts
// SDK / Construct / Decorator usage
```

### Lowering

- **GitHub target:** mapping to the GitHub key(s) above.
- **GitLab target:** mapping to the GitLab keyword(s) above.
- **Native engine:** runtime behavior when executed locally.

### Capability manifest

```ts
"<capability.key>": "native" | "lowered" | "emulated" | "partial" | "unsupported"
```

### Portability & divergence

Where the two providers diverge semantically and how Sverka resolves it
(reject, lower to closest, emulate, or expose as a provider extension).

## Non-goals

What this feature explicitly does NOT cover in this spec.

## Dependencies

- **Depends on:** F-NN (if any)
- **Blocks:** F-NN (if any)

## Open questions

- Unresolved design decisions for review.

## References

- GitHub: <https://docs.github.com/en/actions/using-workflows/workflow-syntax-for-github-actions#...>
- GitLab: <https://docs.gitlab.com/ee/ci/yaml/#...>
- Architecture spec: §NN
