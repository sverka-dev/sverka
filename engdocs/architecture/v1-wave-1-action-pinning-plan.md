# v1 Wave 1 Plan — GHA Action SHA Pinning

**Spec:** 22-action-pinning
**Package:** `@sverka/compiler` (github native lowering sub-module)
**Date:** 2026-08-31
**Base branch:** `v1-w1-core-ci`

## Scope

Pin third-party GitHub Actions to commit SHAs in the github native
lowering target. New `pinning.ts` + bundled `pinned-actions.json` registry
+ `pinning` config on `GithubTargetConfig` + `unpinned-action` diagnostic.
No network at compile time (§31.3).

## Files

| File | Action |
|---|---|
| `packages/compiler/src/github/pinned-actions.json` | **New** — registry: `actions/checkout@v4` → sha, etc. Builder fetches SHAs once via `git ls-remote https://github.com/<org>/<repo> refs/tags/<tag>` or `gh api`. |
| `packages/compiler/src/github/pinning.ts` | **New** — `PinRegistry`, `PinningConfig`, `pinActionRef`, `loadBundledRegistry`. |
| `packages/compiler/src/github/types.ts` | **Edit** — add `GithubTargetConfig` interface (`pinning?: PinningConfig`) + `PinningConfig`/`PinRegistry` types. |
| `packages/compiler/src/github/target.ts` | **Edit** — `GithubTarget` gains optional constructor `config?: GithubTargetConfig`; `analyze()` emits `unpinned-action` diagnostics; `emit()` routes `uses:` through `pinActionRef` when pinning on. |
| `packages/compiler/src/github/emit.ts` | **Edit** — `GithubStep.uses` refs routed through `pinActionRef` (or do it in `target.ts` post-emit before stringify — prefer emit.ts so the YAML object is pinned before serialization). |
| `packages/compiler/src/github/index.ts` | **Edit** — export `pinActionRef`, `loadBundledRegistry`, `PinRegistry`, `PinningConfig`. |
| `packages/compiler/src/index.ts` | **Edit** — re-export pinning types from the package barrel. |
| `packages/compiler/src/github/__tests__/pinning.test.ts` | **New** — `pinActionRef` unit tests (items 1–4, 8) + target integration (items 5–7, 9) + export (item 10). |

## TDD steps

1. Fetch SHAs for the 13 actions listed in spec 22 (one-time, via
   `git ls-remote` / `gh api`). Write `pinned-actions.json`.
2. Write `pinning.test.ts` items 1–4 (pin, local passthrough,
   already-pinned passthrough, unknown passthrough). Implement
   `pinActionRef` + `loadBundledRegistry` until green.
3. Write item 8 (`loadBundledRegistry` non-empty, all values 40-hex).
4. Add `GithubTargetConfig` interface (`pinning?: PinningConfig`) to
   `types.ts`; add `GithubTarget` optional constructor config in `target.ts`.
5. Write item 5 (strict mode → SHA ref + `# v4` comment in emitted YAML).
   Wire `pinActionRef` into `emit.ts` for `uses:` fields when pinning on.
6. Write item 6 (strict + missing → `unpinned-action` error diagnostic).
   Wire `analyze()` to scan the lowered graph's `uses:` refs.
7. Write item 7 (off/default → `@v4` unchanged + warn diagnostic).
8. Write item 9 (determinism: two compiles byte-identical).
9. Write item 10 (export assertions) + update index.ts barrels.
10. Run gates: `bun run test`, `bun run typecheck`, `bun run lint`,
    `bun run build`. All green.

## SHA fetching (builder, one-time, NOT at compile)

```bash
# Example: actions/checkout@v4
git ls-remote https://github.com/actions/checkout refs/tags/v4
# → <sha>\trefs/tags/v4
```

For tags that are annotated, `git ls-remote ... refs/tags/<tag>^{}` peels to
the commit. Use `gh api repos/<org>/<repo>/git/refs/tags/<tag>` as fallback.
Commit the resolved SHAs into `pinned-actions.json`.

## Commit hygiene

Stage ONLY `packages/compiler/src/github/**` (pinned-actions.json,
pinning.ts, types.ts, target.ts, emit.ts, index.ts, tests) +
`packages/compiler/src/index.ts` + `specs/22-action-pinning/spec.md` + this
plan + `bun.lock` (if deps change — none expected). EXCLUDE city.toml,
agents/, .devin/, .gc/, .beads/, formulas/, engdocs/adr/.
