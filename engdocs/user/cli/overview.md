# CLI reference

Sverka's CLI has 10 commands. Source of truth: `packages/cli/src/main.ts`.

## Commands

### `sverka init`

Create a `sverka.config.ts` file with a default Construct-based workflow.

| Flag        | Type    | Default    | Choices       | Description                    |
|-------------|---------|------------|---------------|--------------------------------|
| `--template`| string  | `minimal`  | `minimal`, `full` | Config template to use     |
| `--force`   | boolean | `false`    |               | Overwrite existing config      |

### `sverka validate`

Synthesize the Definition Graph and run validators. Reports graph errors
and validation diagnostics.

### `sverka plan`

Synthesize the Definition Graph, bind a Run Plan for an entry, and print
it without executing.

| Flag        | Type    | Default | Description                              |
|-------------|---------|---------|------------------------------------------|
| `--entry`   | string  | —       | Entry ID to plan for                     |

### `sverka graph`

Print the synthesized Definition Graph showing pipelines, steps, entries,
and dependencies.

### `sverka run`

Execute a Run Plan through the native engine with the host runtime driver.
Emits step events: pending, started, succeeded/failed, run completion.

| Flag        | Type    | Default | Description                              |
|-------------|---------|---------|------------------------------------------|
| `--entry`   | string  | —       | Entry ID to run                          |
| `--executor`| string  | `host`  | Runtime executor to use (`host` or `docker`) |

### `sverka discover`

Discover and display project context (package manager, languages, checks).

| Flag | Type | Default | Description |
|------|------|---------|-------------|
| *(none)* | — | — | Uses global flags only |

### `sverka check`

Run checks and report findings.

| Flag | Type | Default | Description |
|------|------|---------|-------------|
| *(none)* | — | — | Uses global flags only |

### `sverka policy`

Evaluate policy against findings and baseline.

| Flag        | Type    | Default | Description                              |
|-------------|---------|---------|------------------------------------------|
| `--findings`| string  | —       | Path to findings JSON file (required)    |
| `--baseline`| string  | —       | Path to baseline findings JSON file      |

### `sverka synth --target github|gitlab`

Stub for future target compilation (requires Waves H/I). Currently returns a
not-yet-implemented message.

| Flag        | Type    | Default | Description                              |
|-------------|---------|---------|------------------------------------------|
| `--target`  | string  | —       | Target: `github` or `gitlab`             |

### `sverka doctor`

Check installation health, dependencies, and configuration.

| Flag | Type | Default | Description |
|------|------|---------|-------------|
| *(none)* | — | — | Uses global flags only |

## Global flags

| Flag        | Type    | Default            | Choices         | Description                              |
|-------------|---------|--------------------|-----------------|------------------------------------------|
| `--config`  | string  | —                  |                 | Path to config file (default: `sverka.config.ts`) |
| `--root`    | string  | `process.cwd()`    |                 | Project root directory                   |
| `--format`  | string  | `human`            | `human`, `json` | Output format                            |
| `--verbose` | boolean | `false`            |                 | Verbose output                           |
| `--quiet`   | boolean | `false`            |                 | Suppress non-essential output            |

## Exit codes

| Code | Meaning         |
|------|-----------------|
| 0    | Success         |
| 1    | Validation error |
| 2    | Execution error  |
