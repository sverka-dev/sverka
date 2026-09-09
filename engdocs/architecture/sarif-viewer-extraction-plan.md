# SARIF Viewer Extraction — Mega-Plan

## Context

PR #151 merged `@sverka/reporter` with three renderers: text, HTML, and Ink TUI.
These renderers are tightly coupled to Sverka's `RunEvent` stream and `UIState`
model. The user wants to extract the TUI and HTML renderers into **reusable
standalone packages** that accept raw SARIF (or `Finding[]`) as input — so
anyone can view SARIF from any tool (Semgrep, CodeQL, ESLint) without
installing Sverka's workflow runtime.

## Vision

```bash
# TUI — pipe any SARIF file
cat scan.sarif | npx @sverka/sarif-viewer-tui

# Web — open in browser
npx @sverka/sarif-viewer-web scan.sarif --open
```

## PR Stack

```
main
  └── feat/sarif-viewer-tui   (PR #N+1)
        └── feat/sarif-viewer-web  (PR #N+2)
```

PR1 extracts the TUI. PR2 extracts the web component (stacked on PR1 since
they share the `Finding` normalization adapter and the web component may
reference the TUI's filter model).

## Package 1: @sverka/sarif-viewer-tui

### Source

Extracted from `packages/reporter/src/ink-renderer.tsx` (already built in
PR #151). The Ink component has: severity filters, search, detail panel,
step tree, policy verdict footer.

### API

```typescript
import { renderSarifTui } from "@sverka/sarif-viewer-tui";

// From SARIF file
await renderSarifTui({ sarifPath: "scan.sarif" });

// From SARIF object
await renderSarifTui({ sarif: sarifLog });

// From Findings (already normalized)
await renderSarifTui({ findings: findings });
```

### Dependencies

- `peerDependencies`: `ink >=5`, `react >=18`
- `dependencies`: `@sverka/verification` (for `normalizeSarif`, `Finding` type)
- No workflow runtime, no CLI, no planner

### Structure

```
packages/sarif-viewer-tui/
  src/
    index.ts           — public API: renderSarifTui, SarifTuiApp
    viewer.tsx         — the Ink component (extracted from ink-renderer.tsx)
    filter-model.ts    — severity filter, search state (extracted from tui-model.ts)
    types.ts           — SarifTuiOptions, viewer-specific types
  __tests__/
    viewer.test.tsx
  package.json
```

### What changes in @sverka/reporter

- `ink-renderer.tsx` imports `<SarifTuiApp>` from `@sverka/sarif-viewer-tui`
- `tui-model.ts` filter logic moves to the new package
- `@sverka/reporter` adds `@sverka/sarif-viewer-tui` as workspace dependency
- The reporter's `InkRenderer` adapts `RunEvent` → `UIState` → passes
  findings + verdict to the reusable component

## Package 2: @sverka/sarif-viewer-web

### Source

Extracted from `packages/reporter/src/html-renderer.ts` (already built in
PR #151). The HTML report has: filterable findings table, DAG visualization,
policy verdict banner, dark theme, self-contained output.

### API

```typescript
import { renderSarifWeb } from "@sverka/sarif-viewer-web";

// From SARIF file
await renderSarifWeb({ sarifPath: "scan.sarif", outputPath: "report.html" });

// From SARIF object
await renderSarifWeb({ sarif: sarifLog, outputPath: "report.html" });

// From Findings (already normalized)
await renderSarifWeb({ findings: findings, outputPath: "report.html" });
```

### Dependencies

- `peerDependencies`: none (output is static HTML)
- `dependencies`: `@sverka/verification` (for `normalizeSarif`, `Finding` type)
- No React runtime dependency (HTML is generated server-side)

### Structure

```
packages/sarif-viewer-web/
  src/
    index.ts           — public API: renderSarifWeb, generateSarifHtml
    viewer.ts          — HTML generation (extracted from html-renderer.ts)
    filter-model.ts    — client-side filter logic (extracted from html-renderer JS)
    types.ts           — SarifWebOptions, viewer-specific types
  __tests__/
    viewer.test.ts
  package.json
```

### What changes in @sverka/reporter

- `html-renderer.ts` imports `generateSarifHtml` from `@sverka/sarif-viewer-web`
- The reporter's `HtmlRenderer` adapts `RunEvent` → `UIState` → passes
  findings + verdict + DAG layout to the reusable generator
- `@sverka/reporter` adds `@sverka/sarif-viewer-web` as workspace dependency

## Shared Design Decisions

### Input normalization

Both packages accept `SarifLog | Finding[] | { sarifPath: string }`. The
packages call `normalizeSarif` from `@sverka/verification` internally when
given SARIF input. When given `Finding[]`, they use it directly.

### No workflow coupling

Neither package imports `RunEvent`, `UIState`, `EventReducer`, `DefinitionGraph`,
or any workflow construct. They render findings — not run state. The reporter
package remains responsible for adapting run events to findings.

### CLI entry points

Both packages include a `bin.mjs` for standalone CLI usage:
- `@sverka/sarif-viewer-tui`: reads SARIF from stdin or file, renders TUI
- `@sverka/sarif-viewer-web`: reads SARIF from file, writes HTML to file

### SARIF version

Both target SARIF 2.1.0 Plus Errata 01 (the latest OASIS standard, 28 August
2023). The `normalizeSarif` function in `@sverka/verification` already
validates this version.

## Wave Execution

| Step | Agent | Task |
|------|-------|------|
| 1 | Architect | Spec 46 (TUI) + 47 (Web) + implementation plan |
| 2 | Builder | Extract `@sverka/sarif-viewer-tui` from reporter, TDD |
| 3 | Reviewer | Gate PR1: spec compliance, standalone usage, no workflow coupling |
| 4 | Mayor | Finalize PR1, create stacked branch for PR2 |
| 5 | Builder | Extract `@sverka/sarif-viewer-web` from reporter, TDD |
| 6 | Reviewer | Gate PR2: spec compliance, standalone usage, no workflow coupling |
| 7 | Mayor | Finalize PR2, create stacked PR targeting PR1 branch |

## Success Criteria

- Both packages work standalone: `npx @sverka/sarif-viewer-tui scan.sarif`
- Both packages have zero workflow runtime dependencies
- `@sverka/reporter` still works unchanged (delegates to extracted packages)
- All existing reporter tests pass
- Both packages have their own test suites
- PR stack: PR2 targets PR1, PR1 targets main
