# Workflow API

> **Work in progress.** Sverka is under active development. The Construct
> authoring surface (`@sverka/workflow`) is implemented and is what
> `sverka init` generates. APIs may change without notice.

Sverka workflows are TypeScript. This page documents the authoring surfaces
that are implemented today and how a workflow becomes a runnable Plan.

## Authoring surfaces

### Construct API (`@sverka/workflow`)

Low-level construct tree: `Project`, `Pipeline`, `ShellStep`, `Entry`. This is
the surface that `sverka init` generates by default.

```ts
import { Project, Pipeline, ShellStep, Entry } from "@sverka/workflow";

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

### Programmatic API (`@sverka/sdk`)

For driving Sverka from code — discovery, plan synthesis, execution — use
`createSverka` (see [From workflow to Plan](#from-workflow-to-plan) below).
The package also exports the v0 composables (`$`, `shell`, `artifact`,
`pipeline`, `when`, `matrix`) for building workflows programmatically.

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

The Construct surface produces a **Definition Graph**. The CLI and
SDK convert that graph into a canonical **Plan** (`@sverka/workflow`) — a validated,
serializable DAG of operations. The Plan is what the runtime executes and what
the compilers lower to CI YAML.

```sh
sverka plan    # synthesize the graph, bind a Run Plan, print it
sverka run     # execute the Run Plan locally
```

Programmatically, the same pipeline is `synthesize` (DefinitionGraph) plus
`bindRunPlan` (Run Plan):

```ts
import { synthesize } from "@sverka/workflow";
import { bindRunPlan } from "@sverka/sdk";

const graph = synthesize(proj);   // DefinitionGraph from the construct tree
const runPlan = bindRunPlan({ graph, entryId: "on-push" });
```

`createSverka` in `@sverka/sdk` is a separate entry point for the legacy
`{ name, workflow }` config shape — it does not load Construct configs.

The Plan is then either:

- **Executed locally** via `sverka run`
- **Compiled to CI YAML** via `sverka compile --target github|gitlab`

See [GitHub Actions compiler](../compiling/github/) and
[GitLab CI compiler](../compiling/gitlab/) for the compiler APIs.

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
