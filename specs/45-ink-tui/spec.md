# Spec 45 — Ink TUI (Interactive Terminal Renderer)

## Overview

Phase 3 of the Quality Gate UI. Adds an `InkRenderer` — a live, interactive
terminal UI built on `ink` + `react` — that renders the run as a DAG tree
with per-step status, a filterable findings list, and a policy verdict
footer. The CLI auto-detects TTY: `sverka run` uses the TUI when stdout is
a TTY and no `--format` is given; otherwise it falls back to text.

## Goals

- `InkRenderer` implementing the `Renderer` interface from spec 43, backed
  by an `ink` application.
- Step DAG rendered as an indented tree with live status glyphs:
  `✓` green (succeeded/cache-hit/compensated), `✗` red (failed),
  `●` yellow animated spinner (running/compensating),
  `○` gray (pending/ready/skipped/cancelled), `⏸` cyan (suspended).
- Findings list with a filter bar: `[all][critical][high][medium][low][new][error]`.
- Keybindings: `j`/`k` (or ↓/↑) scroll, `/` search, `f` cycle findings
  filter, `d` toggle step details, `q` quit.
- Policy verdict footer (pass/fail) once `onVerdict` is called.
- Respects terminal resize: layout adapts to `stdout.columns`/`rows`.
- CLI: `--tui` / `--no-tui` flags + TTY auto-detection.

## Non-goals

- Mouse support, tabs, or multiple panes.
- Log streaming inside the TUI (per-step details show error + diagnostics
  only, matching the HTML report).
- Interactive input to the workflow (suspend/resume prompts are a future
  engine concern).
- Alternate color themes or user-configurable keybindings.
- Windows-specific console workarounds beyond what `ink` provides.

## Interfaces

### FindingFilter

```typescript
/** Findings list filter selected via the filter bar. */
export type FindingFilter =
  | "all"       // every finding
  | "critical"  // severity === "critical"
  | "high"      // severity === "high"
  | "medium"    // severity === "medium"
  | "low"       // severity === "low"
  | "new"       // fingerprint not in baselineFingerprints (all new if no baseline)
  | "error";    // source.originalSeverity === "error" (SARIF level preserved)
```

### Step glyphs

```typescript
/** Visual presentation of a step state in the tree. */
export interface StepGlyph {
  readonly glyph: string;
  readonly color: "green" | "red" | "yellow" | "gray" | "cyan";
}

/** Map a StepState to its glyph and color. Pure. */
export function stepGlyph(state: StepState): StepGlyph;
```

Mapping:

| StepState | Glyph | Color |
|-----------|-------|-------|
| pending | `○` | gray |
| ready | `○` | gray |
| running | `●` | yellow |
| succeeded | `✓` | green |
| failed | `✗` | red |
| skipped | `○` | gray |
| cancelled | `○` | gray |
| cache-hit | `✓` | green |
| suspended | `⏸` | cyan |
| compensating | `●` | yellow |
| compensated | `✓` | green |

### DAG tree rows

```typescript
/** One rendered row of the step tree. */
export interface StepTreeRow {
  /** Step id. */
  readonly stepId: string;
  /** Tree prefix, e.g. "├─ ", "└─ ", "│  ". */
  readonly prefix: string;
  /** Depth in the tree (0 = root). */
  readonly depth: number;
}

/**
 * Flatten a DefinitionGraph into tree rows, roots first.
 * Pure: deterministic ordering — siblings sorted by step id.
 * A step reachable via multiple paths appears once (first visit in
 * deterministic BFS/DFS order); cross-links are not duplicated.
 * When `graph` is absent, every step in `state.steps` is rendered as a
 * flat root row sorted by step id.
 */
export function buildStepTree(
  graph: DefinitionGraph | null,
  state: UIState,
): readonly StepTreeRow[];
```

### Findings filter

```typescript
/**
 * Apply a FindingFilter to findings. Pure.
 * "new" compares `finding.fingerprint` against `baselineFingerprints`;
 * when `baselineFingerprints` is absent or empty, all findings are new.
 */
export function filterFindings(
  findings: readonly Finding[],
  filter: FindingFilter,
  baselineFingerprints?: readonly string[],
): readonly Finding[];
```

### InkRenderer

```typescript
/** Options for creating the interactive terminal renderer. */
export interface InkRendererOptions {
  /** Optional: the DefinitionGraph for the DAG tree view. */
  readonly graph?: DefinitionGraph;
  /** Baseline fingerprints for the [new] filter. */
  readonly baselineFingerprints?: readonly string[];
  /** Injectable stdout (defaults to process.stdout). */
  readonly stdout?: NodeJS.WriteStream;
  /** Injectable stdin (defaults to process.stdin). */
  readonly stdin?: NodeJS.ReadStream;
  /**
   * Override ink's interactive-mode detection (CI/TTY auto-detect).
   * Testability seam — normally left unset.
   */
  readonly interactive?: boolean;
}

/** A Renderer backed by an interactive ink application. */
export interface InkRenderer extends Renderer {
  /**
   * Resolves when the user quits (q / Ctrl+C) or — when stdin is not a
   * TTY — immediately after flush(). The CLI awaits this before exiting.
   */
  waitUntilExit(): Promise<void>;
}

/** Create the interactive terminal renderer. */
export function createInkRenderer(options: InkRendererOptions): InkRenderer;
```

`onEvent` feeds events through the existing `EventReducer` and triggers a
re-render. `onFindings`/`onVerdict` update the findings list and footer.
`flush()` marks the run finished; on a non-TTY stdin the app unmounts and
`waitUntilExit()` resolves.

