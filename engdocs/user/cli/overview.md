# CLI reference

Sverka's CLI has 7 commands plus global flags. Source of truth:
`packages/cli/src/main.ts`.

## Commands

### `sverka init`

Create a `sverka.config.ts` file with a default verification workflow.

| Flag        | Type    | Default    | Choices       | Description                    |
|-------------|---------|------------|---------------|--------------------------------|
| `--template`| string  | `minimal`  | `minimal`, `full` | Config template to use     |
| `--force`   | boolean | `false`    |               | Overwrite existing config      |

### `sverka inspect`

Discover and display project context (package manager, languages, checks).

### `sverka plan`

Synthesize a plan without executing.

| Flag        | Type    | Default | Description                              |
|-------------|---------|---------|------------------------------------------|
| `--only-new`| boolean | `false` | Only show checks not in the baseline     |

### `sverka execute` (alias: `sverka run`)

Execute the workflow locally.

| Flag         | Type    | Default | Choices       | Description                          |
|--------------|---------|---------|---------------|--------------------------------------|
| `--executor` | string  | `host`  | `host`, `docker` | Executor to use                 |
| `--only-new` | boolean | `false` |               | Skip checks in the baseline          |
| `--baseline` | string  |         |               | Path to a baseline file              |

### `sverka validate`

Validate `sverka.config.ts` without executing. Checks that the config
loads and the workflow is well-formed.

### `sverka baseline`

Manage the findings baseline. Has 4 subcommands:

| Subcommand | Description                        |
|------------|------------------------------------|
| `create`   | Create a baseline from execution   |
| `update`   | Update the baseline                |
| `show`     | Display the baseline               |
| `clear`    | Remove the baseline file           |

| Flag         | Type   | Description                    |
|--------------|--------|--------------------------------|
| `--baseline` | string | Path to a baseline file        |

### `sverka doctor`

Diagnose environment and dependencies. Checks that required tools are
available on PATH.

## Global flags

Available on all commands:

| Flag       | Alias | Type    | Default     | Choices       | Description                    |
|------------|-------|---------|-------------|---------------|--------------------------------|
| `--format` | `-f`  | string  | `human`     | `human`, `json` | Output format              |
| `--config` | `-c`  | string  | auto-discover |              | Path to config file           |
| `--root`   | `-r`  | string  | `process.cwd()` |            | Project root                  |
| `--quiet`  | `-q`  | boolean | `false`     |               | Suppress non-error output      |
| `--verbose`| `-v`  | boolean | `false`     |               | Show debug output              |

## Exit codes

| Code | Meaning        |
|------|----------------|
| 0    | Success (pass) |
| 1    | Policy fail    |
| 2    | Usage error    |
| 3    | Runtime error  |
