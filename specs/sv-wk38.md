<!-- cspell:ignore wk38 routeTree pathe nitro fumadocs dists -->

# sv-wk38 — website typecheck is not runnable standalone

## Problem

`cd website && bun run check` (`tsc --noEmit`) failed on a fresh checkout for
reasons that are independent of each other:

1. `src/routeTree.gen.ts` is gitignored and only produced by the
   `tanstackStart()` vite plugin during dev/build, so a bare `tsc` cannot
   resolve `./routeTree.gen` — and without its `FileRoutesByPath`/`FileRouteTypes`
   augmentation every `createFileRoute(...)` call degrades (`"/"` is not
   assignable to `undefined`, `_splat` on `never`, …).
2. `scripts/update-arena-results.ts` and `scripts/update-arena-board.ts`
   imported `../../packages/arena/src/*.js` directly, which drags the arena
   package's sources into the website's DOM-lib program. Two failure modes
   follow: `packages/arena/src/acp.ts` mixes the DOM `ReadableStream` with
   `node:stream`'s (`ndJsonStream` requires the latter), and
   `@sverka/runtime|workflow|reporter` only resolve once those packages'
   `dist/` exist — so the check additionally needs a monorepo build.
3. `__tests__/arena-server.test.ts` imports `vitest`, which is not a website
   dependency — it only resolves when a parent `node_modules` happens to
   provide it.

None of these are CI gates today (the website build runs `vite build`,
which generates the route tree first), but `bun run check` cannot pass —
pre-existing, reproduced on `main`.

## Design

- **Route tree**: `website/scripts/gen-route-tree.ts` runs the router
  generator directly — `new Generator({ config: getConfig({}, websiteDir),
root: websiteDir })` — the same generator the `tanstackStart()` plugin
  uses, configured with the plugin's defaults (routes under `src/routes`,
  tree written to `src/routeTree.gen.ts`). `check` becomes
  `bun scripts/gen-route-tree.ts && tsc --noEmit` (~3s added). The
  generated file is the build artifact's content minus react-start's
  `routeTreeFileFooter` marker — the marker exists so the plugin knows
  the file is its own; without it the plugin simply regenerates the tree
  on the next dev/build, which is the safe direction. The typecheck only
  needs the tree's types.
- **Arena boundary**: the two arena publishing scripts are arena tooling —
  they read the arena's registry/results and write into
  `website/public/benchmark/`. They now live in `packages/arena/scripts/`
  and import the arena's own sources relatively (`../src/index.js`), so
  they need neither the arena's `dist/` nor a monorepo build. The website
  keeps the npm entry points (`bun run docs:arena`, `bun run docs:board` in
  `website/`) — only their target moved. The leaderboard's test moves with
  them into `packages/arena/__tests__/` (the arena's vitest suite), so the
  website's test program no longer pulls the arena in either.
- **The invariant, enforced**: `website/__tests__/typecheck.test.ts` runs
  `bun run check` and then `tsc --noEmit --listFiles`, asserting that every
  file the program reads resolves inside `website/`. A sibling package's
  sources or build output showing up here fails the test — the website
  would then typecheck against code it does not own (the DOM lib's
  `ReadableStream` and `node:stream`'s are different types, which is
  exactly how a sibling package's sources break it).
- **Stale vitest import**: `__tests__/arena-server.test.ts` switches to
  `bun:test` — the website's test runner is `bun test` and `vitest` is not
  a website dependency.

## Plan

- [x] `website/scripts/gen-route-tree.ts` — route tree via the router
      generator, configured like the plugin's defaults.
- [x] `website/package.json` — `check` runs the generator then `tsc --noEmit`.
- [x] `packages/arena/scripts/update-arena-{results,board}.ts` — moved out of
      the website program; they import the arena's sources relatively.
- [x] `packages/arena/__tests__/arena-board.test.ts` — moved into the
      arena's vitest suite.
- [x] `packages/arena/tsconfig.json` — the new `scripts/` dir is typechecked.
- [x] `website/__tests__/arena-server.test.ts` — `vitest` → `bun:test`.
- [x] `cd website && bun run check` exits 0 **on a clean checkout** — no
      `bun run build`, no arena `dist/`.
- [x] `cd website && bun test` green without a build; the arena's own suite
      green; root `bun run typecheck` unaffected.
