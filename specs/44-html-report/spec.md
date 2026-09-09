# Spec 44 — HTML Report + DAG Layout

## Overview

Phase 2 of the Quality Gate UI. Adds a `DagLayout` (pure DefinitionGraph →
positioned nodes/edges) and an `HtmlRenderer` that produces a self-contained
HTML file with an interactive DAG, filterable findings table, per-step logs,
and a policy verdict banner. Wires `--format html` and `--output` into the CLI.

## Goals

- Pure `DagLayout` function: `DefinitionGraph → { nodes, edges }` with
  topological layer-based positions (no external layout library).
- `HtmlRenderer` implementing the `Renderer` interface: buffers events,
  findings, and verdict, then emits a single HTML string on `flush()`.
- Self-contained HTML: inline CSS + JS, ReactFlow loaded from CDN for the
  interactive DAG, static SVG fallback in `<noscript>`.
- Findings table with vanilla-JS filter (by severity), sort (by column),
  and search (text match).
- Per-step logs in collapsible `<details>` sections.
- Policy verdict banner (pass/fail) with color coding.
- Dark theme, responsive layout.
- CLI: `--format html` + `--output <path>` (default `.sverka/report.html`).
- `--format html` implies `--evaluate`.

## Non-goals

- Bundling ReactFlow UMD inline at build time (CDN script tag is acceptable;
  a follow-up bead can inline the bundle for offline use).
- Web server / live streaming (Phase 4).
- Interactive TUI (Phase 3, spec 45).
- Custom themes or user-configurable HTML templates.

## Interfaces

### DagLayout

```typescript
/** A positioned node in the DAG layout. */
export interface DagNode {
  readonly id: string;
  readonly label: string;
  readonly x: number;
  readonly y: number;
  readonly layer: number;
}

/** A directed edge in the DAG layout. */
export interface DagEdge {
  readonly source: string;
  readonly target: string;
  readonly label?: string;
}

/** Result of laying out a DefinitionGraph. */
export interface DagLayoutResult {
  readonly nodes: readonly DagNode[];
  readonly edges: readonly DagEdge[];
}

/** Layout options. */
export interface DagLayoutOptions {
  readonly nodeSpacingX?: number;  // default 200
  readonly nodeSpacingY?: number;  // default 80
}

/**
 * Compute a topological layer-based layout for a DefinitionGraph.
 * Pure: no side effects, deterministic output for the same input.
 */
export function layoutDag(
  graph: DefinitionGraph,
  options?: DagLayoutOptions,
): DagLayoutResult;
```

### HtmlRenderer

```typescript
/** Options for creating an HTML renderer. */
export interface HtmlRendererOptions {
  /** Where to write the HTML file on flush(). */
  readonly outputPath: string;
  /** Optional: the DefinitionGraph for DAG rendering. */
  readonly graph?: DefinitionGraph;
}

/** Create an HTML renderer that writes a self-contained report on flush(). */
export function createHtmlRenderer(options: HtmlRendererOptions): Renderer;
```

The `HtmlRenderer` implements the existing `Renderer` interface from spec 43.
It buffers `onEvent` calls via `EventReducer`, stores findings and verdict
from `onFindings`/`onVerdict`, and on `flush()` writes the complete HTML
file to `outputPath`.

### Errors

Reuses `ReporterError` with code `"RENDER_ERROR"` (already defined in spec 43).

## Data models

### DAG layout algorithm

1. **Collect steps**: flatten all `pipeline.steps` across all pipelines in
   the graph. Each step becomes a `DagNode` with `id = step.id`,
   `label = step.id`.
2. **Build edges**: for each step, for each `dependency`, create a
   `DagEdge` from `dependency.producer` → `step.id`. Edge label is the
   dependency kind (`control`, `value`, `artifact`).
3. **Layer assignment**: compute the longest path from any root (node with
   no incoming edges) to each node. `layer = longest path length`. Roots
   are layer 0.
4. **Positioning**: `x = layer * nodeSpacingX`,
   `y = indexWithinLayer * nodeSpacingY`. Nodes within the same layer are
   ordered alphabetically by id for determinism.
5. **Isolated nodes** (no edges) are placed at layer 0.

### HTML structure

