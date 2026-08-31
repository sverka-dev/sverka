# Spec 22 — GHA Action SHA Pinning

**Status:** Active
**Source:** specs/architecture-spec.md §19 (Target contract), §31.3 (no network access at compile), §26 (extensions)
**Package:** `@sverka/compiler` (github native lowering sub-module)
**Capability:** none (compiler security feature, not a workflow capability)
**Related:** ADR-004 (superseded — native lowering is canonical), ADR-011

## Overview

Pin third-party GitHub Actions to immutable commit SHAs instead of mutable
version tags in the github native lowering target (`packages/compiler/src/
github/`). Inspired by gh-aw's security model. SHAs are sourced from a
**bundled registry** committed to the repo (no network access at compile
time — §31.3). Pinned output embeds the version as a comment for
auditability: `actions/checkout@<sha> # v4`.

## Goals

- `pinned-actions.json` registry: `{ "actions/checkout@v4": "<40-char-sha>",
  ... }` bundled in the compiler package.
- `pinActionRef(ref, registry)` pure function: `actions/checkout@v4` →
  `actions/checkout@<sha> # v4`; local actions (`./.github/...`) and
  already-pinned refs (`@<40-hex>`) pass through unchanged.
- `GithubTarget` constructor accepts an optional
  `GithubTargetConfig` (`new GithubTarget({ pinning })`); default `off` to
  preserve current behavior; `strict` pins + errors on missing registry
  entry. The `Target` contract `compile(graph)` is unchanged.
- Route all emitted `uses:` refs through `pinActionRef` when pinning is on.
- `unpinned-action` diagnostic (severity `warn` in `off`, `error` in
  `strict`) from `analyze()` when a third-party action is not in the
  registry.
- Pin the actions currently emitted by `github/lower.ts`: `actions/checkout`,
  `actions/setup-node`, `actions/upload-artifact`, `actions/download-artifact`,
  `actions/cache`, `actions/cache/restore`, `actions/cache/save`,
  `oven-sh/setup-bun`, `softprops/action-gh-release`,
  `actions/upload-pages-artifact`, `actions/deploy-pages`,
  `dorny/test-reporter`, `github/codeql-action/upload-sarif`.

## Non-goals

- Auto-resolve SHAs via GitHub API at compile time — forbidden (§31.3 no
  network). SHAs are fetched once by the builder and committed.
- Allowlist of trusted orgs / configurable trust policy — follow-up.
- Signature / Sigstore verification of pinned SHAs — follow-up.
- Pinning in the legacy thin-wrapper `compiler-github/compile.ts` —
  deprecated path (ADR-004 superseded); not extended. (If kept, it inherits
  pinning by sharing the registry, but no new code there.)

## Interfaces

```ts
// packages/compiler/src/github/pinning.ts

interface PinRegistry { readonly [ref: string]: string } // "actions/checkout@v4" → sha

interface PinningConfig {
  readonly mode: "strict" | "off"; // default "off"
  readonly registry?: PinRegistry;  // default: bundled pinned-actions.json
}

/** Pin a single `uses:` ref. Local/already-pinned refs pass through. */
function pinActionRef(ref: string, registry: PinRegistry): string;

/** Load the bundled registry. */
function loadBundledRegistry(): PinRegistry;
```

`GithubTarget` gains an optional constructor config:

```ts
interface GithubTargetConfig {
  readonly pinning?: PinningConfig; // default: { mode: "off" }
}

class GithubTarget implements Target {
  constructor(config?: GithubTargetConfig);
  // ...existing Target methods unchanged
}
```

## Data models

`pinActionRef` rules:
1. Ref starts with `./` (local action) → unchanged.
2. Ref already matches `@<40 hex>` → unchanged (already pinned).
3. Ref is `org/name@vN` and in registry → `org/name@<sha> # vN`.
4. Ref is `org/name@vN` and **not** in registry → unchanged (caller emits
   `unpinned-action` diagnostic; in `strict` mode this is an error).

Bundled registry path: `packages/compiler/src/github/pinned-actions.json`
(imported as a JSON module; tsdown supports JSON import).

## Error handling

- `strict` mode + missing registry entry → `unpinned-action` diagnostic
  (severity `error`) in `analyze()`; the emitted YAML keeps the `@vN` ref
  (compile is still deterministic — no network). The caller decides whether
  to fail the build on error-severity diagnostics.
- `off` mode + missing entry → `unpinned-action` diagnostic (severity
  `warn`); ref unchanged.
- Malformed ref (no `@`) → `unpinned-action` diagnostic (severity `warn`);
  ref unchanged.

No new error class. Diagnostics flow through the existing `TargetDiagnostic`
channel.

## Test plan

1. `pinActionRef("actions/checkout@v4", reg)` →
   `actions/checkout@<sha> # v4` when in registry.
2. `pinActionRef("./.github/workflows/foo.yml", reg)` → unchanged (local).
3. `pinActionRef("actions/checkout@<40hex>", reg)` → unchanged (already
   pinned).
4. `pinActionRef("acme/unknown@v1", reg)` → unchanged (not in registry).
5. `GithubTarget` with `pinning.mode: "strict"`: a graph using
   `actions/checkout` emits YAML with the SHA ref + `# v4` comment.
6. `pinning.mode: "strict"` + an action not in registry → `unpinned-action`
   diagnostic with severity `error`.
7. `pinning.mode: "off"` (default) → YAML unchanged (`@v4`); `unpinned-action`
   diagnostic with severity `warn` for third-party actions.
8. `loadBundledRegistry()` returns a non-empty map; every value is a 40-char
   hex string.
9. Determinism: two compiles of the same graph produce byte-identical YAML
   (no network, no timestamps).
10. `pinActionRef`, `loadBundledRegistry`, `PinRegistry`, `PinningConfig`
    exported from `@sverka/compiler`.
