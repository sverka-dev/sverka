# AI Agent Use Case Matrix

Sverka is an AI-first verification framework. Every CLI command ships with
`--format json` for structured agent consumption. The agent says **what** to
verify; Sverka handles **how** — building the pipeline, running everything
locally, and returning structured findings.

## How token savings work

Without Sverka, an AI agent verifying a repo must: call each tool individually,
parse stdout, decide what to run next, handle failures, and synthesize
findings — burning thousands of tokens in tool-call round-trips.

With Sverka, the agent issues a single command. Sverka builds the pipeline,
runs everything, and returns JSON. The agent spends ~50 tokens, not ~5000.

> **Token estimates below are approximate**, based on typical tool-call
> overhead (call + output + reasoning per round-trip). Actual savings depend
> on repo size, tool count, and agent model.

## Use case matrix

### 1. "Build, then lint, then sonar + codacy + trivy, output findings as SARIF"

| Aspect | Without Sverka | With Sverka |
|--------|----------------|-------------|
| Agent action | 6+ tool calls: run build, parse output, run lint, parse output, run sonar, run codacy, run trivy, collect SARIF from each | `sverka run --entry ci --format json` (one command) |
| Tokens (est.) | ~5000 (6 round-trips + output parsing + decision logic) | ~50 (one command + structured result) |
| Sverka pipeline | `build → lint → sonar → codacy → trivy` with SARIF extraction | Pre-authored in `sverka.config.ts` |
| Integration | CLI with `--format json` | |

This is the flagship use case. The agent declares the pipeline once in
`sverka.config.ts`. Every subsequent run is a single command.

### 2. "Plan this repo" — discover available checks

| Aspect | Without Sverka | With Sverka |
|--------|----------------|-------------|
| Agent action | Explore codebase: read `package.json`, detect language, find test runner, find linter, find security scanner — 5+ file reads + reasoning | `sverka discover --format json` (one command) |
| Tokens (est.) | ~2000 (file reads + language detection reasoning) | ~30 (one command + JSON output) |
| Sverka command | `sverka discover` — auto-detects package manager, languages, and proposes checks | |
| Integration | CLI with `--format json` | |

### 3. "Run all checks and give me findings"

| Aspect | Without Sverka | With Sverka |
|--------|----------------|-------------|
| Agent action | Run each check, parse output, normalize to common format, deduplicate | `sverka run --entry ci --format json` (findings included in run result) |
| Tokens (est.) | ~3000 (multiple tool calls + output normalization) | ~50 (one command + structured findings) |
| Sverka pipeline | Checks resolve to StepDefinitions, execute through engine, findings extracted from SARIF in the run result | |
| Integration | CLI with `--format json` | |

### 4. "Compile this workflow to GitHub Actions" (planned)

| Aspect | Without Sverka | With Sverka |
|--------|----------------|-------------|
| Agent action | Write YAML by hand: jobs, needs, runs-on, checkout, cache, artifact upload, matrix, triggers — 100+ lines of YAML | `sverka synth --target github` (planned — CLI stub exists, full lowering in progress) |
| Tokens (est.) | ~8000 (YAML generation + syntax verification) | ~30 (one command + YAML output) |
| Sverka command | Native lowering: 1 GitHub job per Step, deps → needs, artifacts → upload/download, scalar → GITHUB_OUTPUT | |
| Integration | CLI | |

### 5. "Validate my workflow before committing"

| Aspect | Without Sverka | With Sverka |
|--------|----------------|-------------|
| Agent action | Read config, reason about dependencies, check for cycles, verify references — manual graph analysis | `sverka validate --format json` |
| Tokens (est.) | ~1500 (config reading + graph reasoning) | ~20 (one command + validation result) |
| Sverka command | Synthesizes Definition Graph, runs validators (cycle, unknown-producer, output-collision, incompatible-ref) | |
| Integration | CLI or pre-commit hook | |

### 6. "What checks are available for this project?"

| Aspect | Without Sverka | With Sverka |
|--------|----------------|-------------|
| Agent action | Read package.json, detect PM, map to known tools, reason about what's standard | `sverka discover --format json` |
| Tokens (est.) | ~1000 (file reads + tool detection) | ~30 (one command + JSON) |
| Sverka command | Discovery: detects bun/npm/yarn/pnpm, Python, Rust, Go — proposes typecheck/lint/test/clippy/vet/fmt-check | |
| Integration | CLI with `--format json` | |

### 7. "Run only the checks for this entry"

| Aspect | Without Sverka | With Sverka |
|--------|----------------|-------------|
| Agent action | git diff, map changed files to checks, run subset, parse output | `sverka plan --entry ci --format json && sverka run --entry ci --format json` |
| Tokens (est.) | ~2500 (diff analysis + selective execution + output parsing) | ~50 (plan + run) |
| Sverka pipeline | Run Plan binding resolves reachable steps from entry roots; only those steps execute | |
| Integration | CLI with `--format json` | |

### 8. "Gate this PR — build + test + lint must pass"

| Aspect | Without Sverka | With Sverka |
|--------|----------------|-------------|
| Agent action | Run build, run test, run lint, check exit codes, decide pass/fail, report | `sverka run --format json && sverka policy --format json` |
| Tokens (est.) | ~2000 (3 tool calls + decision logic + reporting) | ~50 (run + policy evaluation) |
| Sverka pipeline | Pipeline executes build→test→lint, policy evaluates findings against failOn rules | |
| Integration | CLI with `--format json` | |

## CLI command reference (AI agent perspective)

| Command | What it does | Token savings (est.) |
|---------|-------------|----------------------|
| `sverka init` | Generate `sverka.config.ts` template | ~500 tokens of config authoring |
| `sverka validate` | Synthesize + validate Definition Graph | ~1500 tokens of graph reasoning |
| `sverka plan` | Bind Entry + inputs → Run Plan | ~800 tokens of dependency resolution |
| `sverka graph` | Display Definition Graph | ~1000 tokens of graph visualization |
| `sverka run` | Execute workflow locally | ~3000+ tokens of tool orchestration |
| `sverka discover` | Detect project context + propose checks | ~1000 tokens of codebase exploration |
| `sverka check` | Resolve + run checks → findings | ~2000 tokens of check execution |
| `sverka policy` | Evaluate findings against policy | ~500 tokens of pass/fail reasoning |
| `sverka synth` | Lower to GitHub/GitLab CI YAML | ~8000 tokens of YAML generation |
| `sverka doctor` | Diagnose environment | ~300 tokens of env troubleshooting |

All commands accept `--format json` for structured output. All commands accept
`--verbose` for debug output to stderr.

## AI integration surfaces

1. **CLI with `--format json`** (available now) — Any agent with shell access
   runs `sverka` commands and gets structured JSON. No output parsing needed.
2. **Claude plugin / AI skill** (planned) — Natural language → pipeline
   execution. `/sverka build, then lint, then sonar + trivy` → Sverka handles
   the rest. Not yet built.
3. **Pre-commit hook** — `sverka validate` in a git hook catches config errors
   before they reach CI.

## The token math (estimate)

A typical verification task (build + lint + 3 security scanners + findings):

- **Without Sverka:** 6 tool calls × ~800 tokens per round-trip (call +
  output + reasoning) = **~4800 tokens**
- **With Sverka:** 1 command + 1 result = **~100 tokens**
- **Savings:** ~4700 tokens per verification run (~97% reduction)

For an agent doing 20 verification runs per session: **~94,000 tokens saved**.

> These are estimates based on typical agent tool-call overhead. Actual
> savings vary by repo, tool count, and model.
