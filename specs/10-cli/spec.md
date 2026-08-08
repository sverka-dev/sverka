# Spec 10 — CLI Package: Command-Line Interface

## Overview

The `cli` package provides the `sverka` command-line interface. It is the
primary way users interact with Sverka without writing code. The CLI exposes
commands for project initialization, inspection, planning, execution, replay,
compilation, validation, diffing, findings management, baseline management,
plugin management, environment diagnostics, and file watching.

The CLI is built with `citty` (or `yargs` as an alternative) and delegates all
business logic to the `@sverka/sdk` and downstream packages. It is responsible
for argument parsing, output formatting, exit codes, and user experience — not
for workflow logic or finding normalization.

## Goals

1. Provide a `sverka` binary with a comprehensive command set.
2. Support three output formats: human (default), JSON, and SARIF.
3. Set exit codes based on the policy verdict (0 for pass, 1 for fail, 2 for
   usage errors).
4. Support all core commands: `init`, `inspect`, `plan`, `run`, `execute`,
   `replay`, `compile`, `validate`, `diff`, `findings`, `baseline`, `plugin`,
   `doctor`, `watch`.
5. Be ergonomic: sensible defaults, helpful error messages, progress
   indicators.
6. Support global flags that apply to all commands: `--format`, `--config`,
   `--root`, `--quiet`, `--verbose`.
7. Delegate to `@sverka/sdk` for all business logic.
8. Export all public types and functions from `src/index.ts`.

## Non-goals (v1)

- Implementing business logic (delegated to SDK and other packages).
- Providing a TUI or interactive terminal UI.
- Auto-updating the CLI binary.
- Supporting shell completion generation (future work).
- Supporting non-English localization (future work).

## Interfaces

```typescript
/**
 * The main CLI entry point.
 * @param argv Command-line arguments (excluding node and script path).
 * @returns Exit code (0 = success, 1 = policy fail, 2 = usage error).
 */
export function main(argv: string[]): Promise<number>;

/**
 * Global flags parsed from the command line.
 */
export interface GlobalFlags {
  /** Output format. Defaults to "human". */
  format: "human" | "json" | "sarif";
  /** Path to sverka.config.ts. */
  config: string | null;
  /** Root directory. Defaults to process.cwd(). */
  root: string;
  /** Suppress non-error output. */
  quiet: boolean;
  /** Enable verbose output with debug information. */
  verbose: boolean;
}

/**
 * A CLI command definition.
 */
export interface Command {
  /** Command name. */
  name: string;
  /** Short description shown in help. */
  description: string;
  /** Aliases for the command. */
  aliases?: string[];
  /** Positional arguments. */
  args?: CommandArg[];
  /** Named flags. */
  flags?: Record<string, CommandFlag>;
  /** Subcommands. */
  subCommands?: Command[];
  /** The command handler. */
  run: (ctx: CommandContext) => Promise<number>;
}

/**
 * A positional argument definition.
 */
export interface CommandArg {
  /** Argument name shown in help. */
  name: string;
  /** Whether the argument is required. */
  required: boolean;
  /** Description shown in help. */
  description: string;
  /** Default value if not provided. */
  default?: string;
}

/**
 * A named flag definition.
 */
export interface CommandFlag {
  /** Short form (single character). */
  short?: string;
  /** Whether the flag takes a value. */
  type: "boolean" | "string" | "number";
  /** Default value. */
  default?: boolean | string | number;
  /** Description shown in help. */
  description: string;
}

/**
 * Context passed to command handlers.
 */
export interface CommandContext {
  /** Parsed global flags. */
  global: GlobalFlags;
  /** Parsed command-specific flags. */
  flags: Record<string, unknown>;
  /** Parsed positional arguments. */
  args: Record<string, string>;
  /** A Sverka SDK instance configured with global flags. */
  sverka: Sverka;
  /** Output writer (stdout or stderr depending on context). */
  output: OutputWriter;
}

/**
 * Re-exported SDK type for command handlers.
 */
export type { Sverka } from "@sverka/sdk";

/**
 * Output writer abstraction for testability.
 */
export interface OutputWriter {
  write(text: string): void;
  writeLine(text: string): void;
  error(text: string): void;
  errorLine(text: string): void;
}

/**
 * Exit codes used by the CLI.
 */
export enum ExitCode {
  Success = 0,
  PolicyFail = 1,
  UsageError = 2,
  RuntimeError = 3,
}

/**
 * Error thrown when CLI argument parsing or command execution fails.
 */
export class CliError extends Error {
  readonly code: string;
  readonly exitCode: ExitCode;
  readonly cause: unknown;
  constructor(
    message: string,
    code: string,
    exitCode: ExitCode,
    cause?: unknown,
  ) {
    super(message);
    this.name = "CliError";
    this.code = code;
    this.exitCode = exitCode;
    this.cause = cause;
  }
}
```

## Data models

### Command set

