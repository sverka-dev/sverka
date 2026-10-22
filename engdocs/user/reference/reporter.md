# Run reporting (@sverka/reporter)

`@sverka/reporter` turns an engine `RunEvent` stream into human output:
a vitest-style text renderer for the terminal, a self-contained HTML run
report, and an interactive Ink TUI — plus the pure plumbing they share
(event reducer, findings collector, policy gate, DAG layout). It is what
`sverka run` uses for `--format text|html` and `--tui` (Specs 43–45, 51).

```text
engine RunEvents ──→ EventReducer (pure) ──→ UIState
                                               │
SARIF artifacts ──→ collectFindings ──→ FindingRow[]
                                               │
findings + policy ──→ evaluateGate ──→ verdict + exit code
                                               │
            ┌──────────────┬───────────────────┴──┐
            ▼              ▼                      ▼
     TextRenderer    HtmlRenderer            InkRenderer
     (stdout)        (.sverka/runs/          (opt-in TUI)
                     <runId>/report.html)
```

## The Renderer contract

Every format implements one interface — events stream in during the run,
findings and the verdict arrive after it:

```ts
interface Renderer {
  onEvent(event: RunEvent): void; // per engine event
  onFindings(findings: readonly Finding[]): void; // after --evaluate
  onVerdict(result: PolicyResult): void; // after policy eval
  flush(): void; // final write — file renderers emit here
}
```

## The reducer (pure)

`reduceEvent(state, event)` folds a `RunEvent` into an immutable
`UIState`; `createInitialState()` starts empty. `UIState` holds
`runId`/`planId`, run `status`, `durationMs`, a `Map<stepId,
StepUIState>` (state, duration, error, retry attempt), and a
`DiagnosticEntry[]` log. Because it's pure and total — it only consumes
existing event types — the same state drives text, HTML, and TUI without
per-format bookkeeping.

## Collecting findings

`collectFindings` scans per-step SARIF artifacts and attributes each
finding to the step that produced it:

```ts
import { collectFindings } from "@sverka/reporter";

const rows = await collectFindings({
  artifactDir: ".sverka/artifacts",
  runId, // scan only <artifactDir>/<runId>/ — preferred, exact scope
});
// rows: FindingRow[] = { finding, stepId }[]
```

Artifacts live at `<artifactDir>/<runId>/<stepId>/<name>.sarif`; the
`runId` scope is the identity boundary (a `sinceMs` fallback exists for
legacy, non-run-keyed trees). Non-SARIF files are ignored; unparseable
SARIF throws `ReporterError(COLLECTION_FAILED)`.

## The policy gate

`evaluateGate` wraps `evaluatePolicy` (`@sverka/verification`) for CLI
use — it supplies `DEFAULT_POLICY` when none is given and maps the
verdict to an exit code:

```ts
import { evaluateGate } from "@sverka/reporter";

const { result, exitCode } = evaluateGate({
  findings,
  baselineFingerprints, // optional — onlyNew filtering is per-rule
});
// exitCode: 0 pass, 1 fail
```

## Text output (default)

`createTextRenderer({ writer, color?, stepOutputLines? })` prints
vitest-style status lines as events arrive — `○` pending, `▶` running,
`✓` succeeded, `✗` failed, `⊘` skipped — with durations and the tail of
each step's captured stdout/stderr (default last 20 lines, sanitized of
terminal escapes). After the run: a findings summary by severity and the
policy verdict. `color` should come from `stdout.isTTY` (the CLI honors
`NO_COLOR`/`TERM=dumb`).

## HTML report

`createHtmlRenderer({ outputPath, graph?, context? })` buffers events
and writes one self-contained HTML file on `flush()` — inline CSS/JS, no
CDN, works offline and under CSP. Per Spec 51 the report carries:

- **Context header** — `ReportContext` assembled by the caller (title,
  generated-at, command line, meta rows like branch/cwd, clickable links
  like repo/commit/CI-run URLs). The renderer escapes values and only
  renders `http(s)` links — it never derives URLs itself.
- **Step views** — a segmented **Gantt | DAG | Tree | List** switch, all
  pre-rendered at generation time: an SVG waterfall showing real
  parallelism, a status-colored static SVG of the dependency graph, a
  nested tree, and per-step rows with expandable stdout/stderr tails
  (byte-capped at 64 KiB).
- **Findings table** — severity filter, sortable columns, search; and
  every step element is clickable to filter findings to that step.
- **Verdict banner** — pass/fail with the policy summary.
- **Layout toggle** — Stacked | Split for the steps+findings area.

