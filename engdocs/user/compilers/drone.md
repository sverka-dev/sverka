# Drone / Gitness compiler target

> **Work in progress.** The Drone compiler generates `.drone.yml`. APIs may
> change.

The `@sverka/compiler` Drone sub-module compiles a DefinitionGraph to Drone
CI YAML (`.drone.yml`). Drone is simpler than GHA/GitLab — pipeline →
steps → commands. Gitness (Harness OSS) uses the same Drone YAML format.

## Usage

```ts
import { compileDrone } from "@sverka/compiler";
import { createSverka } from "@sverka/sdk";

const sverka = createSverka({ root: process.cwd() });
const graph = await sverka.toGraph();

const result = compileDrone(graph, {
  name: "my-pipeline",
  type: "docker",
  image: "node:24",
});

// result.files: { ".drone.yml": "..." }
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
