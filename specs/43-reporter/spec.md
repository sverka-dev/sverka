# Spec 43 — @sverka/reporter

## Overview

A new `@sverka/reporter` package that renders engine run events, collected
findings, and policy verdicts in multiple formats. Phase 1 delivers the
renderer core (interface, event reducer, findings collector, policy gate)
and a vitest-style text renderer wired into `sverka run`.

## Goals

- Provide a `Renderer` interface that all output formats implement (text,
  HTML, TUI).
- Accumulate `RunEvent` streams into a queryable `UIState` via a pure
  `EventReducer`.
- Collect SARIF artifacts from `.sverka/artifacts/<stepId>/` and normalize
  them into `Finding[]` with step attribution.
- Wrap existing `evaluatePolicy` + `filterOnlyNew` into a `PolicyGate` that
  returns a verdict and exit code.
- Render vitest-style text output: per-step status lines with ✓/✗/●/○ +
  duration, findings summary, policy verdict.
- Wire `--format text` and `--evaluate` into `sverka run`.

## Non-goals (Phase 1)

- HTML report (Phase 2, spec 44).
- Interactive TUI (Phase 3, spec 45).
- DAG layout / visualization (Phase 2).
- Web server / live streaming (future).
- New RunEvent types — the reducer consumes existing events only.
- Custom policy configuration from CLI — uses `DEFAULT_POLICY` or config
  file policy if present.

## Interfaces

### Renderer

```typescript
/** A renderer consumes run events, findings, and a policy verdict. */
export interface Renderer {
  /** Called for each RunEvent as the engine produces it. */
  onEvent(event: RunEvent): void;
  /** Called after the run completes with collected findings (if --evaluate). */
  onFindings(findings: readonly Finding[]): void;
  /** Called after policy evaluation with the verdict (if --evaluate). */
  onVerdict(result: PolicyResult): void;
  /** Called once after all output is done. Flush buffers, close handles. */
  flush(): void;
}
```

### UIState

```typescript
/** Accumulated state from a RunEvent stream. */
export interface UIState {
  readonly runId: string | null;
  readonly planId: string | null;
  readonly status: RunStatus | null;
  readonly durationMs: number | null;
  readonly steps: ReadonlyMap<string, StepUIState>;
  readonly diagnostics: readonly DiagnosticEntry[];
}

export interface StepUIState {
  readonly stepId: string;
  readonly state: StepState;
  readonly durationMs?: number;
  readonly error?: string;
  readonly attempt?: number;
}

export type StepState =
  | "pending"
  | "ready"
  | "running"
  | "succeeded"
  | "failed"
  | "skipped"
  | "cancelled"
  | "cache-hit"
  | "suspended"
  | "compensating"
  | "compensated";

export interface DiagnosticEntry {
  readonly stepId: string;
  readonly message: string;
  readonly severity: "info" | "warn" | "error";
}
```

### EventReducer

```typescript
/** Pure function: accumulate a RunEvent into the current UIState. */
export function reduceEvent(state: UIState, event: RunEvent): UIState;
/** Create an empty UIState. */
export function createInitialState(): UIState;
```

### FindingsCollector

```typescript
/** Options for collecting findings from the artifact directory. */
export interface FindingsCollectorOptions {
  readonly artifactDir: string;
}

/** Collect findings from SARIF files in the artifact directory. */
export function collectFindings(
  options: FindingsCollectorOptions,
): Promise<readonly FindingRow[]>;

/** A finding attributed to the step that produced it. */
export interface FindingRow {
  readonly finding: Finding;
  readonly stepId: string;
}
```

### PolicyGate

```typescript
/** Options for evaluating the policy gate. */
export interface PolicyGateOptions {
  readonly findings: readonly Finding[];
  readonly policy?: Policy;
  readonly baselineFingerprints?: readonly string[];
}

/** Evaluate the policy gate. Returns the result and appropriate exit code. */
export function evaluateGate(options: PolicyGateOptions): PolicyGateResult;

export interface PolicyGateResult {
  readonly result: PolicyResult;
  readonly exitCode: number;
}
```

`evaluatePolicy` from `@sverka/verification` already accepts
`baselineFingerprints: readonly string[]` and handles `onlyNew` filtering
per rule internally. The PolicyGate is a thin wrapper that supplies
`DEFAULT_POLICY` when none is provided and maps the verdict to an exit
code. `filterOnlyNew` is NOT needed — `evaluatePolicy` handles it.

### TextRenderer

```typescript
/** Options for creating a text renderer. */
export interface TextRendererOptions {
  readonly writer: OutputWriter;
}

/** Create a vitest-style text renderer. */
export function createTextRenderer(options: TextRendererOptions): Renderer;
```

### Errors

```typescript
export type ReporterErrorCode = "COLLECTION_FAILED" | "RENDER_ERROR";

export class ReporterError extends Error {
  readonly code: ReporterErrorCode;
  override readonly cause: unknown;
  constructor(message: string, code: ReporterErrorCode, cause?: unknown);
}
```

## Data models

### Artifact directory layout

