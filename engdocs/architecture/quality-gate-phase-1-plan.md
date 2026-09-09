# Quality Gate UI — Phase 1 Implementation Plan

> Spec: `specs/43-reporter/spec.md`
> Mega plan: `engdocs/architecture/quality-gate-ui-plan.md`
> Branch: `feat/quality-gate-ui` off `main`
> Base: main @ f410bc5

## Scope

New `@sverka/reporter` package with:
- Renderer interface (onEvent/onFindings/onVerdict/flush)
- EventReducer (pure: RunEvent → UIState)
- FindingsCollector (I/O: scan artifact dir for SARIF)
- PolicyGate (pure: wraps evaluatePolicy + filterOnlyNew)
- TextRenderer (vitest-style stdout)
- CLI wiring: `--format text`, `--evaluate` flag

No new external deps. Workspace deps: `@sverka/runtime`, `@sverka/verification`.

## File layout

```
packages/reporter/
  package.json
  project.json
  tsconfig.json
  tsdown.config.ts
  src/
    types.ts              # Renderer, UIState, StepUIState, StepState, FindingRow, DiagnosticEntry
    reducer.ts            # reduceEvent, createInitialState (pure)
    findings-collector.ts  # collectFindings (I/O — reads artifact dir)
    policy-gate.ts        # evaluateGate (pure — wraps verification)
    text-renderer.ts      # createTextRenderer (I/O — writes to OutputWriter)
    errors.ts             # ReporterError, ReporterErrorCode
    index.ts             # public exports
  __tests__/
    reducer.test.ts
    findings-collector.test.ts
    policy-gate.test.ts
    text-renderer.test.ts
    public-api.test.ts
    helpers/
      fixtures.ts         # mock RunEvent sequences, mock SARIF, mock OutputWriter
```

## CLI changes

```
packages/cli/src/
  types.ts                # format: "text" | "json" (rename "human" → "text")
  commands/run.ts         # wire TextRenderer + FindingsCollector + PolicyGate
  main.ts                 # register --evaluate flag
```

## TDD steps

### Step 0: Scaffold package

Create `packages/reporter/` with package.json, project.json, tsconfig.json,
tsdown.config.ts, and empty `src/index.ts`. Add to root `package.json`
workspaces if needed. Run `bun install`.

- package.json: `@sverka/reporter`, type module, exports `./dist/index.mjs`
  + `./dist/index.d.mts`, deps `@sverka/runtime` + `@sverka/verification`
  (workspace:*), scripts test/typecheck/lint/build matching other packages.
- project.json: nx targets matching pattern (test: vitest run, typecheck:
  tsc --noEmit, lint: eslint src, build: tsdown).
- tsconfig.json: extends root, strict, ESM.
- tsdown.config.ts: entry `src/index.ts`, format esm, dts.

### Step 1: Types + errors (test-first)

Write `public-api.test.ts` asserting all exports exist. Write `errors.test.ts`
asserting ReporterError has code, cause, override. Implement `types.ts` and
`errors.ts`.

- `types.ts`: Renderer, UIState, StepUIState, StepState, DiagnosticEntry,
  FindingRow, FindingsCollectorOptions, PolicyGateOptions, PolicyGateResult,
  TextRendererOptions.
- `errors.ts`: ReporterError extends Error, code: ReporterErrorCode,
  override readonly cause.

### Step 2: EventReducer (pure, test-first)

Write `reducer.test.ts` (tests 1-10 from spec). Implement `reducer.ts`:
- `createInitialState()`: returns empty UIState.
- `reduceEvent(state, event)`: pure switch on event.type, returns new UIState.
  - run-started: set runId, planId
  - step-pending/ready/started: set step state
  - step-succeeded: set state + durationMs
  - step-failed: set state + durationMs + error
  - step-skipped/cancelled: set state
  - step-cache-hit: set state to "cache-hit"
  - step-retry: set state to "running" + attempt
  - step-suspended: set state to "suspended"
  - step-compensating/compensated: set state
  - run-completed: set status + durationMs
  - diagnostic: append to diagnostics
  - run-suspended/resumed: update status

### Step 3: PolicyGate (pure, test-first)

