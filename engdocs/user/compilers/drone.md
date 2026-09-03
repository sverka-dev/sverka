# Drone / Gitness compiler target

> **Work in progress.** The Drone compiler generates `.drone.yml`. APIs may
> change.

The `@sverka/compiler` Drone sub-module compiles a DefinitionGraph to Drone
CI YAML (`.drone.yml`). Drone is simpler than GHA/GitLab — pipeline →
steps → commands. Gitness (Harness OSS) uses the same Drone YAML format.

## Usage

```ts
import { Project, Pipeline, ShellStep, Entry } from "@sverka/workflow";
import { synthesize } from "@sverka/workflow";
import { compileDrone } from "@sverka/compiler";

const proj = new Project("myproj");
const p = new Pipeline(proj, "ci");
new ShellStep(p, "lint", { command: "npm run lint" });
new Entry(p, "on-push", { trigger: { kind: "push" }, roots: ["lint"] });

const graph = synthesize(proj);

const result = compileDrone(graph, {
  type: "docker",
  image: "node:24",
});

// result.artifacts: [{ path: ".drone.yml", content: "..." }]
```

## What gets generated

- **`.drone.yml`** — Drone pipeline YAML. Step DAG maps to Drone steps
  with `depends_on`. Shell operations map to `commands` arrays. Runtime
  container maps to `image` + `type: docker`.

## Capability mapping

| Sverka feature | Drone mapping |
|----------------|--------------|
| Step DAG | Drone steps with `depends_on` |
| `push` trigger | Branch trigger |
| `changeRequest` trigger | Pull request trigger |
| `manual` trigger | Custom trigger |
| `schedule` trigger | Cron trigger (best-effort, diagnostic if unsupported) |
| Shell operations | `commands` array |
| Runtime container | `image` + `type: docker` |
| Matrix | Unsupported (diagnostic) |
| Step conditions | Unsupported (diagnostic) |
| Step outputs | Unsupported (diagnostic) |

## Limitations

Drone's YAML format is simpler than GHA/GitLab. Features that Drone doesn't
natively support (matrix, step conditions, step outputs) emit diagnostics
rather than errors. The generated pipeline is a valid Drone YAML that
covers the supported subset.
