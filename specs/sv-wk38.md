<!-- cspell:ignore wk38 routeTree pathe nitro fumadocs dists -->

# sv-wk38 — website typecheck is not runnable standalone

## Problem

`cd website && bun run check` (`tsc --noEmit`) fails on a fresh checkout for
reasons that are independent of each other:

1. `src/routeTree.gen.ts` is gitignored and only produced by the
   `tanstackStart()` vite plugin during dev/build, so a bare `tsc` cannot
   resolve `./routeTree.gen` — and without its `FileRoutesByPath`/`FileRouteTypes`
   augmentation every `createFileRoute(...)` call degrades (`"/"` is not
   assignable to `undefined`, `_splat` on `never`, …).
2. `scripts/update-arena-results.ts` and `scripts/update-arena-board.ts`
   import `../../packages/arena/src/*.js` directly, which drags the arena
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

- **Route tree**: `website/scripts/gen-route-tree.ts` runs
  `vite.createServer({ server: { middlewareMode: true } })` and closes it
  immediately. The router-generator plugin regenerates `routeTree.gen.ts`
  inside the vite `configResolved` hook, which fires during `createServer` —
  middlewareMode only skips binding a port. This runs the project's real
  `vite.config.ts` + `tanstackStart()` pipeline, so the output is
  byte-identical to what `vite dev`/`vite build` writes (verified by diff),
  including the react-start `routeTreeFileFooter` block that a bare
  `Generator` invocation would omit. `check` becomes
  `bun scripts/gen-route-tree.ts && tsc --noEmit` (~3s added).
- **Arena boundary**: the three files that pull arena sources into the
  website program are excluded from `website/tsconfig.json` —
  `scripts/update-arena-results.ts`, `scripts/update-arena-board.ts`, and
  `__tests__/arena-board.test.ts` (imports `update-arena-board`). Making them
  typecheck standalone is impossible without (a) DOM-lib-compatible arena
  sources and (b) built `@sverka/*` dists; both would defeat the purpose of
  a standalone check. The arena domain stays covered by the monorepo's nx
  `typecheck`/`test` targets. `server/arena-server.ts` stays checked — it
  only spawns `packages/arena/src/bin.ts` via a subprocess path string.
- **Stale vitest import**: `__tests__/arena-server.test.ts` switches to
  `bun:test` — the website's test runner is `bun test` and `vitest` is not a
  website dependency.

## Plan

- [x] `website/scripts/gen-route-tree.ts` — route tree via vite
      `createServer` middlewareMode; output verified byte-identical to the
      `vite dev`-generated file.
- [x] `website/package.json` — `check` runs the generator then `tsc --noEmit`.
- [x] `website/tsconfig.json` — exclude the three arena-boundary files.
- [x] `website/__tests__/arena-server.test.ts` — `vitest` → `bun:test`.
- [x] `cd website && bun run check` exits 0.
- [x] `cd website && bun test` still green; root `bun run typecheck`
      unaffected.
