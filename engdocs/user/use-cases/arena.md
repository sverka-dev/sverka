# Arena — benchmarking agents

`@sverka/arena` runs agents against verification workflows and measures what
plugins actually change: tokens, tool calls, wall time, pass/fail, and an
optional blind LLM judge.

The `sverka-arena` CLI has three commands:

```bash
sverka-arena doctor  # check the environment
sverka-arena run     # run the benchmark matrix
sverka-arena report  # render a saved results.json
```

## Configuration

Create `arena.config.ts` in your project root:

```ts
import { defineConfig } from "@sverka/arena";

export default defineConfig({
  agent: "devin",
  models: [{ id: "swe-2-max", name: "SWE-2 Max" }], // free tier
  plugins: [
    // The variable under test — a skill directory copied into
    // <workspace>/.agents/skills/<id>/ when enabled.
    { id: "my-skill", name: "My skill", path: "./skills/my-skill" },
  ],
  tasks: [
    {
      id: "fix-tests",
      name: "Fix failing unit tests",
      prompt: "Find the bugs in src/ so `bun test` passes.",
      fixture: "fixtures/ts-fix-test",
      successCriteria: "All unit tests pass",
      checks: [
        { id: "tests-pass", command: "bun test", description: "tests pass" },
      ],
    },
  ],
  repetitions: 1,
  outputDir: ".arena",
});
```

All paths in the config file — including `fixture` — resolve relative to
the config file's directory. (Programmatic `ArenaConfig` callers can still
use paths relative to the `@sverka/arena` package root.)

### Config fields

| Field         | Type                                                           | Notes                                                                                                     |
| ------------- | -------------------------------------------------------------- | --------------------------------------------------------------------------------------------------------- |
| `agent`       | string                                                         | Adapter name. Currently `"devin"`.                                                                        |
| `models[]`    | `{id, name, envVar?}`                                          | `id` is passed to `devin acp --model` (fuzzy names ok). `envVar` names an env var `doctor` should verify. |
| `plugins[]`   | `{id, name, path, enabled?}`                                   | `path` = skill dir copied into the workspace when the plugin is enabled.                                  |
| `tasks[]`     | `Task`                                                         | `prompt`, optional `fixture`, `checks`, `successCriteria`.                                                |
| `workspace`   | string                                                         | Base dir for per-run isolated workspaces (default: system temp).                                          |
| `repetitions` | number                                                         | Runs per cell of the matrix (default 1).                                                                  |
| `outputDir`   | string                                                         | Where `results.json` and traces land.                                                                     |
| `judge`       | `{model, agent?, repetitions?, revealPlugins?, systemPrompt?}` | Optional blind evaluation; judge defaults to the same agent adapter.                                      |

## The matrix

With M models and N plugins, `run` executes **M × 2^N × repetitions** runs —
every combination of plugins on and off. For 1 plugin that means each task
runs once with the skill installed and once with a clean workspace
(`.agents/skills/` is wiped before each run to prevent contamination).

Deterministic `checks` run as shell commands after the agent finishes
(exit 0 = pass). If `judge` is configured, each run's output is also scored
0–100 by the judge model without being told which plugins were active.

## `sverka-arena doctor`

Verifies the environment before you burn agent time:

```bash
sverka-arena doctor --config arena.config.ts
```

Checks: the agent binary is on `PATH`, and every configured `envVar` is set
(including the judge model's). Exit `0` when all pass, `1` on failures.

## `sverka-arena run`

```bash
sverka-arena run                          # uses ./arena.config.ts
sverka-arena run --config path/to.ts      # explicit config
sverka-arena run --out outdir             # override outputDir
sverka-arena run --format json            # machine-readable stdout
```

Writes `results.json` (plus per-run traces) under `outputDir` and prints the
aggregate table. Exit `0` on completion, `2` on config/usage errors,
`3` on runtime failures.

## `sverka-arena report`

Re-renders a saved run without re-spawning agents:

```bash
sverka-arena report .arena/results.json
sverka-arena report results.json --format json
```

Output: per-combination aggregates (runs, passes, avg tokens, tool calls,
LLM calls, wall time, judge score) plus the per-task analysis comparing each
plugin-on run against its plugin-off baseline.

## Exit codes

| Code | Meaning                                                     |
| ---- | ----------------------------------------------------------- |
| `0`  | success                                                     |
| `1`  | `doctor` found environment problems                         |
| `2`  | usage error — bad args, bad config, unreadable results file |
| `3`  | runtime failure during `run`/`report`                       |

## Example

This repo dogfoods arena: `packages/arena/arena.config.ts` benchmarks Devin
on the `ts-fix-test` fixture, with and without the `sverka` skill:

```bash
sverka-arena doctor --config packages/arena/arena.config.ts
sverka-arena run --config packages/arena/arena.config.ts
```
