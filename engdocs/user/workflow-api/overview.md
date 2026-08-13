# Workflow API

Sverka workflows are TypeScript. The v0 redesign provides three equivalent
authoring surfaces that all produce the same Definition Graph.

## Authoring surfaces

### Construct API (`@sverka/constructs`)

Low-level construct tree: `Project`, `Pipeline`, `ShellStep`, `Entry`.

```ts
import { Project, Pipeline, ShellStep, Entry } from "@sverka/constructs";

const proj = new Project("myproj");
const p = new Pipeline(proj, "ci", {
  inputs: { nodeVersion: { type: "string", default: "22" } },
});

new ShellStep(p, "lint", { command: "npm run lint" });
new ShellStep(p, "build", {
  command: "npm run build",
  dependsOn: ["lint"],
  outputs: { dist: { type: "artifact", path: "./dist" } },
});

new Entry(p, "on-push", { trigger: { kind: "push" }, roots: ["build"] });
```

### SDK API (`@sverka/sdk`)

Composable builders with typed references: `sh`, `artifact`, `when`, `images`.

```ts
import { Project, Pipeline, Entry } from "@sverka/constructs";
import { sh, artifact, images } from "@sverka/sdk";

const proj = new Project("myproj");
const p = new Pipeline(proj, "ci");

sh`npm run lint`.build(p, "lint");
sh`npm run build`
  .outputs({ dist: artifact("./dist") })
  .dependsOn(["lint"])
  .build(p, "build");

new Entry(p, "on-push", { trigger: { kind: "push" }, roots: ["build"] });
```

### Decorator API (`@sverka/decorators`)

TC39 standard decorators for class-based pipeline definitions.

```ts
import { pipeline, step, stepWithOptions, entry, input, decoratePipeline } from "@sverka/decorators";
import { Project } from "@sverka/constructs";

@pipeline
class MyPipeline {
  @input
  nodeVersion = { type: "string" as const, default: "22" };

  @step
  lint = "npm run lint";

  @stepWithOptions({ dependsOn: ["lint"] })
  build = "npm run build";

  @entry({ kind: "push" })
  ["on-push"] = ["build"];
}

const proj = new Project("myproj");
decoratePipeline(MyPipeline, proj, "ci");
```

## Core types

### Project

Root of the construct tree. Contains Pipelines.

### Pipeline

Contains Steps, Entries, and Inputs.

### ShellStep

A step that executes a shell command. Supports:
- `command`: shell command string
- `dependsOn`: step IDs this step depends on
- `outputs`: artifact and scalar outputs
- `runtime`: host or container execution
- `timeout`: maximum execution time in milliseconds

### Entry

Binds a trigger to root steps. Triggers:
- `push`: on push to branches
- `changeRequest`: on pull/merge request
- `manual`: manually triggered

### Inputs

Typed pipeline inputs: string, number, boolean. With defaults, required
flags, descriptions, and secret classification.

### Outputs

Step outputs: string, number, boolean, artifact. Artifact outputs require
a path. Outputs are addressable through typed SDK references.

## References

Steps can reference outputs from other steps or context namespaces:

```ts
import { sh } from "@sverka/sdk";
import { env, secrets, git } from "@sverka/sdk";

// Step output reference
sh`deploy ${this.build.dist}`;

// Context references
sh`echo ${env.CI_TRACE}`;
sh`echo ${secrets.NPM_TOKEN}`;
sh`echo ${git.sha}`;
```

## Runtime

Steps can run on the host or in a container:

```ts
// Host execution (default)
new ShellStep(p, "test", { command: "npm test" });

// Container execution
new ShellStep(p, "test", {
  command: "npm test",
  runtime: { mode: "container", image: "node:22" },
});
```