The DAG view positions nodes with `layoutDag` — dagre (Sugiyama)
under the hood, `direction: "LR"` (default) or `"TB"`:

```ts
import { layoutDag } from "@sverka/reporter";

const { nodes, edges } = layoutDag(graph, { direction: "TB" });
// DagNode: { id, label, x, y, layer } · DagEdge: { source, target, label? }
```

## Interactive TUI

`createInkRenderer(options?)` renders the run live — a DAG tree of
per-step glyphs, a filterable findings list, and a verdict footer. The
pure half is exported for reuse: `stepGlyph(state)` maps `StepState` →
glyph+color, `buildStepTree(graph, state)` flattens the graph into
deterministic `StepTreeRow[]`, and `filterFindings`/`searchFindings`
drive the `FINDING_FILTERS` bar
(`all|critical|high|medium|low|new|error`).

```ts
import { createInkRenderer } from "@sverka/reporter";

const renderer = createInkRenderer({
  graph, // optional — flat list when absent
  baselineFingerprints, // enables the [new] filter
});
// renderer implements Renderer + a promise that resolves when the
// user quits (q / Ctrl+C) — the CLI awaits it before exiting
```

Keybindings: `j`/`k` scroll, `/` search, `f` cycle filter, `d` step
detail, `q` quit. `interactive`/`debug`/`stdout`/`stdin` options are
testability seams — normally left unset.

## CLI wiring

| Flag / format                       | Effect                                                                                      |
| ----------------------------------- | ------------------------------------------------------------------------------------------- |
| `--format text` (default)           | `TextRenderer` → stdout                                                                     |
| `--format json`                     | `sverka.run/v1` payload → stdout + `.sverka/runs/<id>/report.json`                          |
| `--format html` / `--output <path>` | `HtmlRenderer` → file (implies `--evaluate`)                                                |
| `--report <path>`                   | Relocate the per-run HTML report                                                            |
| `--format sarif` / `web`            | `serializeSarif` / `generateSarifHtml` (`@sverka/verification`, `@sverka/sarif-viewer-web`) |
| `--evaluate`                        | `collectFindings` + `evaluateGate` after the run                                            |
| `--tui`                             | `InkRenderer` (opt-in; never auto-selected — text is always default)                        |
| `--step-output-lines N`             | Text renderer tail length (`0` disables)                                                    |

Every run writes `.sverka/runs/<runId>/report.json` (schema
`sverka.run/v1`, append-only) and `report.html`; human output ends with
the report path. `--watch` re-runs reuse the same renderer pipeline.

## Errors

`ReporterError` carries `code: "COLLECTION_FAILED" | "RENDER_ERROR"`
with `cause` — collection failures are SARIF/IO problems, render errors
are emission problems (e.g. unwritable `outputPath`).

## API summary

| Export                                                                              | Kind                                    |
| ----------------------------------------------------------------------------------- | --------------------------------------- |
| `reduceEvent`, `createInitialState`                                                 | Pure event → `UIState` reducer          |
| `collectFindings`                                                                   | SARIF artifacts → `FindingRow[]`        |
| `evaluateGate`                                                                      | Findings + policy → verdict + exit code |
| `createTextRenderer`                                                                | Vitest-style stdout renderer            |
| `layoutDag`                                                                         | `DefinitionGraph` → positioned nodes    |
| `createHtmlRenderer`                                                                | Self-contained HTML report              |
| `stepGlyph`, `buildStepTree`, `filterFindings`, `searchFindings`, `FINDING_FILTERS` | Pure TUI model                          |
| `createInkRenderer`                                                                 | Interactive terminal renderer           |
| `ReporterError`, `ReporterErrorCode`                                                | Errors                                  |

Types: `Renderer`, `UIState`, `StepUIState`, `StepState`,
`DiagnosticEntry`, `FindingRow`, `FindingsCollectorOptions`,
`PolicyGateOptions`, `PolicyGateResult`, `TextRendererOptions`,
`TextWriter`, `DagNode`, `DagEdge`, `DagLayoutResult`,
`DagLayoutOptions`, `HtmlRendererOptions`, `ReportContext`,
`FindingFilter`, `StepGlyph`, `StepTreeRow`, `InkRenderer`,
`InkRendererOptions`.

## See also

- [CLI](../running/cli.md) — `sverka run` flags end to end
- [SARIF pipeline](../findings/sarif-pipeline.md) — standalone SARIF
  viewers (`sverka view`) the report formats share normalization with
- [Policy](./policy.md), [Findings](./findings.md) — what the gate and
  collector wrap
