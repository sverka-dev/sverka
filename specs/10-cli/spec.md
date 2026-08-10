# Spec 10 — CLI Package: Command-Line Interface

## Overview

The `cli` package provides the `sverka` command-line interface. It is the
primary way users interact with Sverka without writing code. The CLI exposes
commands for project initialization, inspection, planning, execution,
validation, baseline management, and environment diagnostics.

The CLI is built with `yargs` and delegates all business logic to
`@sverka/sdk` and downstream packages. It is responsible for argument
parsing, output formatting, exit codes, and user experience — not for
workflow logic or finding normalization.

## Goals

1. Provide a `sverka` binary with a focused command set.
2. Support two output formats: human (default) and JSON.
3. Set exit codes based on the policy verdict (0 for pass, 1 for fail, 2
   for usage errors, 3 for runtime errors).
4. Support core commands: `init`, `inspect`, `plan`, `execute`/`run`,
   `validate`, `baseline`, `doctor`.
5. Be ergonomic: sensible defaults, helpful error messages.
6. Support global flags: `--format`, `--config`, `--root`, `--quiet`,
   `--verbose`.
7. Delegate to `@sverka/sdk` for all business logic.
8. Export `main` and public types from `src/index.ts`.

## Non-goals (v1 / Wave 10)

- **`compile` command.** Compilers are waves 12–13. The CLI gains
  `compile` when they exist.
- **`replay` command.** Requires saved-plan loading not in the SDK yet.
- **`diff` command.** Requires plan/finding comparison not in the SDK.
- **`findings` command.** Requires stored run findings system not built.
- **`plugin` command.** No plugin system exists.
- **`watch` command.** File watching is a future enhancement.
- **SARIF output format.** No SARIF output formatter exists in v1.
- **`--remote` flag.** Remote discovery was cut in Wave 6.
- **`--runtime podman`.** runtime-podman is a scaffold.
- Implementing business logic (delegated to SDK).
- TUI or interactive terminal UI.
- Auto-updating the CLI binary.
- Shell completion generation.
- Non-English localization.

## Interfaces

```typescript
// src/index.ts — public exports

/**
 * The main CLI entry point.
 * @param argv Command-line arguments (excluding node and script path).
 * @returns Exit code (0 = success, 1 = policy fail, 2 = usage error, 3 = runtime error).
 */
export function main(argv: string[]): Promise<number>;

/** Global flags parsed from the command line. */
export interface GlobalFlags {
  /** Output format. Defaults to "human". */
  format: "human" | "json";
  /** Path to sverka.config.ts. */
  config: string | null;
  /** Root directory. Defaults to process.cwd(). */
  root: string;
  /** Suppress non-error output. */
  quiet: boolean;
  /** Enable verbose output with debug information. */
  verbose: boolean;
}

/** Output writer abstraction for testability. */
export interface OutputWriter {
  write(text: string): void;
  writeLine(text: string): void;
  error(text: string): void;
  errorLine(text: string): void;
}

/** Exit codes used by the CLI. */
export const ExitCode = {
  Success: 0,
  PolicyFail: 1,
  UsageError: 2,
  RuntimeError: 3,
} as const;

export type ExitCode = (typeof ExitCode)[keyof typeof ExitCode];

/** Error thrown when CLI argument parsing or command execution fails. */
export class CliError extends Error {
  readonly code: CliErrorCode;
  readonly exitCode: ExitCode;
  override readonly cause: unknown;
  constructor(
    message: string,
    code: CliErrorCode,
    exitCode: ExitCode,
    cause?: unknown,
  );
}

export type CliErrorCode =
  | "UNKNOWN_COMMAND"
  | "MISSING_ARG"
  | "INVALID_FLAG"
  | "CONFIG_EXISTS"
  | "RUNTIME_NOT_AVAILABLE"
  | "SDK_ERROR";
```

## Data models

### Command set

| Command | Description | Key flags |
|---|---|---|
| `init` | Create a `sverka.config.ts` with sensible defaults. | `--template`, `--force` |
| `inspect` | Discover and display project context. | (global flags only) |
| `plan` | Discover context and synthesize a plan without executing. | `--only-new` |
| `execute` / `run` | Execute the workflow locally and report findings. | `--executor`, `--only-new`, `--baseline` |
| `validate` | Validate a `sverka.config.ts` without executing. | (global flags only) |
| `baseline` | Manage the findings baseline. | Subcommands: `create`, `update`, `show`, `clear` |
| `doctor` | Diagnose environment and dependencies. | (global flags only) |

### Global flags

All commands accept these global flags:

| Flag | Short | Type | Default | Description |
|---|---|---|---|---|
| `--format` | `-f` | `string` | `human` | Output format: `human` or `json` |
| `--config` | `-c` | `string` | auto | Path to `sverka.config.ts` |
| `--root` | `-r` | `string` | `cwd` | Root directory |
| `--quiet` | `-q` | `boolean` | `false` | Suppress non-error output |
| `--verbose` | `-v` | `boolean` | `false` | Enable debug output |

### Output formats

#### Human format

Default. Uses plain text output (no colors in v1 — keep it simple). Tables
and lists for structured data. Designed for terminal use.

#### JSON format

Emits a single JSON object on stdout. The structure varies by command but
always includes:

```typescript
{
  "command": string,
  "verdict": "pass" | "fail",  // when applicable
  "data": unknown,             // command-specific payload
  "durationMs": number,        // milliseconds
}
```

### Exit codes

| Code | Meaning | When |
|---|---|---|
| 0 | Success | Command completed and policy verdict is `pass` (or N/A). |
| 1 | Policy fail | Command completed but policy verdict is `fail`. |
| 2 | Usage error | Invalid arguments, unknown command, missing required flag. |
| 3 | Runtime error | Unexpected error during execution (crash, unhandled exception). |

