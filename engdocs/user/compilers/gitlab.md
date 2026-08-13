# GitLab CI target

The `@sverka/gitlab` package performs native lowering from a Definition
Graph to GitLab CI YAML. Source: `packages/gitlab/src/target.ts`.

## Usage

```ts
import { GitlabTarget, compileGitlab } from "@sverka/gitlab";
import { synthesize } from "@sverka/core";
import { Project, Pipeline, ShellStep, Entry } from "@sverka/constructs";

const proj = new Project("myproj");
const p = new Pipeline(proj, "ci");
new ShellStep(p, "build", { command: "npm run build" });
new Entry(p, "on-push", { trigger: { kind: "push" }, roots: ["build"] });

const graph = synthesize(proj);

// Convenience function
const result = compileGitlab(graph);
// result.artifacts[0].content → YAML string
// result.diagnostics → capability diagnostics

// Or use the Target contract directly
const target = new GitlabTarget();
const diagnostics = target.analyze(graph);
const targetGraph = target.lower(graph);
const artifacts = target.emit(targetGraph);
```

## Target contract

The GitLab target implements the Target contract (architecture spec §19):

1. **analyze(graph)** — checks capability support via `@sverka/plugin`
2. **lower(graph)** — maps Definition Graph → GitlabTargetGraph (IR)
3. **emit(targetGraph)** — converts IR → `.gitlab-ci.yml`

## Lowering mappings

| Sverka | GitLab CI |
|---|---|
| Step | Job (1:1) |
| Dependencies | `needs` |
| Runtime host | no `image` (runner default) |
| Runtime container | `image: <image>` |
| Shell operation | `script:` entry |
| Artifact output | `artifacts:` paths |
| Artifact import | `dependencies` + `needs` |
| Scalar output | `.env` file via script |
| Push trigger | `rules: if $CI_PIPELINE_SOURCE == "push"` |
| ChangeRequest trigger | `rules: if merge_request_event` |
| Manual trigger | `rules: if web, when: manual` |
| Timeout | `timeout:` string (e.g., `10m`) |
| Stages | Topological level (`build`, `stage-1`, ...) |

## Capability manifest

```ts
const gitlabCapabilities = {
  "trigger.push": "native",
  "trigger.changeRequest": "native",
  "trigger.manual": "native",
  "runtime.host": "native",
  "runtime.container": "native",
  "operation.shell": "native",
  "output.scalar": "lowered",    // via .env file
  "output.artifact": "native",
  "graph.dependencies": "native",
};
```

## CLI usage

`sverka synth --target gitlab` is not yet implemented in the CLI and currently
returns a stub error. Use the `compileGitlab` package API to generate YAML.