### Errors

Reuses `ReporterError` with code `"RENDER_ERROR"` for mount failures.
A failure to mount the TUI (e.g. non-interactive stdout) is caught by the
caller, which falls back to `TextRenderer`.

## Data models

### Layout

```
┌ sverka run — <planId> ────────────────
│ Steps
│  ✓ ci/checkout        120ms
│  ├─ ● ci/build        running (attempt 2)
│  │  ├─ ○ ci/unit
│  │  └─ ○ ci/integration
│  └─ ○ ci/deploy
│ Findings [all|critical|high|medium|low|new|error]   (n shown)
│  high    eslint   src/a.ts:12  message…
│ <verdict footer>   q quit · j/k scroll · / search · f filter · d details
└──────────────────────────────────────────
```

- The step section is the DAG flattened to a tree via `buildStepTree`.
- The findings section lists filtered findings: severity, checkId,
  `file:startLine`, truncated message.
- The footer shows `Policy: PASS`/`FAIL` after `onVerdict`, or the run
  status after `run-completed`.

### Keybindings

| Key | Action |
|-----|--------|
| `j` / ↓ | scroll selection down |
| `k` / ↑ | scroll selection up |
| `/` | enter search mode; typing filters findings by substring; `Esc` exits |
| `f` | cycle the findings filter forward |
| `d` | toggle the details pane for the selected step (error, diagnostics, attempt) |
| `q` | quit (resolves `waitUntilExit`) |
| Ctrl+C | quit |

### Resize

The component reads `stdout.columns`/`stdout.rows` on every render (ink
re-renders on terminal resize). Visible rows are windowed by the current
scroll offset and available height; nothing is painted beyond the
viewport.

## CLI integration

### New flags

```
sverka run [--tui] [--no-tui] [--format text|json|html]
```

- `--tui`: force the InkRenderer even if stdout is not a TTY.
- `--no-tui`: force text output even on a TTY.
- Auto-detect: when neither flag is given and `--format` is not given,
  use the TUI iff `process.stdout.isTTY`.
- `--format` (any explicit value) always wins over auto-detection:
  `text` → TextRenderer, `json` → JSON output, `html` → HtmlRenderer.
- `--format` currently defaults to `text`; the CLI must distinguish an
  explicit `--format text` (forces TextRenderer) from the default.

### Exit codes

Unchanged. The TUI never blocks the exit code path: after the engine run
and optional evaluation complete, the CLI awaits `waitUntilExit()` and
returns the computed exit code.

## Dependencies

| Package | Dep | Type | Justification |
|---------|-----|------|---------------|
| @sverka/reporter | ink `^7` | external | React-based terminal UI |
| @sverka/reporter | react `^19.2` | external | ink peer dependency |
| @sverka/reporter | ink-testing-library | dev | headless component tests |

No other new dependencies. The spinner is implemented in-package (frame
tick on `useState` + interval); `ink-spinner` is not needed.

## Test plan

1. **stepGlyph — mapping**: every `StepState` maps to the glyph/color in
   the table above.
2. **buildStepTree — empty**: no steps → empty rows.
3. **buildStepTree — roots and children**: A→B dependency nests B under A
   with `└─` prefix and depth 1.
4. **buildStepTree — sibling order**: siblings sorted by step id;
   intermediate nodes use `├─`, last uses `└─`, ancestors contribute
   `│  ` / `   ` continuation prefixes.
5. **buildStepTree — shared dependency**: a step with two producers
   appears once.
6. **buildStepTree — no graph**: falls back to flat, id-sorted root rows
   for every step in `state.steps`.
7. **buildStepTree — steps not in graph**: steps present in state but
   absent from the graph are appended as root rows.
8. **filterFindings — severities**: `high`/`medium`/`low` match severity.
9. **filterFindings — new**: excludes fingerprints in the baseline; no
   baseline → all findings pass.
10. **filterFindings — error**: matches `source.originalSeverity === "error"`.
11. **filterFindings — all**: returns the input unchanged.
12. **InkRenderer — mount**: `createInkRenderer` returns a `Renderer` with
    `waitUntilExit`.
13. **InkRenderer — step events**: after `onEvent` step lifecycle events,
    the rendered frame contains the step id and status glyph.
14. **InkRenderer — findings**: after `onFindings`, the frame lists
    finding rows.
15. **InkRenderer — filter bar**: frame contains the filter labels.
16. **InkRenderer — verdict footer**: after `onVerdict`, the frame shows
    `Policy: FAIL`/`PASS`.
17. **InkRenderer — keybindings**: `f` cycles the active filter; `d`
    toggles the details pane; `j`/`k` move the selection.
18. **InkRenderer — search**: `/` enters search mode and typing narrows
    the findings list.
19. **InkRenderer — quit**: `q` resolves `waitUntilExit`.
20. **InkRenderer — non-TTY stdin**: `flush()` resolves `waitUntilExit`
    without user input.
21. **InkRenderer — resize**: component re-renders within new dimensions
    (columns/rows come from the injected stdout).
22. **Public API**: exports `createInkRenderer`, `buildStepTree`,
    `filterFindings`, `stepGlyph`, `FindingFilter`, `StepGlyph`,
    `StepTreeRow`, `InkRenderer`, `InkRendererOptions`.
23. **CLI integration**: `sverka run --no-tui` on a TTY uses the text
    renderer (no TUI escape codes in output).
24. **CLI integration**: `--format text` explicitly forces text output.
25. **CLI integration**: auto-detect picks TUI only when stdout is a TTY
    and no `--format`/`--no-tui` is given.
