# Spec 46 — @sverka/sarif-viewer-tui

## Overview

A standalone reusable Ink-based TUI component for viewing SARIF files.
Extracted from `@sverka/reporter`'s `InkRenderer` (spec 45). Works with any
SARIF 2.1.0 file from any tool (Semgrep, CodeQL, ESLint, Bandit, etc.)
without installing Sverka's workflow runtime.

## Goals

- Reusable `<SarifTuiApp>` Ink component accepting `Finding[]` directly.
- `renderSarifTui(options)` function accepting SARIF file path, SARIF object,
  or pre-normalized `Finding[]`.
- CLI entry point: `npx @sverka/sarif-viewer-tui [file]` reads SARIF from
  file argument or stdin.
- Severity filter bar: `[all][critical][high][medium][low][info]`.
- Text search across finding messages, rules, and file paths.
- Finding detail panel: rule, file, line range, message, help URL.
- Sortable by severity, file, rule.
- Respects terminal resize.
- No workflow runtime dependencies (no `RunEvent`, `UIState`, `DefinitionGraph`).

## API

```typescript
import type { Finding, NormalizeContext, SarifLog } from "@sverka/verification";

// Programmatic
export interface SarifTuiOptions {
  sarif?: SarifLog;               // SARIF object
  sarifPath?: string;             // path to .sarif file
  findings?: readonly Finding[];  // pre-normalized findings
  context?: NormalizeContext;     // for normalizeSarif; defaults to
                                  // { root: cwd, checkIdPrefix: "", defaultConfidence: 0.5 }
}

export function renderSarifTui(options: SarifTuiOptions): Promise<void>;

// Component (for embedding in other Ink apps)
export function SarifTuiApp(props: { findings: readonly Finding[] }): JSX.Element;
```

### Input resolution

Exactly one of `sarif`, `sarifPath`, `findings` must be provided. When
`sarif` or `sarifPath` is given, `normalizeSarif` is called with the
`context` option (or the default). When `findings` is given, it is used
directly — no normalization, no context needed.

### Filter list

The standalone viewer uses 6 filters: `all`, `critical`, `high`, `medium`,
`low`, `info`. The `new` and `error` filters from `@sverka/reporter` are
excluded — they require baseline fingerprints and workflow-specific source
severity, which a standalone SARIF viewer does not have.

### Sort

The `s` key cycles sort mode: none → severity → file → rule → none.
Severity sort uses severity rank (critical > high > medium > low > info).

### Detail panel

Pressing `d` toggles a detail panel for the **selected finding** (not step).
Shows: rule, file, line range (startLine–endLine), message, helpUrl (if
present). When no finding is selected, the panel is hidden.

## Dependencies

- `peerDependencies`: `ink >=5`, `react >=18`
- `dependencies`: `@sverka/verification` (for `normalizeSarif`, `Finding`, `SarifLog`)
- No `@sverka/runtime`, `@sverka/workflow`, `@sverka/reporter`

## Non-goals

- Run event rendering (that stays in `@sverka/reporter`).
- DAG visualization (that stays in `@sverka/reporter`'s HTML renderer).
- Policy gate evaluation (the TUI shows findings; policy is the caller's job).
- Mouse support.

## Test plan

- Renders findings list from `Finding[]`.
- Accepts SARIF object and normalizes internally.
- Accepts SARIF file path and reads + normalizes.
- Severity filter cycles through 6 levels (all → critical → high → medium → low → info).
- Search filters findings by text match across message, checkId, file, rule.
- Sort cycles: none → severity → file → rule → none.
- Detail panel shows selected finding's rule, file, line range, message, helpUrl.
- Empty findings show "No findings" message.
- CLI: reads from file argument.
- CLI: reads from stdin when no argument.
- CLI: exits with error when no input provided.
- No workflow imports: grep confirms no `RunEvent`, `UIState`, `DefinitionGraph`.
