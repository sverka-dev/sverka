# Spec 51 — HTML run report UX rework

**Status:** Active
**Amends:** spec 44 (html-report)
**Consumers:** `@sverka/reporter` (`--format html`), website pipeline reports

## Problem

The v1 report is a poor CI viewer:

- The DAG section renders an empty box — ReactFlow's CDN UMD bundle
  doesn't provide the globals the inline script expects, so the graph
  silently never mounts. External CDN deps also make the report
  non-self-contained (offline/CSP broken).
- No run context — no commit, branch, repo URL, or CI run link. A report
  detached from what produced it is hard to trust.
- Steps are a flat list of near-empty `<details>` — no stdout/stderr, no
  timing, no parallelism visible.

## Goals

### Context section

A header block assembled programmatically by the CLI:

- `ReportContext` on `HtmlRendererOptions`: `{ title?, generatedAt,
command?, links?: { label, url }[], meta?: { label, value }[] }`.
- `links` is the open slot — callers pass clickable rows (repo URL,
  commit URL, CI run URL) without the renderer knowing GitHub/GitLab.
- CLI collects: git remote (normalized to https, credentials stripped),
  commit sha + commit link, branch; in GitHub Actions also the
  workflow-run URL from
  `GITHUB_SERVER_URL`/`GITHUB_REPOSITORY`/`GITHUB_RUN_ID`.
- All values HTML-escaped; only `http(s)` URLs render as `<a>` — other
  schemes become inert text.

### Event timestamps

`RunEvent` gains `at?: number` (epoch ms), stamped in the engine's emit
wrapper and on every directly-yielded event (`run-started`,
`run-completed`, setup-failure diagnostics) — nothing bypasses stamping.
Reducer records per-step
`startedAt`/`finishedAt` and the run window. Reports generated from
unstamped event streams still render (Gantt shows a notice instead of
fake data).

### Step views

The steps section becomes a panel with a segmented view switch —
**Gantt | DAG | Tree | List** — all rendered at generation time, toggled
by vanilla JS (no external libs):

- **Gantt**: static SVG waterfall — one row per step ordered by start
  time, bar positioned `startedAt → finishedAt`, width ∝ duration,
  colored by status, with a time axis. Real parallelism visible.
- **DAG**: static SVG from `layoutDag` — status-colored nodes with
  arrows. No ReactFlow, no CDN, works in `<noscript>` contexts and
  offline. The dependency structure that was previously invisible.
- **Tree**: nested list built from the same dependency edges — parent
  steps expand to their dependents; status icon + state per node.
- **List**: per-step rows — status icon, id, duration, expandable
  stdout/stderr tails (captured from `step-succeeded`/`step-failed`
  events, byte-capped at 64 KiB), error text.

### Layout toggle

A second segmented control — **Stacked | Split** — switches the
steps+findings area between vertical stacking and a two-column grid
(viz left, findings right). CSS only.

### Findings

Severity filter buttons, sortable columns, search — unchanged.
New: every step element in every view (Gantt row, DAG node, tree node,
the `findings` chip in list rows) carries `data-step` and is clickable.
Clicking toggles a step filter on the findings table — finding
checkIds are rule-qualified (`ci/lint:rule-id`), so a match means
equal or `stepId:`-prefix, mirroring the policy evaluator. The filter
composes with severity/search, highlights the step across all views
(`step-active`), and surfaces a dismissible chip in the findings
header; clicking the same step again or the chip clears it.

## Non-goals

- Live updating / streaming reports
- Interactive zoom/pan on the DAG (static SVG only)
- Theming beyond the existing dark palette
- Persisting toggle state across loads

## Interfaces

```typescript
interface ReportContext {
  title?: string;
  generatedAt?: string; // ISO timestamp
  command?: string; // e.g. "sverka run --format html"
  meta?: { label: string; value: string }[];
  links?: { label: string; url: string }[];
}

interface HtmlRendererOptions {
  outputPath: string;
  graph?: DefinitionGraph;
  context?: ReportContext;
}
```

Step state gains `startedAt?`, `finishedAt?`, `stdout?`, `stderr?`,
`exitCode?`. `RunEvent` gains optional `at?: number`.
