# Workflow API

> **Work in progress.** Sverka is under active development. The Construct and
> Decorator authoring surfaces are implemented; the SDK builder composables
> (`sh`, `artifact`, `images`) described in earlier design docs are **not yet
> shipped**. APIs may change without notice.

Sverka workflows are TypeScript. This page documents the authoring surfaces
that are implemented today and how a workflow becomes a runnable Plan.

## Authoring surfaces

### Construct API (`@sverka/cdk`)

Low-level construct tree: `Project`, `Pipeline`, `ShellStep`, `Entry`. This is
the surface that `sverka init` generates by default.

```ts
import { Project, Pipeline, ShellStep, Entry } from "@sverka/cdk";

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

export default proj;
```

### Decorator API (`@sverka/decorators`)

TC39 standard decorators for class-based pipeline definitions.

```ts
import { pipeline, step, stepWithOptions, entry, input, decoratePipeline } from "@sverka/decorators";
import { Project } from "@sverka/cdk";

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

### SDK builder API (`@sverka/sdk`) — planned

The composable builders (`sh`, `artifact`, `when`, `images`, context
references) described in earlier design docs are **not yet implemented**. The
`@sverka/sdk` package currently exports the `createSverka` entry point (see
[From workflow to Plan](#from-workflow-to-plan) below) plus a compat re-export
of the core types. The builder API is planned for a later wave.

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
a path. Outputs are addressable through typed references.

## From workflow to Plan

The Construct/Decorator surfaces produce a **Definition Graph**. The CLI and
SDK convert that graph into a canonical **Plan** (`@sverka/ir`) — a validated,
serializable DAG of operations. The Plan is what the runtime executes and what
the compilers lower to CI YAML.

```ts
import { createSverka } from "@sverka/sdk";

const sverka = createSverka({ root: process.cwd() });

// Build the canonical Plan IR from sverka.config.ts
const plan = await sverka.toPlan();

// Or get a richer plan result with discovery context
const result = await sverka.plan();
// result.context   — discovered project context
// result.operations — operations in the plan
// result.plan      — the canonical Plan
```

The Plan is then either:

- **Executed locally** via `sverka run` (or `sverka.execute()`)
- **Compiled to CI YAML** via `sverka compile --target github|gitlab`

See [GitHub Actions compiler](../compilers/github/) and
[GitLab CI compiler](../compilers/gitlab/) for the compiler APIs.

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
