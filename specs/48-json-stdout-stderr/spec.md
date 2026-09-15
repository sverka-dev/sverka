# Spec 48 — stdout/stderr/exitCode in Run Events and JSON Output

> **Status:** Ready for implementation
> **Priority:** P1 (CRITICAL — unblocks AI agent value proposition)
> **Source:** Audit finding #6 (2026-02). Megaplan Phase 1.

## Problem

`sverka run --format json` gives `{stepId, status, durationMs, error}` but NOT
`stdout`, `stderr`, or `exitCode`. When a step fails, an AI agent gets
"step failed with exit code 1" but not the actual command output. The agent
must run `bun run test` separately to see WHY it failed. This defeats the
core promise: one command replaces N tool-call round-trips.

The `ShellResult` from `RuntimeDriver.executeShell()` already contains
`stdout`, `stderr`, `exitCode` — but `executeShellOperation` discards them.
Only `exitCode` and `timedOut` survive into `StepExecError`. The `StepExecResult`,
`RunEvent`, and CLI JSON output never see stdout/stderr.

## Scope

Add `stdout`, `stderr`, `exitCode` to the `step-succeeded` and `step-failed`
`RunEvent` variants, propagate them through the engine, and include them in
`--format json` output. All fields are optional (not all steps run shell
commands — cache hits, agent steps, export-only steps have no shell output).

## Non-goals

- Streaming stdout/stderr in real-time (events are already emitted per-step,
  not per-line; this spec keeps that model).
