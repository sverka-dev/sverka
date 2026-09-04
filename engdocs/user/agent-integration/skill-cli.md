# Skill + CLI — AI Agent Integration

Sverka is designed to be AI-friendly: agents use Sverka through a skill or
the CLI, delegating workflow orchestration instead of running tools one by
one. Every CLI command ships with `--format json` for structured agent
consumption. The agent says **what** to verify; Sverka handles **how**.

## The thesis

Without Sverka, an AI agent verifying a repo must: call each tool
individually, parse stdout, decide what to run next, handle failures, and
synthesize findings — burning tokens in tool-call round-trips.

With Sverka, the agent issues a single command. Sverka builds the pipeline,
runs everything, and returns JSON. The agent delegates orchestration; Sverka
handles execution.

> **Token estimates below are targets, not measured results.** A benchmark
> harness is planned to measure actual token usage, tool-call counts, and
> execution time comparing agents with and without Sverka across workflow
> complexity levels. The estimates represent the hypothesis the benchmark
> will test.

## Use case matrix

### 1. "Build, then lint, then sonar + codacy + trivy, output findings as SARIF"

| Aspect | Without Sverka | With Sverka |
|--------|----------------|-------------|
| Agent action | 6+ tool calls: run build, parse output, run lint, parse output, run sonar, run codacy, run trivy, collect SARIF from each | `sverka run --entry ci --format json` (one command) |
| Tokens (target) | ~5000 (6 round-trips + output parsing + decision logic) | ~50 (one command + structured result) |
| Sverka pipeline | `build → lint → sonar → codacy → trivy` with SARIF extraction | Pre-authored in `sverka.config.ts` |

This is the flagship use case. The agent declares the pipeline once in
`sverka.config.ts`. Every subsequent run is a single command.

### 2. "Plan this repo" — discover available checks

| Aspect | Without Sverka | With Sverka |
|--------|----------------|-------------|
| Agent action | Explore codebase: read `package.json`, detect language, find test runner, find linter, find security scanner — 5+ file reads + reasoning | `sverka discover --format json` (one command) |
| Tokens (target) | ~2000 (file reads + language detection reasoning) | ~30 (one command + JSON output) |

### 3. "Run all checks and give me findings"

| Aspect | Without Sverka | With Sverka |
|--------|----------------|-------------|
| Agent action | Run each check, parse output, normalize to common format, deduplicate | `sverka run --entry ci --format json` (findings included in run result) |
| Tokens (target) | ~3000 (multiple tool calls + output normalization) | ~50 (one command + structured findings) |

### 4. "Compile this workflow to GitHub Actions"

| Aspect | Without Sverka | With Sverka |
|--------|----------------|-------------|
| Agent action | Write YAML by hand: jobs, needs, runs-on, checkout, cache, artifact upload, matrix, triggers — 100+ lines of YAML | `sverka synth --target github` (stub — not yet implemented; use `@sverka/compiler` library for programmatic compilation) |
| Tokens (target) | ~8000 (YAML generation + syntax verification) | ~30 (one command + YAML output) |

### 5. "Validate my workflow before committing"

| Aspect | Without Sverka | With Sverka |
|--------|----------------|-------------|
| Agent action | Read config, reason about dependencies, check for cycles, verify references — manual graph analysis | `sverka validate --format json` |
| Tokens (target) | ~1500 (config reading + graph reasoning) | ~20 (one command + validation result) |

### 6. "Gate this PR — build + test + lint must pass"

| Aspect | Without Sverka | With Sverka |
|--------|----------------|-------------|
| Agent action | Run build, run test, run lint, check exit codes, decide pass/fail, report | `sverka run --format json` (exit code + status); `sverka check --format json` then `sverka policy --findings findings.json --format json` for policy gates |
| Tokens (target) | ~2000 (3 tool calls + decision logic + reporting) | ~50 (run + policy evaluation) |

## CLI command reference (AI agent perspective)

| Command | What it does |
|---------|-------------|
| `sverka init` | Generate `sverka.config.ts` template |
| `sverka validate` | Synthesize + validate Definition Graph |
| `sverka plan` | Bind Entry + inputs → Run Plan |
| `sverka graph` | Display Definition Graph |
| `sverka run` | Execute workflow locally |
| `sverka discover` | Detect project context + propose checks |
| `sverka check` | Resolve + run checks → findings |
| `sverka policy` | Evaluate findings against policy |
| `sverka synth` | Lower to GitHub/GitLab CI YAML (stub — not yet implemented) |
| `sverka doctor` | Diagnose environment |
| `sverka mcp-server` | Start MCP server (see [MCP](./mcp.md)) |

All commands accept `--format json` for structured output (except
`mcp-server`, which uses MCP JSON-RPC over stdio). All commands
accept `--verbose` for debug output to stderr.

## Integration surfaces

1. **CLI with `--format json`** (available now) — Any agent with shell
   access runs `sverka` commands and gets structured JSON. No output
   parsing needed.
2. **Sverka skill** (available now) — An agent skill that wraps the CLI,
   providing natural-language triggers for common operations. The skill
   loads context about available commands and delegates to the CLI.
3. **MCP server** (available now) — `sverka mcp-server` exposes Sverka
   operations as MCP tools for MCP-compatible clients. See
   [MCP server](./mcp.md).
4. **Pre-commit hook** — `sverka validate` in a git hook catches config
   errors before they reach CI.

## Benchmark (planned)

The token estimates above are hypotheses. A benchmark harness is planned
to measure:

- **Token usage** — input + output tokens per task, with and without Sverka
- **Tool-call count** — number of round-trips per task
- **Execution time** — wall-clock time per task
- **Workflow complexity** — results across simple (3-step) to complex
  (15-step with agent + suspend) workflows

The benchmark will run the same task with two agents: one without Sverka
(raw shell/tools), one with Sverka (skill + CLI). Results will be
published on a dashboard with side-by-side comparison.