The engine writes per-step artifacts to `<artifactDir>/<stepId>/<outputName>`.
The FindingsCollector scans `<artifactDir>/` for subdirectories, then reads
any `*.sarif` or `*.sarif.json` files within each step directory.

### Finding attribution

Each SARIF file found in `<artifactDir>/<stepId>/` produces findings
attributed to that `stepId`. The `Finding.checkId` is preserved from
normalization; `FindingRow.stepId` is the directory name.

### Policy evaluation

`PolicyGate` uses `DEFAULT_POLICY` when no policy is provided.
`baselineFingerprints` are passed directly to `evaluatePolicy`, which
handles `onlyNew` filtering per rule internally. The exit code is `0` for
pass, `1` for fail.

## CLI integration

### New flags

```
sverka run [--format text|json] [--evaluate] [--executor host|docker] [--entry <id>]
```

- `--format text` (renamed from `--format human`): vitest-style output via
  TextRenderer. Default when stdout is a TTY.
- `--format json`: existing JSON output. Default when not a TTY.
- `--evaluate` (new): after run completes, collect SARIF artifacts, run
  findings normalization + policy evaluation, pass to renderer.

### TextRenderer output format

```
▶ run started (plan: <planId>)

  ○ ci/lint        pending
  ◇ ci/lint        ready
  ▶ ci/lint        running
  ✓ ci/lint        succeeded (120ms)
  ✗ ci/test        failed (340ms) — exit code 1
  ⊘ ci/deploy      skipped

■ run completed: success (560ms)

Findings (12 total):
  high    3   ci/lint
  medium  5   ci/test
  low     4   ci/test

Policy: FAIL — 3 high findings exceed threshold
```

When `--evaluate` is not set, the findings and policy sections are omitted.

### Exit codes

Unchanged: `0` success, `1` policy fail, `2` usage, `3` runtime error.
When `--evaluate` is set and policy fails, exit code is `1` regardless of
run status.

## Dependencies

| Package | Dep | Type | Justification |
|---------|-----|------|---------------|
| @sverka/reporter | @sverka/runtime | workspace | RunEvent, RunStatus types |
| @sverka/verification | workspace | normalizeSarif, evaluatePolicy, filterOnlyNew, Finding, Policy, PolicyResult |
| @sverka/workflow | workspace | DefinitionGraph (type-only, for future DAG layout) |

No new external dependencies in Phase 1.

## Test plan

1. **EventReducer — initial state**: `createInitialState()` returns empty
   state with null runId/planId/status and empty steps map.
2. **EventReducer — run-started**: `reduceEvent` with `run-started` sets
   runId and planId.
3. **EventReducer — step lifecycle**: `step-pending` → `step-ready` →
   `step-started` → `step-succeeded` transitions update StepUIState.state
   and durationMs.
4. **EventReducer — step-failed**: sets state to "failed", stores error
   message and durationMs.
5. **EventReducer — step-skipped/cancelled**: sets appropriate state.
6. **EventReducer — step-cache-hit**: sets state to "cache-hit".
7. **EventReducer — step-retry**: stores attempt number.
8. **EventReducer — run-completed**: sets status and durationMs.
9. **EventReducer — diagnostic**: appends to diagnostics array.
10. **EventReducer — pure**: calling reduceEvent does not mutate the input
    state (returns new object).
11. **FindingsCollector — empty dir**: returns empty array when artifact
    dir does not exist or is empty.
12. **FindingsCollector — single step**: reads SARIF from one step
    directory, normalizes, attributes findings to that stepId.
13. **FindingsCollector — multiple steps**: merges findings from multiple
    step directories.
14. **FindingsCollector — invalid SARIF**: throws ReporterError
    (COLLECTION_FAILED) for invalid JSON.
15. **FindingsCollector — non-SARIF files**: ignores files without .sarif
    extension.
16. **PolicyGate — pass**: no findings → verdict "pass", exit code 0.
17. **PolicyGate — fail**: high findings → verdict "fail", exit code 1.
18. **PolicyGate — baseline**: baseline fingerprints passed to
    evaluatePolicy, which filters per-rule via `onlyNew`.
19. **PolicyGate — default policy**: uses DEFAULT_POLICY when none provided.
20. **TextRenderer — step events**: produces ✓/✗/●/○ lines with stepId
    and duration.
21. **TextRenderer — run completed**: produces ■ line with status.
22. **TextRenderer — findings**: produces findings summary with counts by
    severity and checkId.
23. **TextRenderer — verdict**: produces policy verdict line.
24. **TextRenderer — no evaluate**: omits findings and verdict sections.
25. **TextRenderer — flush**: no-ops (text renderer writes immediately).
26. **Public API**: exports match spec (Renderer, UIState, reduceEvent,
    createInitialState, collectFindings, evaluateGate, createTextRenderer,
    ReporterError, ReporterErrorCode, FindingRow, StepUIState, StepState).
27. **CLI integration**: `sverka run --format text` produces vitest-style
    output.
28. **CLI integration**: `sverka run --evaluate` collects findings and
    evaluates policy after run.
29. **CLI integration**: `sverka run --evaluate` exits 1 when policy fails.
30. **CLI integration**: `sverka run --format json --evaluate` includes
    findings and verdict in JSON output.
