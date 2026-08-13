# GitHub Actions target

The `@sverka/github` package performs native lowering from a Definition
Graph to GitHub Actions YAML. Source: `packages/github/src/target.ts`.

## Usage

```ts
import { GithubTarget, compileGithub } from "@sverka/github";
import { synthesize } from "@sverka/core";
import { Project, Pipeline, ShellStep, Entry } from "@sverka/cdk";

const proj = new Project("myproj");
const p = new Pipeline(proj, "ci");
new ShellStep(p, "build", { command: "npm run build" });
new Entry(p, "on-push", { trigger: { kind: "push" }, roots: ["build"] });

const graph = synthesize(proj);

// Convenience function
const result = compileGithub(graph);
// result.artifacts[0].content → YAML string
// result.diagnostics → capability diagnostics

// Or use the Target contract directly
const target = new GithubTarget();
const diagnostics = target.analyze(graph);
const targetGraph = target.lower(graph);
const artifacts = target.emit(targetGraph);
```

## Target contract

The GitHub target implements the Target contract (architecture spec §19):

1. **analyze(graph)** — checks capability support via `@sverka/plugin`
2. **lower(graph)** — maps Definition Graph → GithubTargetGraph (IR)
3. **emit(targetGraph)** — converts IR → YAML artifacts

## Lowering mappings

| Sverka | GitHub Actions |
|---|---|
| Step | Job (1:1) |
| Dependencies | `needs` |
| Runtime host | `runs-on: ubuntu-latest` |
| Runtime container | `container: <image>` |
| Shell operation | `run:` step |
| Artifact output | `actions/upload-artifact@v4` |
| Artifact import | `actions/download-artifact@v4` + checkout |
| Scalar output | `$GITHUB_OUTPUT` |
| Push trigger | `on: push` |
| ChangeRequest trigger | `on: pull_request` |
| Manual trigger | `on: workflow_dispatch` |
| Timeout | `timeout-minutes` |

## Capability manifest

```ts
const githubCapabilities = {
  "trigger.push": "native",
  "trigger.changeRequest": "native",
  "trigger.manual": "native",
  "runtime.host": "native",
  "runtime.container": "native",
  "operation.shell": "native",
  "output.scalar": "lowered",    // via $GITHUB_OUTPUT
  "output.artifact": "native",
  "runtime.secrets": "lowered",  // via job-level `env` referencing `secrets.<name>`
  "graph.dependencies": "native",
};
```

## CLI usage

`sverka synth --target github` is not yet implemented in the CLI and currently
returns a stub error. Use the `compileGithub` package API to generate YAML.