For commands that do not involve policy evaluation (`init`, `inspect`,
`plan`, `validate`, `baseline`, `doctor`), exit code 1 is never used.
These commands return 0 on success, 2 on usage error, and 3 on runtime
error.

### Command details

#### `init`

Creates a `sverka.config.ts` in the root directory. If a config already
exists, the command fails unless `--force` is provided. The `--template`
flag selects a template (`minimal`, `full`). Default is `minimal`.

The minimal template:
```typescript
import { defineWorkflow, pipeline, task, run } from "@sverka/sdk";

export default defineWorkflow({
  name: "verify",
  workflow: pipeline(
    task("lint", run({ command: "bun", args: ["run", "lint"] })),
    task("typecheck", run({ command: "bun", args: ["run", "typecheck"] })),
    task("test", run({ command: "bun", args: ["run", "test"] })),
  ),
});
```

#### `inspect`

Runs discovery via `createPlanner().discover()` and prints the
`ProjectContext`. With `--format json`, emits the context as JSON.

#### `plan`

Runs `createSverka().plan()` and prints the `PlanResult`. Does not execute
checks. With `--format json`, emits the result as JSON.

#### `execute` / `run`

Runs `createSverka().execute()` and prints the `ExecutionResult`. Sets
exit code based on verdict. `--executor` selects the executor (`host` or
`docker`, default `host`). `--only-new` filters to findings not in the
baseline. `--baseline` specifies the baseline file path.

#### `validate`

Loads `sverka.config.ts` via `loadWorkflow()` without executing. Reports
success or errors. Exit code 0 if valid, 2 if invalid config, 3 if load
fails.

#### `baseline`

Subcommands:
- `create` — Run `execute()` and save findings as a new baseline via
  `saveBaseline()`.
- `update` — Run `execute()`, load existing baseline via `loadBaseline()`,
  update via `updateBaseline()`, save via `saveBaseline()`.
- `show` — Load and display the baseline via `loadBaseline()`.
- `clear` — Delete the baseline file.

The baseline file path defaults to `.sverka/baseline.json`. Override with
`--baseline`.

#### `doctor`

Checks the environment: Node.js version, Bun version, git availability.
Reports status of each check. Exit code 0 when all pass, 3 when a required
tool is missing. No `--fix` in v1 (just reports).

## Error handling

- **`CliError`** is thrown for CLI-specific failures:
  - `UNKNOWN_COMMAND` — the command is not recognized (exit code 2).
  - `MISSING_ARG` — a required argument is missing (exit code 2).
  - `INVALID_FLAG` — a flag has an invalid value (exit code 2).
  - `CONFIG_EXISTS` — `init` found an existing config without `--force`
    (exit code 2).
  - `RUNTIME_NOT_AVAILABLE` — the selected executor is not installed
    (exit code 3).
  - `SDK_ERROR` — an error from `@sverka/sdk` was caught and wrapped
    (exit code 3, original error in `cause`).
- **Policy failures are not errors.** A `fail` verdict produces exit code
  1, not a `CliError`.
- **Output to stderr for errors.** Error messages go to stderr. Results
  go to stdout.
- **`--quiet`** suppresses non-error stdout but not stderr.
- **`--verbose`** adds debug output to stderr.
- All errors include a `cause` field typed as `unknown`.
- No `any` types are used.

## Dependencies

- `@sverka/sdk` — all business logic (plan, execute, config loading,
  baseline, policy).
- `yargs` — argument parsing.

The CLI does NOT directly depend on other Sverka packages — it goes
through the SDK.

## Test plan

Tests live in `packages/cli/src/__tests__/` and run via `bun run test`
(vitest via nx).

1. **Global flags:**
   - `--format json` produces JSON output on stdout.
   - `--format human` produces human-readable output.
   - `--quiet` suppresses non-error output.
   - `--verbose` adds debug output to stderr.
   - `--root` changes the working directory.
   - `--config` specifies a custom config path.
2. **`init`:**
   - Creates a `sverka.config.ts` with default content.
   - Fails with `CONFIG_EXISTS` when config exists without `--force`.
   - `--force` overwrites an existing config.
   - `--template minimal` produces a minimal config.
3. **`inspect`:**
   - Prints project context in human format.
   - `--format json` prints context as JSON.
4. **`plan`:**
   - Prints the plan result.
   - Does not execute checks.
5. **`execute` / `run`:**
   - Executes the workflow and prints results.
   - Exit code 0 when verdict is `pass`.
   - Exit code 1 when verdict is `fail`.
   - `--executor host` selects host executor.
   - `--executor docker` selects docker executor.
   - `--only-new` filters to new findings.
   - `--baseline` specifies baseline path.
   - `--format json` produces JSON output.
6. **`validate`:**
   - Valid config exits with 0.
   - Invalid config exits with 2 and reports errors.
   - Missing config file exits with 2.
7. **`baseline`:**
   - `create` creates a baseline from execution.
   - `update` updates the baseline.
   - `show` displays the baseline.
   - `clear` removes the baseline file.
8. **`doctor`:**
   - Reports environment status (Node, Bun, git).
   - Exit code 0 when all checks pass.
   - Exit code 3 when a required tool is missing.
9. **Exit codes:**
   - 0 for success and `pass` verdict.
   - 1 for `fail` verdict.
   - 2 for usage errors.
   - 3 for runtime errors.
10. **Error handling:**
    - Unknown command exits with 2.
    - Missing required argument exits with 2.
    - Invalid flag value exits with 2.
    - SDK errors are wrapped with `cause` and exit code 3.
    - Error messages go to stderr.
