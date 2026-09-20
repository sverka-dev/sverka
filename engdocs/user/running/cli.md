# CLI reference

Sverka's CLI has 14 commands. Source of truth: `packages/cli/src/main.ts`.

## Commands

### `sverka init`

Create a `sverka.config.ts` file with a default Construct-based workflow.

| Flag        | Type    | Default    | Choices       | Description                    |
|-------------|---------|------------|---------------|--------------------------------|
| `--template`| string  | `minimal`  | `minimal`, `full` | Config template to use     |
| `--force`   | boolean | `false`    |               | Overwrite existing config      |
| `--detect`  | boolean | `false`    |               | Generate config from detected project checks (overrides `--template`) |

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
| `--evaluate`| boolean | `false` | Collect SARIF findings and evaluate policy after the run |
| `--output`  | string  | —       | Output file path for HTML report (implies `--format html`) |
| `--tui`     | boolean | auto    | Interactive terminal UI (default: on when stdout is a TTY and no `--format`) |

### `sverka discover`

Discover and display project context (package manager, languages, checks).

| Flag | Type | Default | Description |
|------|------|---------|-------------|
| *(none)* | — | — | Uses global flags only |

### `sverka check`

Detect the project's checks (planner discovery + package.json scripts,
scoped to `--root`) and resolve them to step definitions — the same set
`init --detect` would generate.

| Flag | Type | Default | Description |
|------|------|---------|-------------|
| *(none)* | — | — | Uses global flags only |

### `sverka policy`

Evaluate policy against findings and baseline.

| Flag        | Type    | Default | Description                              |
|-------------|---------|---------|------------------------------------------|
| `--findings`| string  | —       | Path to findings JSON file (required)    |
| `--baseline`| string  | —       | Path to baseline findings JSON file      |

### `sverka compile --target github|gitlab`

Compile the workflow to a CI target and print the YAML (or write it with
`--output`).

| Flag        | Type    | Default | Description                              |
|-------------|---------|---------|------------------------------------------|
| `--target`  | string  | —       | Target: `github` or `gitlab` (required)  |
| `--output`, `-o` | string | —  | Write YAML to a file instead of stdout   |

### `sverka synth --target github|gitlab`

Alias for `compile`. Same flags, without `--output`.

### `sverka mcp-server`

Expose Sverka operations (`validate`, `plan`, `graph`, `run`, `synth`) as
MCP tools over stdio. Runs until stdin closes or SIGTERM.

### `sverka view [file]`

View SARIF findings in the terminal TUI or generate a standalone HTML
report. Reads from stdin when `file` is omitted; falls back to plain text
when no interactive terminal is available.

| Flag        | Type    | Default | Description                              |
|-------------|---------|---------|------------------------------------------|
| `--format`, `-f` | string | `tui` | `tui`, `web`, or `html` (HTML report)  |
| `--output`, `-o` | string | `sarif-report.html` | Output path for `--format web`/`html` |

### `sverka ui`

Start the local web dashboard server for SARIF findings.

| Flag        | Type    | Default     | Description                          |
|-------------|---------|-------------|--------------------------------------|
| `--port`    | number  | `3000`      | Port to listen on                    |
| `--host`    | string  | `localhost` | Host to bind                         |

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
| `--format`  | string  | `text`             | `text`, `json`, `html`, `sarif`, `web` | Output format |
| `--verbose` | boolean | `false`            |                 | Verbose output                           |
| `--quiet`   | boolean | `false`            |                 | Suppress non-essential output            |

## Exit codes

| Code | Meaning         |
|------|-----------------|
| 0    | Success         |
| 1    | Policy failure  |
| 2    | Usage error     |
| 3    | Runtime error   |