| Command | Description | Key flags |
|---|---|---|
| `init` | Create a `sverka.config.ts` with sensible defaults. | `--template`, `--force` |
| `inspect` | Discover and display project context without planning. | `--remote`, `--json` |
| `plan` | Discover context and synthesize a plan without executing. | `--remote`, `--only-new` |
| `run` | Alias for `execute`. | (same as `execute`) |
| `execute` | Execute the workflow locally and report findings. | `--runtime`, `--only-new`, `--baseline` |
| `replay` | Re-execute from a saved plan or previous run. | `--from`, `--only-new` |
| `compile` | Compile the workflow to a CI target. | `--target`, `--output-dir` |
| `validate` | Validate a `sverka.config.ts` without executing. | `--config` |
| `diff` | Compare two plans or two finding sets. | `--base`, `--head` |
| `findings` | List, filter, and export findings from a previous run. | `--severity`, `--only-new`, `--export` |
| `baseline` | Manage the findings baseline. | Subcommands: `create`, `update`, `show`, `clear` |
| `plugin` | Manage Sverka plugins. | Subcommands: `list`, `add`, `remove` |
| `doctor` | Diagnose environment and dependencies. | `--fix` |
| `watch` | Watch for file changes and re-run plan or execute. | `--mode`, `--interval` |

### Global flags

All commands accept these global flags:

| Flag | Short | Type | Default | Description |
|---|---|---|---|---|
| `--format` | `-f` | `string` | `human` | Output format: `human`, `json`, or `sarif` |
| `--config` | `-c` | `string` | auto | Path to `sverka.config.ts` |
| `--root` | `-r` | `string` | `cwd` | Root directory |
| `--quiet` | `-q` | `boolean` | `false` | Suppress non-error output |
| `--verbose` | `-v` | `boolean` | `false` | Enable debug output |

### Output formats

#### Human format

Default. Uses colored output (when TTY supports it), tables, and progress
indicators. Designed for interactive terminal use.

#### JSON format

Emits a single JSON object on stdout. The structure varies by command but
always includes:

```typescript
{
  "command": string,
  "verdict": "pass" | "fail",  // when applicable
  "data": unknown,             // command-specific payload
  "duration": number,          // milliseconds
}
```

#### SARIF format

Emits a SARIF 2.1.0 log on stdout. Used by `execute`, `run`, `findings`, and
`replay` commands. Other commands fall back to JSON when `--format sarif` is
specified but SARIF is not applicable.

### Exit codes

| Code | Meaning | When |
|---|---|---|
| 0 | Success | Command completed and policy verdict is `pass`. |
| 1 | Policy fail | Command completed but policy verdict is `fail`. |
| 2 | Usage error | Invalid arguments, unknown command, missing required flag. |
| 3 | Runtime error | Unexpected error during execution (crash, unhandled exception). |

For commands that do not involve policy evaluation (`init`, `inspect`, `plan`,
`compile`, `validate`, `diff`, `baseline`, `plugin`, `doctor`, `watch`),
exit code 1 is never used. These commands return 0 on success, 2 on usage
error, and 3 on runtime error.

### Command details

#### `init`

Creates a `sverka.config.ts` in the root directory. If a config already
exists, the command fails unless `--force` is provided. The `--template` flag
selects a template (`minimal`, `full`, `auto`). When `auto` is selected, the
planner discovers the project context and generates a config with appropriate
checks.

#### `inspect`

Runs discovery only and prints the `ProjectContext`. With `--json`, emits the
context as JSON. With `--remote`, includes remote signals.

#### `plan`

Runs discovery and plan synthesis, then prints the `PlanProposal`. Does not
execute checks.

#### `execute` / `run`

Runs the full pipeline: discover, plan, execute, normalize findings, evaluate
policy, print results. Sets exit code based on verdict. `--runtime` selects
the executor (`docker`, `podman`, `host`, `auto`). `--only-new` filters to
findings not in the baseline.

#### `replay`

Re-executes from a saved plan (`--from` path to a plan JSON file) or from a
previous run's artifacts. Useful for reproducing a CI run locally.

#### `compile`

Compiles the workflow to a CI target. `--target` is required
(`github-actions` or `gitlab-ci`). `--output-dir` specifies where to write
compiled files (default: `.sverka/compiled/`).

#### `validate`

Loads and validates `sverka.config.ts` without executing. Reports schema
errors, missing dependencies, and invalid references.

#### `diff`

Compares two plans (`--base` and `--head` plan files) or two finding sets.
Outputs added, removed, and changed items.

#### `findings`

Lists findings from a previous run (stored in `.sverka/runs/<id>/findings.json`).
Supports filtering by `--severity` and `--only-new`. `--export` writes findings
to a file in the specified format.

#### `baseline`

Subcommands:
- `create` — Create a new baseline from the latest run's findings.
- `update` — Update the existing baseline with new findings and remove
  resolved ones.
- `show` — Display the current baseline contents.
- `clear` — Remove the baseline file.

#### `plugin`

