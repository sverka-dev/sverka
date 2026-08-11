---
name: sverka
description: Use when the user wants to run sverka CLI commands — scan a project for checks, plan a verification workflow, execute checks locally, validate a config, manage baselines, or diagnose the environment. Trigger on "sverka", "scan project", "plan checks", "run verification", "sverka doctor", "sverka plan", "sverka execute", "sverka inspect", "sverka validate", "sverka baseline", "sverka init".
---

# Sverka CLI

Sverka is a composable workflow SDK, local CI runtime, and multi-target compiler for software verification. Define checks once. Plan locally. Run anywhere.

## Prerequisites

Sverka requires Node.js 24+ and Bun. Install sverka globally or use `npx`:

```bash
# Install globally
npm install -g @sverka/cli

# Or use npx (no install)
npx @sverka/cli <command>
```

Verify installation:

```bash
sverka --version
sverka doctor
```

## Commands

### `sverka init`

Create a `sverka.config.ts` in the current project:

```bash
sverka init
```

This generates a minimal config with a default workflow. Edit it to define your checks.

### `sverka inspect`

Discover and display the project context — what languages, package managers, and frameworks sverka detected:

```bash
sverka inspect
sverka inspect --format json    # machine-readable output
```

### `sverka plan`

Synthesize a verification plan from the config without executing. Shows what checks would run, in what order:

```bash
sverka plan
sverka plan --format json
sverka plan --config path/to/sverka.config.ts
```

### `sverka execute` (alias: `sverka run`)

Execute the workflow locally — runs all checks, collects findings, evaluates policy:

```bash
sverka execute
sverka execute --executor docker     # run in Docker
sverka execute --executor host       # run on host (default)
sverka execute --format json
sverka execute --verbose
```

Exit codes:
- `0` — success, all checks passed
- `1` — policy failure (findings exceeded thresholds)
- `2` — usage error
- `3` — runtime error (e.g., Docker not available)

### `sverka validate`

Validate a `sverka.config.ts` without executing — checks schema, references, and dependencies:

```bash
sverka validate
sverka validate --config path/to/sverka.config.ts
```

### `sverka baseline`

Manage the findings baseline — suppress known findings, track new ones:

```bash
sverka baseline create    # create a new baseline from current findings
sverka baseline update    # update the baseline with current findings
sverka baseline save      # save baseline to file
sverka baseline load      # load baseline from file
```

### `sverka doctor`

Diagnose the environment — checks for Node.js, Bun, Docker, and other dependencies:

```bash
sverka doctor
```

## Global Flags

All commands accept:

| Flag | Short | Default | Description |
| --- | --- | --- | --- |
| `--format` | `-f` | `human` | Output format: `human` or `json` |
| `--config` | `-c` | — | Path to config file |
| `--root` | `-r` | `cwd` | Project root directory |
| `--quiet` | `-q` | `false` | Suppress non-essential output |
| `--verbose` | `-v` | `false` | Show debug output |

## Typical Workflow

1. **Initialize:** `sverka init` — creates config
2. **Inspect:** `sverka inspect` — see what sverka detected
3. **Plan:** `sverka plan` — see the verification plan
4. **Execute:** `sverka execute` — run checks locally
5. **Baseline:** `sverka baseline create` — suppress known findings
6. **Re-run:** `sverka execute` — only new findings shown

## Config File

The config file (`sverka.config.ts`) defines workflows using the SDK:

```typescript
import { defineWorkflow, pipeline, task } from "@sverka/sdk";

export default defineWorkflow({
  name: "my-project",
  workflow: pipeline(
    task("typecheck", { run: { command: "tsc", args: ["--noEmit"] } }),
    task("lint", { run: { command: "eslint", args: ["src"] } }),
    task("test", { run: { command: "vitest", args: ["run"] } }),
  ),
});
```

## JSON Output

All commands support `--format json` for programmatic use:

```bash
sverka plan --format json | jq '.data.operations[].name'
sverka execute --format json | jq '.data.findings | length'
```

## Troubleshooting

See [references/troubleshooting.md](references/troubleshooting.md) for common issues.
