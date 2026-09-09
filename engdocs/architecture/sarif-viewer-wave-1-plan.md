# SARIF Viewer Wave 1 — Implementation Plan

Specs: 46 (TUI), 47 (Web). Mega-plan: `sarif-viewer-extraction-plan.md`.

## Context

`@sverka/reporter` (PR #151) has three renderers tightly coupled to
`RunEvent` / `UIState` / `DefinitionGraph`. This wave extracts the TUI and
HTML **findings viewing** portions into two standalone packages that accept
raw SARIF or `Finding[]` — no workflow runtime needed.

## What extracts vs. what stays

### Extracts (standalone packages)

| Feature | TUI (spec 46) | Web (spec 47) |
|---------|-------------|---------------|
| Findings list/table | yes | yes |
| Severity filter | yes (6 levels) | yes (buttons) |
| Text search | yes | yes |
| Sort | yes (s key cycle) | yes (column click) |
| Finding detail panel | yes (d key) | n/a (table shows all) |
| Summary header | no | yes (count + breakdown + tool) |
| CLI entry point | yes (stdin/file) | yes (file → -o) |
| Input normalization | `normalizeSarif` | `normalizeSarif` |

### Stays in `@sverka/reporter` (workflow-coupled)

- Step tree (`buildStepTree` — needs `DefinitionGraph`)
- Run status footer (needs `RunEvent` / `UIState`)
- DAG visualization (`layoutDag` + ReactFlow — needs `DefinitionGraph`)
- Policy verdict banner (needs `PolicyResult`)
- Steps section (needs `UIState`)
- `new` / `error` finding filters (need baseline fingerprints / source severity)

After extraction, `@sverka/reporter`'s `InkRenderer` and `HtmlRenderer`
delegate findings rendering to the new packages and keep the
workflow-coupled parts as adapters.

## Package 1: @sverka/sarif-viewer-tui

### Structure

```
packages/sarif-viewer-tui/
  src/
    index.ts           — public API: renderSarifTui, SarifTuiApp, SarifTuiOptions
    viewer.tsx         — SarifTuiApp Ink component + internal store
    filter-model.ts    — severity filter, search, sort (pure helpers)
    input.ts           — resolveFindings: SARIF/file/Finding[] → Finding[]
    types.ts           — SarifTuiOptions, SortMode, ViewerFilter
  __tests__/
    filter-model.test.ts
    input.test.ts
    viewer.test.tsx
    public-api.test.ts
    cli.test.ts
  bin/
    bin.mjs            — CLI entry point (stdin/file → TUI)
  package.json
  tsconfig.json
  tsdown.config.ts
  project.json
```

### Dependencies

```json
{
  "peerDependencies": { "ink": ">=5", "react": ">=18" },
  "dependencies": { "@sverka/verification": "workspace:*" },
  "devDependencies": {
    "ink": "7.1.1",
    "react": "19.2.8",
    "@types/react": "^19",
    "ink-testing-library": "4.0.0"
  }
}
```

No `@sverka/runtime`, `@sverka/workflow`, `@sverka/reporter`.

### Key design decisions

**D1 — Filter list.** 6 filters: `all`, `critical`, `high`, `medium`, `low`,
`info`. The `new` and `error` filters from reporter's `tui-model.ts` are
excluded — they require baseline fingerprints and `FindingSource.originalSeverity`,
neither of which a standalone SARIF viewer has.

**D2 — Sort.** The `s` key cycles: none → severity → file → rule → none.
Severity rank: critical=4, high=3, medium=2, low=1, info=0. Sort is stable
(preserves original order for equal keys).

**D3 — Detail panel.** The `d` key toggles a detail panel for the selected
finding (j/k navigates the findings list, not a step tree). Shows: rule,
file, startLine–endLine, message, helpUrl (if present).

**D4 — Input resolution.** `input.ts` exports `resolveFindings(options)`:
- `findings` provided → use directly
- `sarif` provided → `normalizeSarif(sarif, context)`
- `sarifPath` provided → `readFileSync` → `JSON.parse` → `normalizeSarif`
- None provided → throw
- More than one provided → throw

Default `NormalizeContext`: `{ root: process.cwd(), checkIdPrefix: "", defaultConfidence: 0.5 }`.

**D5 — SarifTuiApp component.** Accepts `{ findings: readonly Finding[] }`.
Manages its own internal store (filter, search, sort, selected, details).
No `RunEvent`, no `UIState`, no `DefinitionGraph`. Uses `useInput` for
keyboard, `useStdout` for terminal dimensions.

**D6 — CLI.** `bin.mjs` reads SARIF from file arg or stdin (when no arg).
Parses with `JSON.parse`, calls `renderSarifTui({ sarif })`. Exits 1 on
no input, 0 on quit.

### TDD steps

1. **filter-model.ts** — Write tests: `SEVERITY_FILTERS` array (6 entries),
   `filterBySeverity(findings, filter)`, `searchFindings(findings, query)`,
   `sortFindings(findings, mode)`, `severityRank(severity)`. All pure.
2. **input.ts** — Write tests: `resolveFindings` with `findings` (passthrough),
   with `sarif` (calls normalizeSarif), with `sarifPath` (reads file),
   throws on none, throws on multiple.
3. **viewer.tsx** — Write tests using `ink-testing-library`: renders findings
   list, filter cycle (f key), search (/ key), sort (s key), detail panel
   (d key), empty state, j/k navigation.
4. **index.ts** — Export `renderSarifTui`, `SarifTuiApp`, `SarifTuiOptions`.
5. **public-api.test.ts** — Assert exports match spec.
6. **cli.test.ts** — Spawn `bin.mjs` with file arg, with stdin, with no input.
7. **No-coupling test** — `grep -r "RunEvent\|UIState\|DefinitionGraph" src/`
   returns empty.

## Package 2: @sverka/sarif-viewer-web

### Structure

```
packages/sarif-viewer-web/
  src/
    index.ts           — public API: renderSarifWeb, generateSarifHtml, SarifWebOptions
    viewer.ts          — generateSarifHtml (pure), renderSarifWeb (I/O wrapper)
    input.ts           — resolveFindings (shared logic, same as TUI)
    types.ts           — SarifWebOptions
  __tests__/
    viewer.test.ts
    input.test.ts
    public-api.test.ts
    cli.test.ts
  bin/
    bin.mjs            — CLI entry point (file → -o report.html)
  package.json
  tsconfig.json
  tsdown.config.ts
  project.json
```

### Dependencies

```json
{
  "dependencies": { "@sverka/verification": "workspace:*" },
  "devDependencies": { "tsdown": "^0.22.0", "typescript": "^5.8.0", "vitest": "^4.1.11" }
}
```

No peerDependencies (output is static HTML). No React, no ink.

### Key design decisions

**D1 — generateSarifHtml is pure.** Takes `readonly Finding[]`, returns
`string`. No I/O. Extracts tool name from `findings[0]?.source.tool ?? "unknown"`.

**D2 — Self-contained HTML.** All CSS and JS inlined. No `<script src>`,
no `<link href>` to external URLs. No ReactFlow, no React, no CDN. The
findings table filter/sort/search is vanilla JS (adapted from the existing
`html-renderer.ts` JS block, which is already vanilla).

**D3 — Summary header.** Shows: total count, severity breakdown
(critical/high/medium/low/info counts), tool name. Replaces the
run-summary header (plan/status/duration) from `html-renderer.ts`.

**D4 — XSS safety.** All finding fields passed through `escapeHtml()`
before embedding. JSON data for inline `<script>` passed through
`escapeScriptData()` (replaces `<` with `\u003c`).

**D5 — What's removed from html-renderer.ts.** DAG section, steps section,
verdict banner, ReactFlow scripts, React/ReactDOM CDN scripts. Only the
findings table + summary header + CSS + vanilla JS remain.

**D6 — CLI.** `bin.mjs` reads SARIF from file arg, writes HTML to `-o` path
(default: `sarif-report.html`). Uses `process.argv` parsing (no yargs dep).

### TDD steps

1. **viewer.ts — generateSarifHtml** — Write tests: valid HTML from
   `Finding[]`, contains all findings with severity badges, summary header
   (count + breakdown + tool name), empty findings "No findings", XSS
   safety (`<script>` in message is escaped), self-contained (no external
   URLs).
2. **input.ts** — Same as TUI: `resolveFindings` with sarif/sarifPath/findings.
3. **viewer.ts — renderSarifWeb** — Write tests: writes HTML to file,
   creates parent dirs, throws on write error.
4. **index.ts** — Export `renderSarifWeb`, `generateSarifHtml`,
   `SarifWebOptions`.
5. **public-api.test.ts** — Assert exports match spec.
6. **cli.test.ts** — Spawn `bin.mjs` with file + `-o`, with file no `-o`
   (defaults), with no input (exits 1).
7. **No-coupling test** — `grep -r "RunEvent\|UIState\|DefinitionGraph" src/`
   returns empty.

## Reporter changes (after both packages land)

After both packages are extracted, `@sverka/reporter`:

1. Adds `@sverka/sarif-viewer-tui` and `@sverka/sarif-viewer-web` as
   workspace dependencies.
2. `ink-renderer.tsx` imports `SarifTuiApp` from `@sverka/sarif-viewer-tui`
   and wraps it with the step tree + run status + verdict footer.
3. `html-renderer.ts` imports `generateSarifHtml` from
   `@sverka/sarif-viewer-web` and wraps it with the DAG + steps + verdict.
4. All existing reporter tests still pass.

This is a follow-up task (not part of this wave's builder scope). The
extraction packages must work standalone first.

## Scaffolding

Both packages follow the existing pattern (`.mjs`/`.d.mts` dist, tsdown,
vitest, eslint, project.json with nx targets). See `packages/reporter`
as template.

## Verification

```bash
# Per package
cd packages/sarif-viewer-tui && bun run test && bun run typecheck && bun run lint && bun run build
cd packages/sarif-viewer-web && bun run test && bun run typecheck && bun run lint && bun run build

# No-coupling
grep -r "RunEvent\|UIState\|DefinitionGraph" packages/sarif-viewer-tui/src/ packages/sarif-viewer-web/src/

# Full monorepo (reporter tests must still pass — packages are additive)
bun run test
```