```
<!DOCTYPE html>
<html>
<head>
  <meta charset="utf-8">
  <meta name="viewport" content="width=device-width, initial-scale=1">
  <title>Sverka Run Report</title>
  <style>/* inline dark theme CSS */</style>
</head>
<body>
  <header><!-- run summary: planId, status, duration --></header>
  <section id="verdict"><!-- policy verdict banner --></section>
  <section id="dag"><!-- ReactFlow container + noscript SVG fallback --></section>
  <section id="findings"><!-- filterable findings table --></section>
  <section id="steps"><!-- per-step collapsible details --></section>
  <script src="react-cdn"></script>
  <script src="reactdom-cdn"></script>
  <script src="reactflow-cdn"></script>
  <script>/* inline data + ReactFlow init + findings table JS */</script>
</body>
</html>
```

### Findings table

- Columns: severity, checkId, file, line, message, stepId.
- Filter buttons: All, Critical, High, Medium, Low, Info.
- Search input: filters rows by text match across all columns.
- Sort: click column header to toggle ascending/descending.
- Vanilla JS (no framework) — event listeners on filter buttons, search
  input, and column headers.

### Per-step logs

Each step from `UIState.steps` gets a `<details>` element:
- Summary line: status icon + stepId + duration.
- Body: error message (if failed), diagnostics (if any), attempt count
  (if retried).

### Policy verdict banner

- Green background for "pass", red for "fail".
- Shows verdict text + summary from `PolicyResult`.

## CLI integration

### New flags

```
sverka run [--format text|json|html] [--output <path>] [--evaluate]
```

- `--format html`: produces a self-contained HTML report. Implies
  `--evaluate` (always collects findings + evaluates policy).
- `--output <path>`: output file path for HTML format. Default:
  `.sverka/report.html`. Only used with `--format html`.
- When `--format html`, the text/JSON output is suppressed; the HTML file
  is the sole output.

### Exit codes

Unchanged: `0` success, `1` policy fail, `2` usage, `3` runtime error.
When `--format html` and policy fails, exit code is `1`.

## Dependencies

| Package | Dep | Type | Justification |
|---------|-----|------|---------------|
| @sverka/reporter | @sverka/workflow | workspace | DefinitionGraph (type-only, for DagLayout) |

No new external dependencies. ReactFlow is loaded from CDN at view time,
not a package dependency.

## Test plan

1. **DagLayout — empty graph**: returns empty nodes and edges arrays.
2. **DagLayout — single step**: one node at layer 0, position (0, 0), no
   edges.
3. **DagLayout — linear chain**: A→B→C produces 3 nodes with layers 0, 1, 2
   and 2 edges.
4. **DagLayout — diamond**: A→B, A→C, B→D, C→D produces 4 nodes with D at
   layer 2.
5. **DagLayout — edge labels**: edges carry dependency kind as label.
6. **DagLayout — determinism**: same graph always produces same positions.
7. **DagLayout — isolated node**: a step with no dependencies and no
   dependents is placed at layer 0.
8. **DagLayout — custom spacing**: nodeSpacingX/Y options affect positions.
9. **HtmlRenderer — basic structure**: flush() produces HTML with DOCTYPE,
   title, header, sections.
10. **HtmlRenderer — run summary**: HTML contains planId, status, duration.
11. **HtmlRenderer — step details**: HTML contains a `<details>` element
    per step with status and duration.
12. **HtmlRenderer — findings table**: HTML contains a table with finding
    rows when onFindings is called.
13. **HtmlRenderer — verdict banner**: HTML contains verdict banner with
    pass/fail text.
14. **HtmlRenderer — no findings**: when onFindings not called, findings
    section shows "No findings" message.
15. **HtmlRenderer — DAG data**: HTML contains inline JSON with DagLayout
    nodes and edges.
16. **HtmlRenderer — dark theme**: HTML contains CSS with dark color scheme.
17. **HtmlRenderer — writes file**: flush() writes the HTML to outputPath.
18. **HtmlRenderer — ReactFlow CDN**: HTML includes ReactFlow script tag.
19. **HtmlRenderer — filter JS**: HTML contains vanilla JS for findings
    filter/sort/search.
20. **Public API**: exports `layoutDag`, `createHtmlRenderer`, `DagNode`,
    `DagEdge`, `DagLayoutResult`, `DagLayoutOptions`, `HtmlRendererOptions`.
21. **CLI integration**: `sverka run --format html --output <path>` produces
    an HTML file.
22. **CLI integration**: `--format html` implies `--evaluate` (findings
    collected even without explicit flag).
23. **CLI integration**: `--format html` default output is
    `.sverka/report.html`.
