# Arena — benchmarking agents

`@sverka/arena` runs agents against verification workflows and measures what
plugins actually change: tokens, tool calls, wall time, pass/fail, and an
optional blind LLM judge.

The `sverka-arena` CLI:

```bash
sverka-arena doctor    # check the environment
sverka-arena run       # run the benchmark matrix
sverka-arena report    # render a saved results.json
sverka-arena publish   # commit results to a registry
sverka-arena board     # render the registry leaderboard
sverka-arena pack      # scaffold and lint task packs
sverka-arena reindex   # rebuild the registry index
```

## Configuration

Create `arena.config.ts` in your project root:

```ts
import { defineConfig } from "@sverka/arena";

export default defineConfig({
  agent: "devin",
  models: [{ id: "swe-2-high", name: "SWE-2 High" }], // free tier
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

| Field         | Type                                                           | Notes                                                                                                            |
| ------------- | -------------------------------------------------------------- | ---------------------------------------------------------------------------------------------------------------- |
| `agent`       | string                                                         | Adapter name. Currently `"devin"`.                                                                               |
| `models[]`    | `{id, name, envVar?}`                                          | `id` is passed to `devin acp --model` (fuzzy names ok). `envVar` names an env var `doctor` should verify.        |
| `plugins[]`   | `{id, name, path, enabled?}`                                   | `path` = skill dir copied into the workspace when the plugin is enabled.                                         |
| `tasks[]`     | `Task`                                                         | `prompt`, optional `fixture`, `setup` (pre-run shell commands, e.g. `bun install`), `checks`, `successCriteria`. |
| `workspace`   | string                                                         | Base dir for per-run isolated workspaces (default: system temp).                                                 |
| `repetitions` | number                                                         | Runs per cell of the matrix (default 1).                                                                         |
| `outputDir`   | string                                                         | Where `results.json` and traces land.                                                                            |
| `judge`       | `{model, agent?, repetitions?, revealPlugins?, systemPrompt?}` | Optional blind evaluation; judge defaults to the same agent adapter.                                             |

## The matrix

With M models and N plugins, `run` executes **M × 2^N × repetitions** runs —
every combination of plugins on and off. For 1 plugin that means each task
runs once with the skill installed and once with a clean workspace
(`.agents/skills/` is wiped before each run to prevent contamination).

## Isolation

"Plugin off" is only meaningful if the agent can't see the skill through
another channel. Every run therefore gets:

- a repo-level `.devin/config.json` with `forbiddenPlugins: ["*"]` in the
  workspace — blocks all user/managed Devin plugin installs (including a
  globally installed copy of the plugin under test). Org/enterprise-required
  plugins still load — higher authority always wins — but they're a constant
  baseline across all cells;
- fresh `XDG_CONFIG_HOME`/`XDG_DATA_HOME` — drops global skills, hooks, and
  MCP config so every cell shares the same builtin baseline. Your
  `credentials.toml` is copied in so the agent stays authenticated. Note:
  the Devin session DB (`sessions.db`) ignores XDG and still records runs
  on the host — arena reads per-call token metrics from it there.

Plugin-on cells are unaffected by the forbid: arena skills are copied into
`.agents/skills/` as workspace content, not installed as plugins.

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
sverka-arena run --pack <ref>             # run a task pack instead of config tasks
sverka-arena run --publish --registry <ref>  # publish after running
```

Writes `results.json` (plus per-run traces) under `outputDir` and prints the
aggregate table. Exit `0` on completion, `2` on config/usage errors,
`3` on runtime failures.

### Task packs

`--pack <ref>` replaces the config's task list with a pack — a shareable
benchmark suite contributed via git:

```text
<pack>/
  pack.json        # { name, version, description, defaults }
  tasks/<id>.json  # { id, prompt, repo|fixture, checks: [...], timeoutMs? }
```

Pack refs resolve to a local directory, a git URL, or a bare name —
`packs/<name>/` inside `--registry`:

```bash
sverka-arena pack init my-pack              # scaffold pack.json + tasks/
sverka-arena pack lint my-pack              # validate (exit 1 on errors)
sverka-arena run --pack ./my-pack           # local dir
sverka-arena run --pack node-ci --registry git@github.com:org/arena-results.git
```

`checks` in pack tasks are the score — a task with no checks scores on agent
exit status only, and `pack lint` warns about it.

## The registry

Published results live in an append-only registry — a git repo (default:
auditable, PR-reviewable) or an S3-style object store. Every published
document validates against `arena.result/v1` and lands at
`results/<pack>/<agent>/<YYYY-MM-DD>/<runId>.json`; traces go under
`traces/<runId>/`, and a denormalized `index.json` is rebuilt on each
publish so readers never scan the tree.

Registry refs: `<dir>` · `file://<dir>` · `<git-url>` · `git::<url>` ·
`s3://<bucket>/<prefix>` — or the `ARENA_REGISTRY` env var.

```bash
sverka-arena publish .arena/results.json --pack node-ci --registry <ref>
sverka-arena board --registry <ref> --pack node-ci
sverka-arena board --registry <ref> --format html --out board.html
sverka-arena reindex --registry <ref>
```

`publish` accepts either a matrix `results.json` (exploded into one v1
document per model × plugin-set cell — `--pack` and an agent context are
required: `--agent` or a config with `agent`) or an already-shaped
`arena.result/v1` document. A git push rejection triggers one rebase retry,
then `PUBLISH_CONFLICT` — results stay append-only, and the failed commit
remains in the local checkout (the error names its path).

`board` groups results into cohorts keyed
(pack · task · sverka version · prompt hash) — runs from different prompts
or sverka versions never merge into one score — and renders one row per
(agent, model) with success rate, median tokens/duration, run count, and a
30-day success-rate trend. `--format json` emits the cohort data;
`--format html` writes a self-contained static leaderboard page.

The website leaderboard is the same render at Pages time:
`bun run docs:board` in `website/` (reads `--registry`, `ARENA_REGISTRY`,
or the committed fixture registry) regenerates
`public/benchmark/board.html`, which ships statically like the rest of the
benchmark snapshot.

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

| Code | Meaning                                                              |
| ---- | -------------------------------------------------------------------- |
| `0`  | success                                                              |
| `1`  | `doctor` found environment problems, `pack lint` found pack errors   |
| `2`  | usage error — bad args, bad config/pack, unreadable or invalid input |
| `3`  | runtime failure — run/report errors, registry unavailable or push    |
|      | conflict                                                             |

## Example

This repo dogfoods arena: `packages/arena/arena.config.ts` benchmarks Devin
on the `ts-fix-test` fixture, with and without the `sverka` skill:

```bash
sverka-arena doctor --config packages/arena/arena.config.ts
sverka-arena run --config packages/arena/arena.config.ts
```
