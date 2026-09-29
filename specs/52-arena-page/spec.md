# Spec 52 — Arena results page on the website

## Problem

Arena runs (`sverka-arena run`) produce `results.json` under
`packages/arena/.arena/` — gitignored, local-only. There is no way to
see benchmark deltas without running the benchmark yourself. The site
already publishes live pipeline reports (`/pipeline/`); arena results
should be visible there too.

## Constraints

- Arena spawns real agent sessions — it cannot run in the website
  deploy (no agent credentials in CI secrets, and runs are costly).
- Model policy: arena runs use `swe-2-high` only.
- Keep the sidebar uncluttered — no sidebar entry; link from the
  `/pipeline/` page.

## Design

### Snapshot, not live data

`website/scripts/update-arena-results.ts` reads the runner output
(`packages/arena/.arena/results.json`), strips bulky fields (`trace`,
`output`, `verdicts`, `prompt`), and writes a committed digest at
`website/src/data/arena-results.json`. Refreshing the page data is a
deliberate act: run the arena locally, then `bun run docs:arena` and
commit. The digest is data, not generated-at-build — it ships in git.

Digest shape (subset of `ArenaResult`):

```typescript
interface ArenaDigest {
  timestamp: string;
  commit?: string; // provenance — git sha of the snapshot run
  config: { models: string[]; plugins: string[]; repetitions: number };
  aggregates: {
    label: string;
    totalRuns: number;
    successCount: number;
    avgTotalTokens: number;
    avgToolCalls: number;
    avgLlmCalls: number;
    avgExecutionTimeMs: number;
  }[];
  analysis: {
    taskId: string;
    taskName: string;
    comparisons: {
      baseline: string;
      candidate: string;
      deltaTokens: number;
      deltaToolCalls: number;
      deltaLlmCalls: number;
      deltaTimeMs: number;
      candidateBetter: boolean;
    }[];
  }[];
}
```

### Page

`website/src/pages/arena.astro` — StarlightPage titled "Arena results":

- Meta line: snapshot timestamp + commit + model/plugin summary.
- **Aggregates table**: label | runs | success | avg tokens |
  avg tool calls | avg LLM calls | avg time.
- **Per-task deltas table**: task | delta tokens | delta tool calls | delta LLM calls |
  delta time | verdict chip (`better` / `worse` / neutral when zero).
- Empty state when the digest is absent ("run bun run docs:arena").
- `import.meta.glob` (eager) so a missing digest never breaks the build.

### Navigation

A single link on `/pipeline/` below the reports table — "arena
results →" — mirroring how the reports index links into viewers. No
sidebar or header additions.

## Non-goals

- Running arena inside CI (no credentials; swe-2-high policy enforced
  in the arena config, not here)
- Historical trend charts (would need a results archive — follow-up)
- Per-run trace inspection on the site