Subcommands:
- `list` — List installed plugins.
- `add` — Install a plugin from npm or a local path.
- `remove` — Remove an installed plugin.

#### `doctor`

Checks the environment: Node.js version, Bun version, Docker availability,
Podman availability, git availability, network connectivity to providers.
With `--fix`, attempts to resolve issues (e.g., install missing dependencies).

#### `watch`

Watches the project root for file changes and re-runs `plan` or `execute`
(depending on `--mode`). Debounces with `--interval` (default 1000ms).

## Error handling

- **`CliError`** is thrown for CLI-specific failures:
  - `UNKNOWN_COMMAND` — the command is not recognized (exit code 2).
  - `MISSING_ARG` — a required argument is missing (exit code 2).
  - `INVALID_FLAG` — a flag has an invalid value (exit code 2).
  - `CONFIG_EXISTS` — `init` found an existing config without `--force`
    (exit code 2).
  - `RUNTIME_NOT_AVAILABLE` — the selected runtime is not installed
    (exit code 3).
  - `COMPILE_TARGET_REQUIRED` — `compile` was called without `--target`
    (exit code 2).
- **Policy failures are not errors.** A `fail` verdict produces exit code 1,
  not a `CliError`. The command completes successfully; the verdict is a
  result, not an error.
- **SDK errors are wrapped.** Errors from `@sverka/sdk` are caught and
  re-thrown as `CliError` with the original error in `cause` and exit code 3.
- **Output to stderr for errors.** Error messages are written to stderr.
  Results (including findings) are written to stdout.
- **`--quiet` suppresses non-error stdout** but does not suppress stderr.
- **`--verbose` adds debug output** to stderr, including timing, discovery
  steps, and runtime selection.
- All errors include a `cause` field typed as `unknown`.
- No `any` types are used.

## Test plan

Tests live in `packages/cli/src/__tests__/` and run via `bun test`.

1. **Global flags:**
   - `--format json` produces JSON output on stdout.
   - `--format sarif` produces SARIF output where applicable.
   - `--format human` produces human-readable output.
   - `--quiet` suppresses non-error output.
   - `--verbose` adds debug output to stderr.
   - `--root` changes the working directory.
   - `--config` specifies a custom config path.
2. **`init`:**
   - Creates a `sverka.config.ts` with default content.
   - Fails with `CONFIG_EXISTS` when a config already exists without `--force`.
   - `--force` overwrites an existing config.
   - `--template minimal` produces a minimal config.
   - `--template auto` discovers context and generates appropriate config.
3. **`inspect`:**
   - Prints project context in human format.
   - `--json` prints context as JSON.
   - `--remote` includes remote signals.
4. **`plan`:**
   - Prints the plan proposal.
   - Does not execute checks.
   - `--only-new` filters against baseline.
5. **`execute` / `run`:**
   - Executes the workflow and prints findings.
   - Exit code 0 when verdict is `pass`.
   - Exit code 1 when verdict is `fail`.
   - `--runtime docker` selects Docker executor.
   - `--runtime host` selects host executor.
   - `--only-new` filters to new findings.
   - `--baseline` specifies baseline path.
   - `--format sarif` produces SARIF output.
6. **`replay`:**
   - Re-executes from a saved plan file.
   - `--from` specifies the plan file path.
7. **`compile`:**
   - `--target github-actions` produces GitHub Actions YAML.
   - `--target gitlab-ci` produces GitLab CI YAML.
   - Missing `--target` throws `COMPILE_TARGET_REQUIRED`.
   - `--output-dir` writes files to the specified directory.
8. **`validate`:**
   - Valid config exits with 0.
   - Invalid config exits with 2 and reports errors.
9. **`diff`:**
   - Compares two plan files and reports differences.
   - Compares two finding sets and reports differences.
10. **`findings`:**
    - Lists findings from a previous run.
    - `--severity high` filters to high and critical.
    - `--only-new` filters to new findings.
    - `--export` writes findings to a file.
11. **`baseline`:**
    - `create` creates a baseline from the latest run.
    - `update` updates the baseline with new findings.
    - `show` displays the baseline.
    - `clear` removes the baseline.
12. **`plugin`:**
    - `list` lists installed plugins.
    - `add` installs a plugin.
    - `remove` removes a plugin.
13. **`doctor`:**
    - Reports environment status (Node, Bun, Docker, Podman, git).
    - Exit code 0 when all checks pass.
    - Exit code 3 when a required tool is missing.
    - `--fix` attempts to resolve issues.
14. **`watch`:**
    - Watches for file changes.
    - Re-runs plan or execute on change.
    - Debounces with `--interval`.
15. **Exit codes:**
    - 0 for success and `pass` verdict.
    - 1 for `fail` verdict.
    - 2 for usage errors.
    - 3 for runtime errors.
16. **Error handling:**
    - Unknown command exits with 2.
    - Missing required argument exits with 2.
    - Invalid flag value exits with 2.
    - SDK errors are wrapped with `cause` and exit code 3.
    - Error messages go to stderr.
