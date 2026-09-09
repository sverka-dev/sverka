# Spec 47 — @sverka/sarif-viewer-web

## Overview

A standalone reusable HTML report generator for SARIF files. Extracted
from `@sverka/reporter`'s `HtmlRenderer` (spec 44). Produces a self-contained
HTML file with a filterable findings table, severity grouping, and a
summary header. Works with any SARIF 2.1.0 file from any tool.

## Goals

- `renderSarifWeb(options)` function accepting SARIF file path, SARIF object,
  or pre-normalized `Finding[]`, writing an HTML file.
- `generateSarifHtml(findings)` function returning an HTML string (no file I/O).
- Self-contained HTML: inline CSS + JS, no external dependencies, no CDN.
- Findings table with vanilla-JS filter (by severity), sort (by column),
  and search (text match).
- Summary header: total count, severity breakdown, tool name.
- Dark theme, responsive layout.
- CLI entry point: `npx @sverka/sarif-viewer-web [file] -o report.html`.
- No workflow runtime dependencies.

## API

```typescript
import type { Finding, NormalizeContext, SarifLog } from "@sverka/verification";

// Programmatic
export interface SarifWebOptions {
  sarif?: SarifLog;               // SARIF object
  sarifPath?: string;             // path to .sarif file
  findings?: readonly Finding[];  // pre-normalized findings
  context?: NormalizeContext;     // for normalizeSarif; defaults to
                                  // { root: cwd, checkIdPrefix: "", defaultConfidence: 0.5 }
  outputPath: string;             // where to write the HTML file
}

export function renderSarifWeb(options: SarifWebOptions): Promise<void>;

// Pure function (no I/O)
export function generateSarifHtml(findings: readonly Finding[]): string;
```

### Input resolution

Exactly one of `sarif`, `sarifPath`, `findings` must be provided. When
`sarif` or `sarifPath` is given, `normalizeSarif` is called with the
`context` option (or the default). When `findings` is given, it is used
directly.

### Summary header

The summary header shows: total finding count, severity breakdown
(critical/high/medium/low/info counts), and tool name extracted from
`Finding[0].source.tool` (or "unknown" when findings is empty).

### Self-contained output

The generated HTML has all CSS and JS inlined. No `<script src>` or
`<link href>` tags pointing to external URLs. No CDN. No ReactFlow.
The findings table uses vanilla JS for filter, sort, and search.

## Dependencies

- `peerDependencies`: none (output is static HTML)
- `dependencies`: `@sverka/verification` (for `normalizeSarif`, `Finding`, `SarifLog`)
- No `@sverka/runtime`, `@sverka/workflow`, `@sverka/reporter`
- No React runtime (HTML is generated as a string)

## Non-goals

- DAG visualization (that requires `DefinitionGraph` from the workflow package;
  stays in `@sverka/reporter`'s HTML renderer).
- Run event rendering (that stays in `@sverka/reporter`).
- Policy gate evaluation (the report shows findings; policy is the caller's job).
- Web server / live streaming (future).
- ReactFlow (the standalone viewer uses a plain table, not a DAG).

## Test plan

- Generates valid HTML from `Finding[]`.
- Accepts SARIF object and normalizes internally.
- Accepts SARIF file path and reads + normalizes.
- HTML contains all findings with correct severity badges.
- HTML is self-contained (no external script/style tags, no CDN URLs).
- Summary header shows total count, severity breakdown, and tool name.
- Filter buttons work (by severity).
- Search filters findings by text match.
- Sort by column works.
- Empty findings show "No findings" message.
- CLI: reads from file argument, writes to `-o` path.
- CLI: defaults output to `sarif-report.html` when no `-o`.
- CLI: exits with error when no input provided.
- XSS safety: finding messages with `<script>` tags are escaped.
- No workflow imports: grep confirms no `RunEvent`, `UIState`, `DefinitionGraph`.
