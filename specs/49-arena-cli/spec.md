# Spec 49 — Arena CLI

**Status:** Active
**Source:** `packages/arena` library (runner/judge/acp/adapters), bead sv-3rip
**Package:** `@sverka/arena` (`sverka-arena` bin)

## Overview

`@sverka/arena` ships a working benchmark library — a task × model ×
plugin-combo × repetition matrix runner (`runArena`), a blind LLM judge
(`judgeAllRuns`), per-run traces/metrics, and an ACP adapter (`devin acp`).
What it lacks is an entry point: the published package has no `bin` (the
stub was removed) and the only consumer is the website's arena server.

This spec adds a standalone `sverka-arena` CLI that loads a declarative
config file, runs the matrix, and reports results — making the package
usable without embedding it in the website.

## Goals

- `sverka-arena run` — load `arena.config.ts`, run the matrix, write
  `results.json`, print an aggregate summary table
- `sverka-arena report <results.json>` — render aggregates + per-task
  analysis from a saved run without re-running agents
- `sverka-arena doctor` — verify the environment (agent CLI on PATH,
  required env vars for configured models/judge)
- Declarative config: `arena.config.ts` exports data only — the CLI maps
  `agent: "devin"` to `DevinAdapter`; no construct imports in user config
- `--format json` on all commands; exit codes match the main CLI:
  0 success, 1 run/validation failure, 2 usage error, 3 runtime error
- Config validated with zod (already a dependency)

## Non-goals

- New agent adapters beyond `devin` (the registry is a name→factory map,
  new adapters register there)
- Re-running the judge on saved results (`report` is read-only)
- The website arena server (separate consumer, untouched)
- Interactive TUI, watch mode, remote execution
- CI compilation of arena runs (arena is a local benchmarking tool)

## Interfaces

### Config file — `arena.config.ts`

```ts
import { defineConfig } from "@sverka/arena";

export default defineConfig({
  agent: "devin",
  models: [{ id: "devin-default", name: "Devin default" }],
  plugins: [{ id: "sverka", name: "Sverka", path: "plugins/sverka" }],
  tasks: [
    {
      id: "fix-test",
      name: "Fix a failing test",
      prompt: "...",
      fixture: "fixtures/ts-fix-test",
      successCriteria: "...",
      checks: [{ id: "tests-pass", command: "npm test", description: "..." }],
    },
  ],
  repetitions: 1,
  outputDir: ".arena",
  judge: {
    model: { id: "devin-default", name: "Devin default" },
    repetitions: 1,
  },
});
```

Loaded via dynamic `import()` — Node 24+ strips types natively, no
loader hooks needed. `defineConfig` is a type-only identity helper so
configs get full checking without importing internals.

```ts
// packages/arena/src/config.ts
export interface ArenaConfigFile {
  agent: string; // adapter id from the registry ("devin")
  models: ModelConfig[];
  plugins?: PluginConfig[]; // enabled flag ignored — matrix derives it
  tasks: Task[];
  workspace?: string;
  repetitions?: number;
  outputDir: string;
  judge?: { model: ModelConfig; repetitions?: number; revealPlugins?: boolean };
}

export function defineConfig(config: ArenaConfigFile): ArenaConfigFile;
export async function loadArenaConfig(path: string): Promise<ArenaConfig>;
// resolves agent name → AgentAdapter via the adapter registry, zod-validates
```

### Commands

```
sverka-arena run     [--config <path>] [--out <dir>] [--format json|text]
sverka-arena report  <results.json>   [--format json|text]
sverka-arena doctor  [--config <path>] [--format json|text]
```

- `run` — resolves config (default `arena.config.ts` in cwd), runs
  `runArena`, writes `outputDir/results.json`, prints aggregate table +
  per-task analysis. Exit 0 when the run completes; per-cell failures are
  reported in output, not exit code (a benchmark measures failures).
  Exit 2 on config/usage errors, 3 on operational errors.
- `report` — reads a `results.json`, prints the same aggregate/analysis
  view. Exit 0 on success, 2 on unreadable/invalid input.
- `doctor` — checks the configured agent binary on PATH and `envVar`s for
  each model + judge. Exit 0 all-ok, 1 on missing prerequisites.

## Error handling

- `ArenaError` with code; config schema errors list the zod issues
- Missing config file → usage error (2) with the resolved path
- Unknown `agent` name → usage error listing registered adapters

## Test plan

- `config.test.ts` — zod validation (valid/invalid/missing fields),
  adapter registry resolution, unknown agent error
- `report.test.ts` — fixture `results.json` → text and JSON output
- `bin.test.ts` — arg parsing, exit codes, `--format json` on stdout
- `doctor.test.ts` — missing binary/env detection (stubbed lookup)
- No live-agent tests — `run` integration is exercised by dogfooding,
  unit tests cover the plumbing with a stub adapter
