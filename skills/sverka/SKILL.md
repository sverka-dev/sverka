---
name: sverka
description: Use when the user wants to run sverka CLI commands or author Sverka workflows. Trigger on "sverka", "sverka plan", "sverka run", "sverka validate", "sverka graph", "sverka discover", "sverka check", "sverka policy", "sverka synth", "sverka compile", "sverka doctor", "sverka config", "define workflow", "pipeline", "shell proxy", "fromClass", "compile to GitHub Actions", "compile to GitLab CI", "build lint test", "run checks", "verify project".
---

# Sverka

Define checks once. Run locally. Compile anywhere.

## Pipeline Recipe

The fastest path: detect all available checks → write one config → run once.
Don't read source files. Don't run checks individually. Everything goes
through one `sverka run`.

### Step 1: Detect available checks

Read `package.json` scripts and check for config files. Build a list of
available checks:

| Check     | How to detect                        | Command                          |
| --------- | ------------------------------------ | -------------------------------- |
| build     | `scripts.build` in package.json      | `npm run build`                  |
| lint      | `scripts.lint` in package.json       | `npm run lint`                   |
| typecheck | `scripts.typecheck` in package.json  | `npm run typecheck`              |
| test      | `scripts.test` in package.json       | `npm run test`                   |
| biome     | `biome.json` or `biome.jsonc` exists | `npx @biomejs/biome check .`     |
| oxlint    | `.oxlintrc.json` or `oxlint` in deps | `npx oxlint .`                   |
| opengrep  | `opengrep.yml` exists                | `opengrep --config opengrep.yml` |
| prettier  | `.prettierrc` or `prettier` in deps  | `npx prettier --check .`         |

Only include checks where the detection condition is met. Don't guess.

### Step 2: Write config

Write `sverka.config.ts` with all detected checks as steps. Chain
dependencies: lint/typecheck/biome/oxlint run first (parallel), then test,
then build. One entry, roots at the final step:

```typescript
import { Project, Pipeline, ShellStep, Entry, push } from "@sverka/workflow";

const proj = new Project("verify");
const ci = new Pipeline(proj, "ci");

// Fast checks first (parallel, no deps)
new ShellStep(ci, "lint", { command: "npm run lint" });
new ShellStep(ci, "typecheck", { command: "npm run typecheck" });

// Test depends on fast checks
new ShellStep(ci, "test", {
  command: "npm run test",
  dependsOn: ["lint", "typecheck"],
});

// Build depends on test
new ShellStep(ci, "build", { command: "npm run build", dependsOn: ["test"] });

new Entry(ci, "on-push", { trigger: push(), roots: ["build"] });

export default proj;
```

Key rules:

- `dependsOn` accepts string IDs (`sverka validate` catches typos)
- `roots` is the entry point — planner pulls transitive deps automatically
- Only include steps for checks that actually exist
- Use `npm run <script>` for package.json scripts, `npx <tool>` for standalone tools
- Import from `@sverka/workflow`, NOT `@sverka/cdk` (that is an empty package)

### Step 3: Install dependency

```bash
npm install --save-dev @sverka/workflow
```

### Step 4: Run everything

```bash
npx sverka run
```

One command. Sverka loads the config, creates the plan, runs all steps in
topological order with parallelism. One entry → used automatically.

For AI agent integration, use JSON format for structured per-step results:

```bash
npx sverka run --format json
```

Output: `{"command":"run","data":{"planId":"...","status":"success","steps":[{"stepId":"ci/lint","status":"succeeded","durationMs":4307},...]}}`

On failure, steps include `stdout`, `stderr`, and `exitCode` so agents see
WHY the command failed without rerunning it:
`{"stepId":"ci/test","status":"failed","error":"step 'ci/test' shell command failed with exit code 1","exitCode":1,"stdout":"...","stderr":"...","durationMs":5176}`

That's it. Don't run `validate` or `plan` separately — `run` does it all.

## Auto-detect Config

Instead of manually writing config, use `--detect` to generate from real
project checks:

```bash
sverka init --detect
```

This uses the planner to discover project context (languages, package
managers, config files) and the built-in resolver to map checks to
commands. For a bun project: `bun run typecheck/lint/test`. For Rust:
`cargo clippy/fmt-check/test`. For Python: `ruff check/pytest`. For Go:
`go vet/test`. Falls back to minimal template if detection finds nothing.

## Config Reference

### Construct API

```typescript
import { Project, Pipeline, ShellStep, Entry, push } from "@sverka/workflow";

const proj = new Project("verify");
const ci = new Pipeline(proj, "ci");
new ShellStep(ci, "build", { command: "npm run build" });
new ShellStep(ci, "test", { command: "npm run test", dependsOn: ["build"] });
new Entry(ci, "on-push", { trigger: push(), roots: ["test"] });

export default proj;
```

### Dependencies

Sverka infers dependencies from data flow:

- Pass an output reference from one step as input to another → dependency auto-inferred
- For control-only deps (ordering without data flow), use `dependsOn` with string IDs
- `sverka validate` catches unknown step IDs — no need for object references

```typescript
new ShellStep(ci, "build", { command: "npm run build" });
new ShellStep(ci, "test", { command: "npm run test", dependsOn: ["build"] });
```

### Findings / SARIF artifacts

Steps can declare artifact outputs. For tools that emit SARIF on stdout,
use `fromStdout` so the captured output is stored as the artifact —
even when the check exits non-zero (findings present):

```typescript
new ShellStep(ci, "lint", {
  command: "ruff check --output-format=sarif",
  runtime: { shell: "sh" },
  outputs: { "results.sarif": { type: "artifact", fromStdout: true } },
});
```

`sverka run --evaluate` (or `--format sarif|web|html`) collects `*.sarif`
files from the artifact dir and runs the policy gate. If no step produced
artifacts, `--evaluate` fails with COLLECTION_FAILED instead of a false
"pass" verdict.

- Do NOT use `dependencies: [{ kind: "control", producer: "..." }]` — that prop does not exist

## CLI Commands

| Command                                  | Description                                  |
| ---------------------------------------- | -------------------------------------------- |
| `sverka init`                            | Create `sverka.config.ts` from template      |
| `sverka init --detect`                   | Generate config from detected project checks |
| `sverka validate`                        | Check config without executing               |
| `sverka plan`                            | Show the run plan                            |
| `sverka graph`                           | Print the definition graph                   |
| `sverka run`                             | Execute the workflow (plan + run)            |
| `sverka run --format json`               | Execute with structured per-step JSON output |
| `sverka discover`                        | Detect project context                       |
| `sverka check`                           | Resolve checks to commands                   |
| `sverka policy --findings <file>`        | Evaluate policy against findings             |
| `sverka compile --target github\|gitlab` | Compile to CI YAML                           |
| `sverka synth --target github\|gitlab`   | Alias for `compile`                          |
| `sverka doctor`                          | Diagnose environment                         |

Global flags: `--config/-c`, `--root/-r`, `--format/-f` (text\|json\|html\|sarif\|web), `--quiet/-q`, `--verbose/-v`

## Troubleshooting

See [references/troubleshooting.md](references/troubleshooting.md).
