# Spec 52 — Arena workbench on the website + sverka report dogfooding

## Problem

Arena runs (`sverka-arena run`) produce `results.json` under
`packages/arena/.arena/` — gitignored, local-only. The arena workbench
(`website/public/benchmark/`) already exists as a standalone SPA, but on
GitHub Pages it had no fresh data: its live CRUD server only runs
locally, and the committed sample was stale.

Second gap: the workbench shows raw traces as a chat transcript. There
was no way to see **what the agent did over time** — which is exactly
what the sverka pipeline report (Gantt/DAG/findings) already renders.
Dogfooding: render an agent run as a sverka report.

## Constraints

- No agent credentials in CI — arena results are a **committed
  snapshot**, refreshed manually via `bun run docs:arena` after a local
  `sverka-arena run`.
- Static host — mutation UI (edit/delete/run) must be hidden when the
  API server is absent; data comes from committed JSON files.
- `website/` is not an npm workspace member — scripts import arena
  sources by relative path; the module's `@sverka/*` imports resolve to
  built `dist/` (`bun run build` first).
- ACP traces carry **no usable per-step timestamps** — the collector
  stamps every step with the same time. Reports mark synthesized
  timing explicitly; the run total (`executionTimeMs`) is real.

## Design

### Snapshot pipeline (`website/scripts/update-arena-results.ts`)

- `packages/arena/.arena/results.json` → `public/benchmark/arena-results.json`
  (full copy, atomic tmp+rename — the SPA's default data source).
- `arena.config.ts` tasks/models/plugins → `api/cases.json`,
  `api/config.json` (task-id guard: results must reference configured
  tasks; `setup`/checks preserved).
- Per-combo traces → `traces/<taskId>/<combo>.json` where combo is
  `pluginIds.join("--")` or `no-plugins`.
- **Per-combo sverka reports** → `traces/<taskId>/<combo>.report.html`
  via `writeTraceReport`.

### Trace → report (`packages/arena/src/trace-report.ts`)

- `traceToActions` extracts a trace to agent action steps: agent-source
  steps only (system/user context dropped), adjacent duplicates
  collapsed (the collector replays turns), classified as
  `tool` (has `toolCalls`) / `think` (`isLlmCall`) / `message`.
  Labels come from `functionName` + the key argument (`command`,
  `file_path`) or a truncated message line.
- `traceToRunEvents` emits a `RunEvent` stream — one
  `step-started`/`step-succeeded` pair per action. Since real per-step
  timing does not exist, the **real** total (`executionTimeMs`) is
  allocated across steps weighted by kind (tool 4 / think 2 /
  message 1, floor 150ms) — honest total, estimated breakdown.
- `traceGraph` builds a linear-chain `DefinitionGraph` so the DAG view
  shows the action sequence.
- `writeTraceReport` renders via `createHtmlRenderer` with context
  (task/model/plugins/success + the synthetic-timing disclaimer) —
  same self-contained HTML as pipeline reports: Gantt, DAG, tree,
  list, step-click filtering.

### Workbench wiring (`public/benchmark/index.html`)

- Each run card gains a **"Timeline →"** link next to "View Full
  Trace →" pointing at `traces/<taskId>/<combo>.report.html`.
- `api/*.json` static fallback keeps the case sidebar alive on Pages;
  `static-mode` class hides mutation controls.

## Comparison story

Per task, two combos render side by side:

- `no-plugins` — raw shell/API calls one by one (`exec`, `read`,
  `write`…);
- `sverka` — the agent invokes the sverka skill/plugin and runs a whole
  verification pipeline in one step.

The Gantt view makes the difference visible at a glance: fewer, denser
tool bars vs many small ones.

## Testing

- `trace-report.test.ts`: dedupe/classify, label extraction, weighted
  duration allocation, monotonic `at`, failure status, linear chain,
  self-contained HTML output.