- Full output for steps with multiple shell operations (only the LAST shell
  operation's output is captured — the one that matters for debugging).
- SARIF artifact capture (that is Phase 2, a separate spec).
- Text renderer changes (the text renderer already prints stdout/stderr
  via the driver; this spec only adds to structured events + JSON).

## Design

### 1. StepExecError gains stdout/stderr

`StepExecError` already carries `exitCode?` and `timedOut?`. Add `stdout?`
and `stderr?` so the failing command's output survives the throw/catch
boundary in `executeStep`.

```typescript
export class StepExecError extends EngineError {
  readonly exitCode?: number;
  readonly timedOut?: boolean;
  readonly stdout?: string;
  readonly stderr?: string;

  constructor(
    message: string,
    code: EngineErrorCode,
    cause?: unknown,
    exitCode?: number,
    timedOut?: boolean,
    stdout?: string,
    stderr?: string,
  );
}
```

### 2. StepExecResult gains stdout/stderr

`StepExecResult` already has `exitCode?`. Add `stdout?` and `stderr?`.

```typescript
export interface StepExecResult {
  readonly status: "succeeded" | "failed" | "cancelled";
  readonly error?: string;
  readonly durationMs: number;
  readonly exitCode?: number;
  readonly timedOut?: boolean;
  readonly stdout?: string;
  readonly stderr?: string;
}
```

### 3. executeShellOperation returns shell output on success

Currently `executeShellOperation` returns `Promise<void>`. Change it to return
`Promise<ShellOutput>` where `ShellOutput = { stdout: string; stderr: string;
exitCode: number }`. On failure (exitCode !== 0), it throws `StepExecError`
with `stdout` and `stderr` attached.

`executeOperation` return type changes from `Promise<void>` to
`Promise<ShellOutput | undefined>` — undefined for non-shell operations
(exportOutput, exportArtifact, importArtifact, diagnostic, agent).

### 4. executeStep tracks last shell output

`executeStep` tracks `lastShellOutput: ShellOutput | undefined` across
operations. After each `executeOperation` call, if the result is defined
(shell), update `lastShellOutput`. On success, include it in the returned
`StepExecResult`. On failure, extract `stdout`/`stderr` from the caught
`StepExecError`.

### 5. Truncation

Shell output can be very large (test suites, build logs). Define
`MAX_OUTPUT_LENGTH = 10000` (10KB per stream). In `executeStep`, before
building `StepExecResult`, truncate `stdout` and `stderr` if they exceed
the limit:

```
if (stdout.length > MAX_OUTPUT_LENGTH) {
  stdout = stdout.slice(0, MAX_OUTPUT_LENGTH) + `\n... (truncated, ${stdout.length} bytes total)`;
}
```

This keeps JSON output manageable while preserving the error context an
agent needs.

### 6. RunEvent gains stdout/stderr/exitCode

Add optional `stdout`, `stderr`, `exitCode` to `step-succeeded` and
`step-failed` variants:

```typescript
| { readonly type: "step-succeeded"; readonly stepId: string; readonly durationMs: number; readonly stdout?: string; readonly stderr?: string; readonly exitCode?: number }
| { readonly type: "step-failed"; readonly stepId: string; readonly error: string; readonly durationMs: number; readonly stdout?: string; readonly stderr?: string; readonly exitCode?: number }
```

Optional because: cache-hit steps emit `step-succeeded` with no shell output;
steps with only export/artifact operations have no shell output; the
`step-failed` from "no driver" has no shell output.

### 7. Engine emits stdout/stderr/exitCode

In `engine.ts` `runStep`, when emitting `step-succeeded` and `step-failed`,
include `stdout`, `stderr`, `exitCode` from the `StepExecResult` when
defined. Use conditional spread to avoid passing `undefined`:

```typescript
ctx.emit({
  type: "step-succeeded",
  stepId: step.id,
  durationMs: result.durationMs,
  ...(result.stdout !== undefined ? { stdout: result.stdout } : {}),
  ...(result.stderr !== undefined ? { stderr: result.stderr } : {}),
  ...(result.exitCode !== undefined ? { exitCode: result.exitCode } : {}),
});
```

### 8. CLI JSON output includes stdout/stderr/exitCode

`StepSummary` in `run.ts` gains `stdout?`, `stderr?`, `exitCode?`.
`summarizeSteps` extracts them from `step-succeeded` and `step-failed`
events.

```typescript
interface StepSummary {
  readonly stepId: string;
  readonly status: "succeeded" | "failed" | "skipped" | "cancelled" | "suspended" | "cache-hit";
  readonly durationMs?: number;
  readonly error?: string;
  readonly cacheKey?: string;
  readonly stdout?: string;
  readonly stderr?: string;
  readonly exitCode?: number;
}
```

## Files

| File | Change |
|------|--------|
| `packages/runtime/src/engine-native/errors.ts` | Add `stdout?`, `stderr?` to `StepExecError` |
| `packages/runtime/src/engine-native/step-executor.ts` | Capture stdout/stderr in `executeShellOperation`, propagate through `executeStep`, truncate |
| `packages/runtime/src/engine-native/types.ts` | Add `stdout?`, `stderr?`, `exitCode?` to `step-succeeded` and `step-failed` RunEvent variants |
| `packages/runtime/src/engine-native/engine.ts` | Emit stdout/stderr/exitCode in `step-succeeded` and `step-failed` events |
| `packages/cli/src/commands/run.ts` | Add `stdout?`, `stderr?`, `exitCode?` to `StepSummary` and `summarizeSteps` |

No new packages. No new dependencies. All changes are additive (optional fields).

## Test plan

1. **step-executor.test.ts**: Shell operation success → `StepExecResult` has `stdout`, `stderr`, `exitCode`.
2. **step-executor.test.ts**: Shell operation failure → `StepExecResult` has `stdout`, `stderr`, `exitCode` from the failing command.
3. **step-executor.test.ts**: Step with only export operations → `StepExecResult` has no `stdout`/`stderr`/`exitCode`.
4. **step-executor.test.ts**: stdout exceeding `MAX_OUTPUT_LENGTH` → truncated with notice.
5. **run-events.test.ts**: `step-succeeded` event includes `stdout`, `stderr`, `exitCode` for shell steps.
6. **run-events.test.ts**: `step-failed` event includes `stdout`, `stderr`, `exitCode` from the failing command.
7. **run-events.test.ts**: Cache-hit `step-succeeded` does NOT include `stdout`/`stderr`/`exitCode`.
8. **run-integration.test.ts**: `sverka run --format json` on a failing step → JSON includes `stdout`, `stderr`, `exitCode` in the step entry.
9. **run-integration.test.ts**: `sverka run --format json` on a succeeding step → JSON includes `stdout`, `exitCode: 0`.
10. **public-api.test.ts**: `RunEvent` type still compiles (optional fields, backward compatible).

## Acceptance

An AI agent running `sverka run --format json` on a failing workflow can see
WHY a step failed (stdout + stderr + exitCode) from the JSON alone, without
running the command separately.