Write `policy-gate.test.ts` (tests 16-19 from spec). Implement `policy-gate.ts`:
- Import `evaluatePolicy`, `DEFAULT_POLICY` from `@sverka/verification`.
- `evaluateGate(options)`: call evaluatePolicy with DEFAULT_POLICY or
  provided policy, pass baselineFingerprints (empty array if not provided),
  return { result, exitCode: result.verdict === "pass" ? 0 : 1 }.
- No need for filterOnlyNew — evaluatePolicy handles onlyNew per rule.

### Step 4: FindingsCollector (I/O, test-first)

Write `findings-collector.test.ts` (tests 11-15 from spec). Use temp dirs
with mock SARIF files. Implement `findings-collector.ts`:
- `collectFindings({ artifactDir })`: readdir(artifactDir), for each
  subdirectory (stepId), read `*.sarif` and `*.sarif.json` files, parse
  JSON, call `normalizeSarif` from `@sverka/verification`, attribute
  findings to stepId, return FindingRow[].
- Missing dir: return empty array (not an error).
- Invalid JSON: throw ReporterError(COLLECTION_FAILED).
- Non-SARIF files: skip.

### Step 5: TextRenderer (I/O, test-first)

Write `text-renderer.test.ts` (tests 20-25 from spec). Use a mock
OutputWriter that captures lines. Implement `text-renderer.ts`:
- `createTextRenderer({ writer })`: returns Renderer.
- `onEvent`: accumulate events via EventReducer, print step status lines
  (✓/✗/●/○ + stepId + duration). Print run-started and run-completed lines.
- `onFindings`: print findings summary (counts by severity + checkId).
- `onVerdict`: print policy verdict line.
- `flush`: no-op (text renderer writes immediately).

### Step 6: Public API

Write/finalize `public-api.test.ts` (test 26 from spec). Implement `index.ts`:
export all public types and functions.

### Step 7: CLI integration

Write `run-integration.test.ts` in cli package (tests 27-30 from spec).
Modify `packages/cli/src/`:
- `types.ts`: rename format `"human"` to `"text"` (update GlobalFlags).
- `commands/run.ts`: when format is "text", use TextRenderer instead of
  EVENT_LABELS. When `--evaluate` is set, after run completes: call
  collectFindings, evaluateGate, pass to renderer. Set exit code based on
  policy verdict when --evaluate is set.
- `main.ts`: register `--evaluate` boolean flag.
- Update existing CLI tests to use `"text"` instead of `"human"`.

### Step 8: Gates

Run all gates for reporter package + cli package + full monorepo:
```bash
bun run test --filter @sverka/reporter
bun run typecheck --filter @sverka/reporter
bun run lint --filter @sverka/reporter
bun run build --filter @sverka/reporter
bun run test --filter @sverka/cli
bun run typecheck --filter @sverka/cli
bun run test
bun run typecheck
bun run lint
bun run build
```

## Key design decisions

1. **Push model**: CLI iterates `AsyncIterable<RunEvent>` and calls
   `renderer.onEvent(event)` for each. Simpler than passing the iterable
   to the renderer — keeps the renderer synchronous and testable.

2. **FindingsCollector as filesystem scan**: Does NOT reuse
   `extractFindings` from `@sverka/verification/checks` because that
   requires declared `CheckOutput[]` paths. The reporter scans the
   filesystem for any `*.sarif` files — it doesn't know which outputs
   were declared. Different use case, no duplication.

3. **Format rename**: `"human"` → `"text"` in GlobalFlags. Breaking change
   but acceptable at 0.1.0. All existing CLI tests updated.

4. **No new RunEvent types**: The reducer handles all existing event types.
   The mega plan's `logPath` extension on `step-failed` is deferred —
   the text renderer shows the error message from the event, not logs.

5. **PolicyGate wraps, doesn't re-implement**: Uses `evaluatePolicy`
   directly from `@sverka/verification`. `evaluatePolicy` already accepts
   `baselineFingerprints` and handles `onlyNew` per rule — no need for
   `filterOnlyNew`. The gate just supplies `DEFAULT_POLICY` and maps
   verdict to exit code.

## Estimated size

- ~350 lines impl (types 40, reducer 80, findings-collector 60, policy-gate
  30, text-renderer 100, errors 15, index 25)
- ~250 lines tests (reducer 60, findings-collector 50, policy-gate 30,
  text-renderer 60, public-api 20, helpers 30)
- ~50 lines CLI changes (run.ts 30, types.ts 5, main.ts 15)
