# sv-8e5t — review fixer: PR #410 (TypeScript 6 bump) — fixture tsconfig misses `types`

## Problem

PR [#410](https://github.com/sverka-dev/sverka/pull/410) bumps TypeScript
to 6.0.3 and adds `"types": ["node"]` to `tsconfig.base.json` — required
because TS 6 no longer auto-includes `node_modules/@types/*`. Every real
package extends the base config, so the one-line base fix covers them.

Two files were missed:

- `packages/arena/fixtures/ship-package/tsconfig.json` — the fixture is a
  standalone copy of `@sverka/storage` with an inline tsconfig (no
  `extends`). Under TS 6 its typecheck fails with TS2591 on every
  `node:*` import and TS2503 on `NodeJS.ErrnoException`
  (`src/internal/io-helpers.ts`). Flagged by codeant-ai as an unresolved
  review thread — the only open gate blocker.
- `packages/arena/fixtures/ship-package/bun.lock` — package.json was
  bumped to `typescript ^6.0.3` but the fixture lockfile still resolved
  5.9.3, so installs did not actually get TS 6.

The sibling fixture `verify-and-fix` was also bumped but needs no
`types`: it has no `node:*`/`NodeJS.*` usage and no `@types/node` dep.

## Design

1. Add `"types": ["node"]` to the fixture tsconfig — the same fix the PR
   applied to `tsconfig.base.json`, kept standalone (fixture has no
   `extends`).
2. Regenerate the fixture `bun.lock` (`bun install`) so it resolves
   typescript 6.0.3.
3. Update the pinned sha256 for `tsconfig.json` in
   `SHIP_PACKAGE_DIGESTS` (`packages/arena/arena.config.ts`) — the digest
   guards the fixture's tool configs against agent edits during the
   benchmark; our change is fixture maintenance, so both sides of the pin
   move together.

Verification: `bun run typecheck` and `bun run test` in
`packages/arena/fixtures/ship-package` — 0 errors, 49 tests pass.
