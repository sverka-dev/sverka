<!-- cspell:ignore vitest svqf -->

# sv-87qf — runtime:test flake under dogfood parallel load

## Problem

A dogfood `sverka run --entry ci` run (22 parallel steps) failed `ci/test`
with both `runtime:test` and `workflow:test` exiting at **startup**:

```
Error: ENOTEMPTY: directory not empty, rmdir
  '/home/pepl/projects/sverka/node_modules/.vitest-cache'
```

(run `5edd6b36-3942-416a-a569-feec286dc901`, `.sverka/runs/`).

Not a test timeout — no test ran. Vitest 5's `fsModuleCache` (default
`true`) stores transformed modules in
`<workspaceRoot>/node_modules/.vitest-cache`, shared by every vitest
process in the repo. At startup `ensureCacheIntegrity()` compares the
lockfile hash in `_metadata.json`; on mismatch it `rm -rf`s the whole
directory. Nx runs all package `test` targets in parallel after a
`bun install` has invalidated the lockfile hash, so several vitest
processes call `fs.rm(recursive)` on the same tree concurrently —
`rmdir` loses the race with `ENOTEMPTY` and the run dies as a Startup
Error before any test executes.

## Design

Disable `fsModuleCache` in every package's `vitest.config.ts`
(`test.fsModuleCache: false`, 17 files). The shared mutable directory is
the defect; the cache's benefit is marginal on a suite that runs in
~2s/package (vitest itself notes the effect is negligible on some
machines), and serializing nx's parallel targets to protect it would cost
far more than it saves.

Alternative considered: per-package `fsModuleCachePath`. Works (each
process then owns a private dir + private metadata) but keeps the
machinery for near-zero gain and adds a per-config path expression.

## Test plan

1. `bun run test` — all packages green.
2. Concurrent `vitest run` in `packages/runtime` and `packages/workflow`
   after `touch bun.lock` (stale lockfile hash) no longer produces the
   ENOTEMPTY startup error.
