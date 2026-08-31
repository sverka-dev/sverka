# ADR-017 — Wave 5 Scope: Markdown Authoring, Observability, Visualization, Conformance

**Status:** Active
**Date:** 2026-08-31
**Related:** ADR-009 (v0 redesign), ADR-016 (Wave 4 code-gen targets), architecture spec §9 (Authoring Surfaces), §22 (Native Engine), §30 (CLI), §33-34 (Conformance)

## Context

v1 mega-plan Wave 5 (sv-wthn.5) is a P2 "DX & Polish" wave with four
features: Markdown authoring, cost/token observability, graph
visualization, and conformance suite expansion. The mega-plan describes
them with aspirational scope (OTel exporter, interactive TUI, etc.).

The architecture spec §9 lists three authoring surfaces (Construct, SDK,
Decorator). Markdown would be a fourth — the spec doesn't mention it,
but §9 doesn't forbid additional surfaces. §30 lists `sverka graph` as a
CLI command. §33-34 define conformance as the acceptance gate.

## Decisions

### 1. Markdown authoring = frontmatter + step list, NOT a full model

Markdown authoring covers a **deliberate subset**: triggers (push, pull
request, manual, schedule) + steps with shell commands + dependencies +
runtime image. No matrix, conditions, expressions, agent steps, saga,
or advanced features. An `extends: ./sverka.config.ts` escape hatch lets
users mix Markdown with full TypeScript for complex cases. This matches
gh-aw's format and the actual use case (AI-generated workflows, non-TS
users, simple pipelines).

### 2. Observability = structured run report + `sverka audit`, NOT OTel

The mega-plan asks for an OTel exporter. OTel requires
`@opentelemetry/api` + exporter packages as runtime dependencies —
violating §29's "optional connectors SHOULD not become mandatory deps"
principle. Instead:

- **Run report**: a structured JSON object (RunReport) collecting
  duration, per-step timings, cache hits/misses, and agent token usage
  (already in `AgentResult.usage`). The engine emits it as a final
  `run-report` event or writes it to `.sverka/runs/<runId>/report.json`.
- **`sverka audit`**: CLI command that reads report.json and prints a
  human-readable summary (total duration, step table, cache stats, AI
  cost table with tokens/model/estimated $).
- **OTel exporter**: deferred to a follow-up bead in `@sverka/plugin-otel`
  (optional package). The RunReport structure is the seam — an OTel
  exporter translates it to spans later.

### 3. Visualization = Mermaid output + text tree, NOT interactive TUI

An interactive TUI requires a terminal UI library (blessed, ink, etc.)
— a heavy dependency for a P2 feature. Instead:

- **`sverka graph --format mermaid`**: emits a Mermaid flowchart diagram
  to stdout. Users paste it into GitHub/GitLab markdown or render with
  `mmdc`. Shows construct tree (subgraph per pipeline) + execution DAG
  with color-coded edges (control=solid, value=dashed, artifact=dotted).
- **`sverka graph --format tree`** (default, existing): unchanged text
  tree output.
- **`sverka graph --format json`** (existing): unchanged.
- **Interactive TUI**: deferred to a follow-up bead. The Mermaid output
  is the 90% solution — renders in any markdown viewer.

### 4. Conformance = test suite in `@sverka/conformance`, NOT a new package

The `@sverka/conformance` package was dropped in the refactor (commit
47b9b1c). We restore it as a test-only package (no runtime exports,
just vitest tests) that verifies v1 features produce valid Definition
Graphs and compile to all targets. It depends on all packages and runs
cross-cutting acceptance tests. This matches the original Wave M design.

## Rationale

Wave 5 is P2. Each feature gets the minimal useful version. Heavy
dependencies (OTel, TUI libraries) are deferred to optional follow-up
packages. The core value — Markdown for non-TS users, run reports for
cost visibility, Mermaid for graph visualization, conformance for
acceptance — ships without bloating the core.

## Consequences

- `@sverka/sdk` gains a `parseMarkdown(source)` function that returns a
  `Project` construct (Markdown → Construct API → synthesize).
- `@sverka/runtime` gains `RunReport` type + report collection in the
  engine (event aggregation, no new deps).
- `@sverka/cli` gains `audit` command + `--format mermaid` on `graph`.
- `@sverka/conformance` restored as test-only package.
- Follow-up beads: `@sverka/plugin-otel` (OTel exporter), interactive
  TUI, Markdown advanced features (matrix/conditions in frontmatter).
