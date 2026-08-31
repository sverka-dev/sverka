# v1 Wave 5 — Implementation Plan

**Status:** Active
**Date:** 2026-08-31
**Architect:** architect-1
**Wave epic:** sv-wthn.5
**Features:** sv-wthn.5.1 (Markdown), sv-wthn.5.2 (Observability), sv-wthn.5.3 (Visualization), sv-wthn.5.4 (Conformance)
**Base branch:** Wave 4 tip (to be determined after Wave 4 merge)
**ADR:** ADR-017 — minimal useful versions, heavy deps deferred.

## Design decisions

1. **Markdown** = frontmatter + step list subset, `extends` escape hatch.
   Lives in `@sverka/sdk` (markdown sub-module). Uses `yaml` (existing dep).
2. **Observability** = RunReport JSON + `sverka audit` command. No OTel.
   Lives in `@sverka/runtime` (report collection) + `@sverka/cli` (audit).
3. **Visualization** = `--format mermaid` on `sverka graph`. No TUI library.
   Lives in `@sverka/cli` (graph command enhancement).
4. **Conformance** = restored `@sverka/conformance` test-only package.
   Depends on all packages, runs cross-cutting acceptance tests.

## Package layout

### Markdown (`@sverka/sdk`)

```
packages/sdk/src/markdown/
  parser.ts       — parseMarkdown() + loadMarkdownFile()
  types.ts        — MarkdownFrontmatter, MarkdownTrigger, MarkdownStep
  errors.ts       — MarkdownParseError
  index.ts        — exports
  __tests__/
    parser.test.ts
    public-api.test.ts
    helpers/fixtures.ts
```

### Observability (`@sverka/runtime` + `@sverka/cli`)

```
packages/runtime/src/engine-native/
  report.ts       — RunReport types + collectReport() + writeReport()
  (modify engine.ts — wire report collection into run())
  __tests__/
    report.test.ts

packages/cli/src/commands/
  audit.ts        — sverka audit command
  (modify main.ts — register audit command)
  __tests__/
    audit.test.ts
```

### Visualization (`@sverka/cli`)

```
packages/cli/src/commands/
  (modify graph.ts — add --format mermaid + --output)
  __tests__/
    graph-mermaid.test.ts
```

### Conformance (`@sverka/conformance`)

```
packages/conformance/
  package.json    (test-only: vitest, no main/exports)
  tsconfig.json
  vitest.config.ts
  __tests__/
    seed.test.ts
    targets.test.ts
    serialization.test.ts
    engine.test.ts
    caching.test.ts
    retry.test.ts
    suspend-resume.test.ts
    saga.test.ts
    agent.test.ts
    safe-outputs.test.ts
    network.test.ts
    queries.test.ts
    markdown.test.ts
```

## TDD steps

### Step 1: Markdown authoring (sv-wthn.5.1)

1. Write `markdown/types.ts` — frontmatter + step types.
2. Write `markdown/errors.ts` — `MarkdownParseError` + codes.
3. Write failing tests: `markdown/__tests__/parser.test.ts` (items 1-15
   from spec 37 test plan).
4. Write `markdown/parser.ts` — frontmatter extraction + step parsing +
   Project/ShellStep construction.
5. Write `markdown/index.ts` — exports.
6. Add exports to `@sverka/sdk` index.
7. Write `markdown/__tests__/public-api.test.ts` — export assertions.
8. Run gates.

### Step 2: Observability (sv-wthn.5.2)

1. Write `report.ts` — `RunReport` + `StepReport` + `AgentReport` +
   `RunSummary` types + `collectReport()` function + cost table.
2. Write failing tests: `report.test.ts` (items 1-12 from spec 38).
3. Modify `engine.ts` — wire report collection into `run()`: subscribe
   to events, build report, write to `report.json` after completion.
4. Write `commands/audit.ts` — read report.json, print summary.
5. Modify `main.ts` — register `audit` command.
6. Write `audit.test.ts` (items 13-17 from spec 38).
7. Run gates.

### Step 3: Visualization (sv-wthn.5.3)

1. Write failing tests: `graph-mermaid.test.ts` (items 1-14 from spec 39).
2. Modify `graph.ts` — add `--format mermaid` branch + `--output` flag.
3. Implement Mermaid generation: subgraphs per pipeline, nodes per step,
   color-coded edges, trigger subgraph, legend comment.
4. Run gates.

### Step 4: Conformance (sv-wthn.5.4)

1. Scaffold `@sverka/conformance` package (package.json, tsconfig,
   vitest.config).
2. Write `seed.test.ts` — 4-surface equivalence (items 1-5).
3. Write `targets.test.ts` — compile to all 6 targets (items 6-11).
4. Write `serialization.test.ts` — graph round-trip (item 12).
5. Write `engine.test.ts` — native engine execution (item 13).
6. Write feature tests: `caching.test.ts`, `retry.test.ts`,
   `suspend-resume.test.ts`, `saga.test.ts`, `agent.test.ts`,
   `safe-outputs.test.ts`, `network.test.ts`, `queries.test.ts`,
   `markdown.test.ts` (items 14-22).
7. Add to workspace + nx config.
8. Run gates.

### Step 5: Final gates

1. Full monorepo: `bun run test`, `bun run typecheck`, `bun run lint`,
   `bun run build`.
2. Verify no `any` types.
3. Verify all error classes use `override` on `cause`.

## Implementation order

Markdown first (unblocks conformance markdown tests). Then observability
+ visualization (independent, can parallelize). Conformance last (depends
on all other features being implemented).

## Estimated size

- Markdown: ~200 impl + ~250 test.
- Observability: ~250 impl + ~300 test.
- Visualization: ~150 impl + ~200 test.
- Conformance: ~50 scaffolding + ~600 test.
- Total: ~650 impl + ~1350 test = ~2000 lines.

## Commit hygiene

Stage ONLY:
- `packages/sdk/src/markdown/**`
- `packages/sdk/src/index.ts` (modified)
- `packages/runtime/src/engine-native/report.ts`
- `packages/runtime/src/engine-native/engine.ts` (modified)
- `packages/runtime/src/engine-native/__tests__/report.test.ts`
- `packages/runtime/src/engine-native/index.ts` (modified — export RunReport)
- `packages/cli/src/commands/audit.ts`
- `packages/cli/src/commands/graph.ts` (modified)
- `packages/cli/src/main.ts` (modified)
- `packages/cli/src/__tests__/audit.test.ts`
- `packages/cli/src/__tests__/graph-mermaid.test.ts`
- `packages/conformance/**`
- `specs/37-markdown-authoring/spec.md`
- `specs/38-observability/spec.md`
- `specs/39-visualization/spec.md`
- `specs/40-conformance/spec.md`
- `engdocs/adr/ADR-017-wave5-scope.md`
- `engdocs/architecture/v1-wave-5-plan.md`
- `bun.lock` (if new deps added — none expected)

EXCLUDE: city.toml, agents/, .devin/, .gc/, .beads/, formulas/.
