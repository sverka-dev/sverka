---
name: sverka
description: Use when the user wants to run sverka CLI commands or author Sverka workflows. Trigger on "sverka", "sverka plan", "sverka run", "sverka validate", "sverka graph", "sverka discover", "sverka check", "sverka policy", "sverka synth", "sverka doctor", "sverka config", "define workflow", "pipeline", "shell proxy", "fromClass", "compile to GitHub Actions", "compile to GitLab CI", "build lint test", "run checks", "verify project".
---

# Sverka

Define checks once. Plan locally. Run anywhere.

## Pipeline Recipe

The fastest path: detect all available checks → write one config → run once.
Don't read source files. Don't run checks individually. Everything goes
through one `sverka run`.

### Step 1: Detect available checks

Read `package.json` scripts and check for config files. Build a list of
available checks:

| Check | How to detect | Command |
|-------|--------------|---------|
| build | `scripts.build` in package.json | `npm run build` |
| lint | `scripts.lint` in package.json | `npm run lint` |
| typecheck | `scripts.typecheck` in package.json | `npm run typecheck` |
| test | `scripts.test` in package.json | `npm run test` |
| biome | `biome.json` or `biome.jsonc` exists | `npx @biomejs/biome check .` |
| oxlint | `.oxlintrc.json` or `oxlint` in deps | `npx oxlint .` |
| opengrep | `opengrep.yml` exists | `opengrep --config opengrep.yml` |
| prettier | `.prettierrc` or `prettier` in deps | `npx prettier --check .` |

Only include checks where the detection condition is met. Don't guess.

### Step 2: Write config

Write `sverka.config.ts` with all detected checks as steps. Chain
dependencies: lint/typecheck/biome/oxlint run first (parallel), then test,
then build. One entry, roots at the final step:

```typescript
import { Project, Pipeline, ShellStep, Entry, push } from "@sverka/cdk";

const proj = new Project("verify");
const ci = new Pipeline(proj, "ci");

// Fast checks first (parallel, no deps)
new ShellStep(ci, "lint", { command: "npm run lint" });
new ShellStep(ci, "typecheck", { command: "npm run typecheck" });

// Test depends on fast checks
new ShellStep(ci, "test", { command: "npm run test", dependsOn: ["lint", "typecheck"] });

// Build depends on test
new ShellStep(ci, "build", { command: "npm run build", dependsOn: ["test"] });

new Entry(ci, "on-push", { trigger: push(), roots: ["build"] });

export default proj;
```

Key rules:
- `dependsOn` is string array: `["lint"]`, NOT objects
- `roots` is the entry point — planner pulls transitive deps automatically
- Only include steps for checks that actually exist
- Use `npm run <script>` for package.json scripts, `npx <tool>` for standalone tools

### Step 3: Install dependency

```bash
npm install --save-dev @sverka/cdk
```

If `@sverka/cdk` is not resolvable (monorepo worktree, non-hoisted
node_modules), symlink it: `ln -sfn ../path/to/constructs node_modules/@sverka/cdk`

### Step 4: Run everything

```bash
npx @sverka/cli run
```

One command. Sverka loads the config, creates the plan, runs all steps in
topological order with parallelism. One entry → used automatically.

That's it. Don't run `validate` or `plan` separately — `run` does it all.

## Config Reference

### Construct API

```typescript
import { Project, Pipeline, ShellStep, Entry, push } from "@sverka/cdk";

const proj = new Project("verify");
const ci = new Pipeline(proj, "ci");
new ShellStep(ci, "build", { command: "npm run build" });
new ShellStep(ci, "test", { command: "npm run test", dependsOn: ["build"] });
new Entry(ci, "on-push", { trigger: push(), roots: ["test"] });

export default proj;
```

### SDK API

```typescript
import { $, shell, pipeline, artifact, push } from "@sverka/sdk";
import { Project, Entry } from "@sverka/cdk";

const proj = new Project("verify");

pipeline(proj, "ci", {
  steps: [
    (p) => $`npm run build`.outputs({ dist: artifact("./dist") }).build(p, "build"),
    (p) => shell.npm`run test`.dependsOn(["build"]).build(p, "test"),
  ],
  entries: [
    (p) => new Entry(p, "on-push", { trigger: push(), roots: ["test"] }),
  ],
});

export default proj;
```

### Decorator API

```typescript
import { pipeline, step, entry, input, fromClass } from "@sverka/decorators";
import { push } from "@sverka/cdk";

@pipeline
class CiPipeline {
  @input buildDir = { type: "string", required: true }

  @step
  build = "npm run build"

  @step({ dependsOn: ["build"] })
  test = "npm run test"

  @entry(push())
  onPush = ["test"]
}

export default fromClass(CiPipeline, "ci");
```

## Shell Proxy

```typescript
import { $, shell } from "@sverka/sdk";

$`make build`                        // bare command
shell.git`push origin main`          // → "git push origin main"
shell.npm`run test`                  // → "npm run test"
shell("bash").git`push origin main`  // forces bash interpreter
```

## CLI Commands

| Command | Description |
|---------|-------------|
| `sverka init` | Create `sverka.config.ts` from template |
| `sverka validate` | Check config without executing |
| `sverka plan` | Show the run plan |
| `sverka graph` | Print the definition graph |
| `sverka run` | Execute the workflow (plan + run) |
| `sverka discover` | Detect project context |
| `sverka check` | Resolve checks to commands |
| `sverka policy --findings <file>` | Evaluate policy against findings |
| `sverka synth --target github\|gitlab` | Compile to CI YAML |
| `sverka doctor` | Diagnose environment |

Global flags: `--config/-c`, `--root/-r`, `--format/-f` (human\|json), `--quiet/-q`, `--verbose/-v`

## Troubleshooting

See [references/troubleshooting.md](references/troubleshooting.md).
