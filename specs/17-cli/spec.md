# Spec 17 — CLI

**Status:** Active
**Source:** specs/architecture-spec.md §28, §30
**Package:** `@sverka/cli` (rebuilt)

## Overview

The v0 CLI provides commands for validating, planning, inspecting, and
running Sverka workflows. It uses the new packages directly:
constructs/core for synthesis, ir for Run Plans, planner for binding,
engine-native for execution, checks for resolution, findings/policy for
post-execution analysis.

## Goals

- `sverka validate` — synthesize Definition Graph, run validators
- `sverka plan` — bind Entry + inputs → Run Plan, display steps
- `sverka graph` — display Definition Graph structure (steps, deps, entries)
- `sverka run` — execute Run Plan through native engine, show events
- `sverka discover` — run planner discovery, show project context
- `sverka check` — resolve proposed checks → StepDefinitions, display
- `sverka policy` — evaluate findings against policy (post-execution)
- `sverka synth --target github|gitlab` — STUB (requires Waves H/I)
- Reuse existing output writer, types, error handling
- JSON and human output formats
- Exit codes: 0 success, 1 policy fail, 2 usage error, 3 runtime error

## Non-goals

- `synth` implementation (stubbed — requires Waves H/I targets)
- Multiple config formats / dynamic import loading (deferred)
- Decorator-based authoring in config (Wave D)
- Plugin system (Wave E)
- Provider-native delegated engines (Wave E)
- Interactive TUI
- Watch mode

## Interfaces

```ts
// Commands
function validateCommand(global: GlobalFlags, output: OutputWriter, start: number): Promise<number>;
function planCommand(args: PlanArgs, global: GlobalFlags, output: OutputWriter, start: number): Promise<number>;
function graphCommand(global: GlobalFlags, output: OutputWriter, start: number): Promise<number>;
function runCommand(args: RunArgs, global: GlobalFlags, output: OutputWriter, start: number): Promise<number>;
function discoverCommand(global: GlobalFlags, output: OutputWriter, start: number): Promise<number>;
function checkCommand(global: GlobalFlags, output: OutputWriter, start: number): Promise<number>;
function policyCommand(args: PolicyArgs, global: GlobalFlags, output: OutputWriter, start: number): Promise<number>;
function synthCommand(args: SynthArgs, global: GlobalFlags, output: OutputWriter, start: number): Promise<number>;

// Entry point
function main(argv: string[], deps?: MainDeps): Promise<number>;
```

### Args

```ts
interface PlanArgs { entryId?: string; }
interface RunArgs { entryId?: string; executor?: "host" | "docker"; }
interface PolicyArgs { findings: string; baseline?: string; }
interface SynthArgs { target: "github" | "gitlab"; }
```

### Exports

```ts
export { main, type MainDeps };
export * from "./types.js";
export { ConsoleOutputWriter, createOutputWriter, wrapOutputWriter, type WriteSink };
```

## Data models

**Config loading**: The CLI loads a sverka.config.ts file from the root
directory. This file uses `@sverka/constructs` directly to define a
Project with Pipelines, Entries, and Steps. The CLI synthesizes it into
a Definition Graph via `@sverka/core.synthesize`. If no config is found,
commands that require a graph report a usage error.

**Run Plan binding**: `plan` and `run` use `@sverka/planner.bindRunPlan`
to bind the first entry found across all pipelines (or a specified
`--entry`) with empty inputs (v0: no user input override via CLI).

**Execution**: `run` uses `@sverka/engine-native.createEngine` with a
host driver (`@sverka/runtime-host.createHostDriver`) and, when
`--executor docker` is chosen, a Docker driver
(`@sverka/runtime-docker.createDockerDriver`). It collects events and
prints them. Exit code reflects run status. The workspace passed to
the engine is the project root; the engine creates per-step scratch
directories under `.sverka/workspace` inside the root.

**Discovery**: `discover` uses `@sverka/planner.createPlanner().discover()`
to inspect the project and print the context.

**Check resolution**: `check` uses the planner to discover, plan, then
`@sverka/checks.synthesizeCheckSteps` to resolve proposed checks into
StepDefinitions.

**Policy**: `policy` loads findings from a SARIF file specified with
`--findings`, optionally applies a `--baseline` for `onlyNew` filtering,
and evaluates against the default policy via `@sverka/policy`.

**Synth stub**: `synth` prints a message (human output to stderr, JSON
to stdout) that target compilation is not yet implemented and returns
ExitCode.UsageError. This will be replaced in Waves H/I.

## Error handling

Reuses existing `CliError` with codes:
- `UNKNOWN_COMMAND`, `MISSING_ARG`, `INVALID_FLAG`
- `CONFIG_EXISTS` (init)
- `RUNTIME_NOT_AVAILABLE` (docker not on PATH)
- `SDK_ERROR` (config loading or synthesis failure)

## Test plan

1. `main` with no command → usage error (exit 2).
2. `main` with unknown command → usage error (exit 2).
3. `validate` with valid config → success (exit 0), prints graph info.
4. `validate` with no config → usage error (exit 2).
5. `plan` with valid config → success, prints run plan steps.
6. `plan` with --entry → uses specified entry.
7. `graph` with valid config → success, prints step DAG.
8. `run` with valid config → executes, prints events.
9. `run` with --executor docker (no docker) → runtime error.
10. `discover` → success, prints project context.
11. `check` → success, prints resolved check steps.
12. `policy` → success or policy fail based on `--findings` SARIF and optional `--baseline`.
13. `synth --target github` → stub message, usage error.
14. JSON format produces valid JSON output.
15. Public API: all exports present, no any types.
16. Regression: existing CLI tests for output writer, types pass.
