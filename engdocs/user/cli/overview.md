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
| `--inputs`  | string  | —       | JSON string of input values              |

### `sverka graph`

Print the synthesized Definition Graph showing pipelines, steps, entries,
and dependencies.

### `sverka run`

Execute a Run Plan through the native engine with the host runtime driver.
Emits step events: pending, started, succeeded/failed, run completion.

| Flag        | Type    | Default | Description                              |
|-------------|---------|---------|------------------------------------------|
| `--entry`   | string  | —       | Entry ID to run                          |
| `--inputs`  | string  | —       | JSON string of input values              |

### `sverka discover`

Discover and display project context (package manager, languages, checks).

### `sverka check`

Run checks and report findings.

### `sverka policy`

Evaluate policy against findings and baseline.

### `sverka synth --target github|gitlab`

Lower the Definition Graph to native GitHub Actions or GitLab CI YAML.

| Flag        | Type    | Default | Description                              |
|-------------|---------|---------|------------------------------------------|
| `--target`  | string  | —       | Target: `github` or `gitlab`             |
| `--output`  | string  | —       | Output file path                         |

### `sverka doctor`

Check installation health, dependencies, and configuration.

## Global flags

| Flag        | Description                              |
|-------------|------------------------------------------|
| `--config`  | Path to config file (default: `sverka.config.ts`) |
| `--verbose` | Verbose output                           |

## Exit codes

| Code | Meaning         |
|------|-----------------|
| 0    | Success         |
| 1    | Validation error |
| 2    | Execution error  |
