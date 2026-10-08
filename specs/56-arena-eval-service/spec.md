# Spec 56 — Arena Eval Service

**Status:** Active
**Source:** direction program sv-44n5 (strategy review, 2026-10)
**Package:** `@sverka/arena` (runner + registry), `@sverka/cli` or `sverka-arena` bin (Spec 49), `website/` (leaderboard), `@sverka/storage` (registry backend)
**Bead:** sv-44n5.4
**Related:** Spec 41 (benchmark), Spec 42 (arena), Spec 42-benchmark-dashboard, Spec 49 (arena CLI), Spec 52 (arena page + workbench)

## Overview

Arena (Specs 41/42/49) already runs agents against task scenarios
and collects traces/tokens/tool-calls/timing. The missing step
from _framework_ to _product_ is a **results registry + public
leaderboard**: scheduled runs whose outputs land in a queryable
store and render as comparisons over time (model × plugin × task
× date).

Sverka's differentiation in agent evals is **verification-grounded
scoring**: tasks are scored by deterministic sverka checks
(exit codes, findings, tests passing), not by an LLM judge. That
is the same ground truth the whole product is built on — the
arena is the product eating itself.

Two service halves:

1. **Registry** — `sverka-arena publish` commits `results.json` to
   a registry: a git-backed store (default: `arena-results` repo
   or a bucket) with an append-only `results/` tree. Scheduled CI
   runs publish nightly.
2. **Leaderboard** — the arena workbench (Spec 52) gains a
   registry-backed mode: reads published results instead of
   `.arena/` local files; renders boards per task-pack with
   success-rate, median tokens, median duration, and trend spark.

## Goals

- `sverka-arena run --publish` (or `arena publish results.json`):
  `runArena` emits a matrix `ArenaResult` (Spec 42 — one agent ×
  models × plugin sets × tasks), which publish **explodes into one
  `arena.result/v1` document per `(model, plugin-set)` cell**:
  `agent` = the run's `AgentAdapter.id`, `tasks[]` = that cell's
  `RunResult`s mapped (`taskId`→`task`, `promptHash` = sha256 of
  the task's `prompt`, `success`+`checkResults`→`score`,
  `RunMetrics`→`metrics`, trace → `traceRef` file written under
  `traces/`). `arena publish <file>` accepts a matrix
  `results.json` (same explosion) or an already-shaped
  `arena.result/v1` doc. Every emitted document validates against
  the `arena.result/v1` schema and lands at
  `results/<pack>/<agent>/<YYYY-MM-DD>/<runId>.json`.
- Registry backends: `git` (clone → write → commit → push; default,
  auditable, PR-reviewable) and `s3` (put-object; for volume).
- `sverka-arena board --pack <name>` renders the leaderboard
  locally; `website/` arena page renders it from the registry
  during Pages deploy (static, no server).
- Task packs: `arena pack init <name>` scaffolds a pack
  (`pack.json` + `tasks/*.json`); `sverka-arena run --pack <ref>`
  resolves a registry path, git URL, or local dir. Community
  contribution = a git PR adding a pack.
- Score contract: each task declares `checks` — a sverka pipeline
  (or command list) whose findings/exit status produce the
  pass/fail score. **LLM-judge scoring is out of scope**; a
  `judge:` field is reserved in the schema for a later spec.
- Comparability metadata: every published result records agent
  version, model id, plugin set, and sverka version, and every
  `TaskResult` records its prompt's `promptHash` — leaderboard
  rows are only comparable within the same pack + task + sverka
  version + prompt hash cohort.

## Non-goals

- Hosted agent execution — arena runs wherever CI already runs
  (GitHub Actions, self-hosted runners, a laptop cron). The
  _service_ is storage + rendering, not compute.
- LLM-as-judge evals — the moat is deterministic verification;
  judges reintroduce the noise sverka exists to remove.
- Real-time leaderboards — the registry is eventually-consistent
  git; a push triggers a Pages rebuild.
- Non-devin agent adapters beyond the existing abstract
  `Agent` interface (Spec 42) — new adapters are pack-level
  contributions, not core work here.
- Multi-agent orchestration evals (swarms) — follow-up.

## Interfaces

### Registry (`@sverka/arena`)

