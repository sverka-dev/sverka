# Plan — Spec 48: stdout/stderr/exitCode in Run Events and JSON Output

> **Branch:** `fix/json-stdout-stderr`
> **Base:** `main` (or current working branch if directed)
> **Effort:** Small (~150 impl lines, ~120 test lines)

## TDD Steps

### Step 1: Add stdout/stderr to StepExecError

**File:** `packages/runtime/src/engine-native/errors.ts`

Add `stdout?: string` and `stderr?: string` readonly fields to `StepExecError`.
Extend constructor to accept them as 6th and 7th params. Use conditional
assignment (only set if defined) to match existing `exitCode`/`timedOut` pattern.

**Test:** Existing `errors.test.ts` — add test: `StepExecError` with stdout/stderr
preserves them on the instance.

### Step 2: Capture stdout/stderr in executeShellOperation

**File:** `packages/runtime/src/engine-native/step-executor.ts`

- Define `ShellOutput = { stdout: string; stderr: string; exitCode: number }`
  (exported, internal use).
- Change `executeShellOperation` return type from `Promise<void>` to
  `Promise<ShellOutput>`. Return `{ stdout: result.stdout, stderr:
result.stderr, exitCode: result.exitCode }` on success.
- On failure (exitCode !== 0), pass `result.stdout` and `result.stderr` to
  the `StepExecError` constructor.
- Change `executeOperation` return type from `Promise<void>` to
  `Promise<ShellOutput | undefined>`. Return `undefined` for non-shell ops.

**Test:** `step-executor.test.ts` — add tests:

- Shell success → `executeOperation` returns `{stdout, stderr, exitCode}`.
- Shell failure → throws `StepExecError` with `stdout`, `stderr` set.

### Step 3: Propagate through executeStep

**File:** `packages/runtime/src/engine-native/step-executor.ts`

- Add `stdout?: string` and `stderr?: string` to `StepExecResult`.
- In `executeStep`, track `lastShellOutput: ShellOutput | undefined`.
  After each `executeOperation` call, if result is defined, update it.
- On success: include `lastShellOutput` fields in the returned `StepExecResult`.
- On failure: extract `stdout`/`stderr` from the caught `StepExecError`
  (if it's a `StepExecError`), fallback to `lastShellOutput`.
- Add `MAX_OUTPUT_LENGTH = 10000` constant. Truncate stdout/stderr before
  building the result:
  ```typescript
  function truncateOutput(s: string): string {
    if (s.length <= MAX_OUTPUT_LENGTH) return s;
    return (
      s.slice(0, MAX_OUTPUT_LENGTH) +
      `\n... (truncated, ${s.length} bytes total)`
    );
  }
  ```

**Test:** `step-executor.test.ts` — add tests:

- Step with shell op → `StepExecResult` has `stdout`, `stderr`, `exitCode`.
- Step with only export ops → `StepExecResult` has no `stdout`/`stderr`.
- Step with failing shell op → `StepExecResult` has failing op's `stdout`/`stderr`/`exitCode`.
- stdout > 10000 chars → truncated with notice.

### Step 4: Add stdout/stderr/exitCode to RunEvent types

**File:** `packages/runtime/src/engine-native/types.ts`

Add optional `stdout?: string`, `stderr?: string`, `exitCode?: number` to
the `step-succeeded` and `step-failed` union members.

**Test:** `run-events.test.ts` — type-level: events compile with the new fields.

### Step 5: Emit stdout/stderr/exitCode in engine

**File:** `packages/runtime/src/engine-native/engine.ts`

In `runStep`, when emitting `step-succeeded` and `step-failed`, include
`stdout`, `stderr`, `exitCode` from `result` using conditional spread
(respect `exactOptionalPropertyTypes`).

Also update the "no driver" `step-failed` emission — it has no shell output,
so no stdout/stderr/exitCode (already correct, just verify).

**Test:** `run-events.test.ts` — add tests:

- `step-succeeded` event for shell step includes `stdout`, `stderr`, `exitCode`.
- `step-failed` event includes `stdout`, `stderr`, `exitCode` from failing command.
- Cache-hit `step-succeeded` does NOT include `stdout`/`stderr`/`exitCode`.

### Step 6: Include stdout/stderr/exitCode in CLI JSON output

**File:** `packages/cli/src/commands/run.ts`

- Add `stdout?: string`, `stderr?: string`, `exitCode?: number` to `StepSummary`.
- In `summarizeSteps`, extract them from `step-succeeded` and `step-failed`
  events using conditional spread.

**Test:** `run-integration.test.ts` — add tests:

- Failing step → JSON `steps[]` entry has `stdout`, `stderr`, `exitCode`.
- Succeeding step → JSON `steps[]` entry has `stdout`, `exitCode: 0`.

### Step 7: Fix integration test VALID_CONFIG bug (Phase 3 overlap)

**File:** `packages/cli/src/__tests__/run-integration.test.ts`

The `VALID_CONFIG` uses `dependencies: [{ kind: "control", producer: "build" }]`
which is a non-existent prop. Fix to `dependsOn: ["build"]`. This is needed
for the new integration tests to actually test dependency behavior.

Note: This overlaps with Phase 3 (sv-rh51) but is required here because the
new integration tests depend on a working config.

### Step 8: Run gates

```bash
# Runtime package
cd packages/runtime && bun run test && bun run typecheck && bun run lint && bun run build

# CLI package
cd packages/cli && bun run test && bun run typecheck && bun run lint && bun run build

# Full monorepo
bun run test && bun run typecheck && bun run lint && bun run build
```

## Commit hygiene

Stage ONLY:

- `packages/runtime/src/engine-native/errors.ts`
- `packages/runtime/src/engine-native/step-executor.ts`
- `packages/runtime/src/engine-native/types.ts`
- `packages/runtime/src/engine-native/engine.ts`
- `packages/runtime/src/engine-native/__tests__/` (new + modified test files)
- `packages/cli/src/commands/run.ts`
- `packages/cli/src/__tests__/run-integration.test.ts`
- `specs/48-json-stdout-stderr/spec.md`
- `engdocs/architecture/audit-fixes-phase-1-plan.md`

EXCLUDE: `city.toml`, `agents/`, `.devin/`, `.gc/`, `.beads/`, `formulas/`,
and all other dirty-tree files (CDK-style dependsOn, init --detect, doc updates).