```ts
export interface ArenaResultV1 {
  readonly schema: "arena.result/v1";
  readonly runId: string;
  readonly pack: string; // e.g. "node-ci"
  readonly agent: string; // e.g. "devin"
  readonly model: string; // e.g. "claude-sonnet-4-5"
  readonly plugins: readonly string[];
  readonly sverkaVersion: string;
  readonly startedAt: string; // ISO-8601
  readonly tasks: readonly TaskResult[];
}

export interface TaskResult {
  readonly task: string;
  /** sha256 of the task prompt — a prompt edit breaks comparability. */
  readonly promptHash: string;
  readonly score: { readonly passed: boolean; readonly findings: number };
  readonly metrics: {
    readonly tokens?: number;
    readonly toolCalls?: number;
    readonly durationMs: number;
    readonly stopReason?: string;
  };
  readonly traceRef?: string; // relative path in registry
}

export interface ArenaRegistry {
  publish(result: ArenaResultV1, opts?: { traces?: string[] }): Promise<string>;
  list(query: {
    pack?: string;
    agent?: string;
    since?: string;
  }): Promise<ArenaResultV1[]>;
}

export function createGitRegistry(cfg: {
  url: string;
  branch?: string;
  dir?: string;
  token?: string;
}): ArenaRegistry;
export function createS3Registry(cfg: {
  bucket: string;
  prefix?: string; /* creds via env */
}): ArenaRegistry;
```

### Task pack

```text
<pack>/
  pack.json        # { name, version, description, defaults }
  tasks/<id>.json  # { id, prompt, repo|fixture, checks: [...], timeout? }
```

`checks` entries are sverka pipeline refs or inline step lists —
scored by the sverka engine, not by the agent's self-report.

### Leaderboard aggregation

`arena board` groups published results into cohorts keyed
`(pack, task, sverkaVersion, promptHash)` — results from
different tasks, sverka versions, or prompts never merge into one
score — and renders one `BoardRow` per `(agent, model)` inside
each cohort:

```ts
interface BoardCohort {
  readonly pack: string;
  readonly task: string;
  readonly sverkaVersion: string;
  readonly promptHash: string;
  readonly rows: readonly BoardRow[]; // one per (agent, model)
}

interface BoardRow {
  readonly agent: string;
  readonly model: string;
  readonly successRate: number; // passed tasks / total
  readonly medianTokens?: number;
  readonly medianDurationMs: number;
  readonly runs: number;
  readonly trend: readonly number[]; // success rate per day, last 30
}
```

## Data models

Registry tree (git backend):

```text
results/<pack>/<agent>/<YYYY-MM-DD>/<runId>.json
traces/<runId>/<task>.<run-index>.trace.jsonl
packs/<name>/pack.json + tasks/*.json
index.json                       # denormalized: pack → latest runIds
```

`index.json` is rebuilt by a CI job on each publish push (or by
`arena reindex`); readers never scan the tree.

## Error handling

- Schema mismatch on publish → `ArenaError(SCHEMA_INVALID)` with
  the failing fields; nothing is committed.
- Git backend push rejection (non-FF) → rebase-on-pull retry
  once, then `ArenaError(PUBLISH_CONFLICT)` — results are
  append-only, never force-pushed.
- Registry unavailable → publish keeps the local `results.json`
  and exits non-zero with the path printed (nothing is silently
  dropped).
- Board with empty registry → renders "no data" state, not a
  crash.
- `ArenaError` codes: `SCHEMA_INVALID`, `PUBLISH_CONFLICT`,
  `REGISTRY_UNAVAILABLE`, `PACK_NOT_FOUND`, `PACK_INVALID`.
  `override readonly cause`.

## Test plan

1. `ArenaResultV1` schema validation: missing `sverkaVersion` or
   `model` → `SCHEMA_INVALID` listing the field.
2. Git registry publish → clone contains the result at the
   canonical path + `index.json` updated.
3. Two sequential publishes: both present, append-only (no
   rewrite of the first).
4. `arena board` over a fixture registry of 20 runs: successRate,
   medians, and 30-day trend computed correctly.
5. Leaderboard page: `astro build` renders the board from a
   fixture registry (snapshot test), no server required.
6. Task pack: `arena pack init demo` → `pack lint` passes on the
   scaffold; `sverka-arena run --pack demo` resolves it.
7. Non-FF push → single rebase retry succeeds; injected second
   conflict → `PUBLISH_CONFLICT` and local file preserved.
8. Registry with `ro` token → publish fails, local result
   preserved, error names the path.
9. Cohort filter: results from two sverka versions never merge
   into one board row.
10. `createS3Registry` put-object path exercised against a mock
    client (no real AWS dependency in tests).

## Positioning note

Every agent-eval surface today is either a static benchmark
(SWE-bench) or a judge pipeline. A leaderboard where the score is
"did the deterministic checks pass" is both the product demo
(sverka checks ARE the scorer) and a credible eval service. If
arena data ever says sverka checks don't predict agent quality,
that finding is itself the product's most important signal.
