# Spec 36 — Drone/Gitness Target

**Status:** Active
**Source:** specs/architecture-spec.md §19 (Target Contract), §24 (Capability Model), §29 (Package Surface)
**Package:** `@sverka/compiler` (drone sub-module)
**Capability namespace:** `drone.*`
**Related:** ADR-016, Spec 08 (github target), Spec 09 (gitlab target)

## Overview

Compile a DefinitionGraph to Drone CI YAML (`.drone.yml`). Drone is
simpler than GHA/GitLab — pipeline → steps → commands. Gitness (Harness
OSS) uses Drone YAML. This is a regular YAML target, following the exact
pattern of the GitHub and GitLab targets.

## Goals

- `compileDrone(graph, config?): CompilationResult` — pure function,
  no network, deterministic output.
- Emit one file: `.drone.yml` (Drone pipeline YAML).
- Map step DAG → Drone steps with `depends_on`.
- Map triggers: `push` → branch trigger; `changeRequest` → pull request
  trigger; `manual` → custom trigger; `schedule` → cron trigger.
- Map shell operations → `commands` array.
- Map runtime container → `image` + `type: docker`.
- Capability manifest declaring native/lowered/emulated/unsupported.

## Non-goals

- Gitness-specific extensions (Drone YAML is the common subset).
- Drone plugins (user configures their own plugins).
- Matrix support (Drone doesn't natively support matrix — diagnostic).
- Step conditions (Drone doesn't have step-level conditions — diagnostic).
- Step outputs (Drone doesn't have step outputs — diagnostic).
- Drone exec secrets / registry management.

## Interfaces

```ts
interface DroneTargetConfig {
  readonly type?: "docker" | "kubernetes";  // default: "docker"
  readonly image?: string;                   // default: "node:24"
}

function compileDrone(
  graph: DefinitionGraph,
  config?: DroneTargetConfig,
): CompilationResult;

class DroneTarget implements Target {
  readonly name = "drone";
  readonly capabilities: CapabilityManifest;
  constructor(config?: DroneTargetConfig);
  compile(graph: DefinitionGraph): CompilationResult;
}
```

No new types exported beyond `DroneTargetConfig`.

## Data models

### Generated YAML structure

```yaml
kind: pipeline
type: docker
name: <pipeline-id>
steps:
  - name: build
    image: node:24
    commands:
      - bun run build
  - name: test
    image: node:24
    commands:
      - bun test
    depends_on: [build]
trigger:
  branch:
    - main
```

### Step → Drone mapping

| Sverka | Drone |
|---|---|
| Step | `steps[]` entry with `name`, `image`, `commands` |
| Dependency | `depends_on: [producer]` |
| Shell operation | `commands: [cmd]` |
| Runtime container | `image: <image>` |
| Runtime host | `type: docker` + default image (emulated) |
| Push trigger | `trigger.branch` |
| ChangeRequest trigger | `trigger.event: [pull_request]` |
| Manual trigger | `trigger.event: [custom]` + `trigger.custom` |
| Schedule trigger | `trigger.cron: [expr]` |
| Timeout | `timeout: <seconds>` |
| Condition | Unsupported (diagnostic) |
| Matrix | Unsupported (diagnostic) |
| Scalar output | Unsupported (diagnostic) |
| Artifact output | Partial (Drone artifacts via plugins) |
| RetryPolicy | Unsupported (diagnostic) |

### Capability manifest

```ts
const droneCapabilities: CapabilityManifest = {
  "graph.dependencies": "native",
  "graph.conditions": "unsupported",
  "graph.matrix": "unsupported",
  "operation.shell": "native",
  "output.scalar": "unsupported",
  "output.artifact": "partial",
  "policy.retry": "unsupported",
  "policy.timeout": "native",
  "trigger.push": "native",
  "trigger.changeRequest": "native",
  "trigger.manual": "native",
  "trigger.schedule": "native",
  "runtime.host": "emulated",
  "runtime.container": "native",
  "agent.step": "unsupported",
};
```

## Error handling

`DroneTargetError` with `override readonly cause: unknown`. Codes:
- `INVALID_GRAPH` — no pipelines or no entries.
- `LOWER_FAILED` — step lowering error.
- `EMIT_FAILED` — YAML generation error.

## Test plan

1. Empty graph → `INVALID_GRAPH` error.
2. Single-step graph → pipeline with one step.
3. Two-step graph with dependency → `depends_on` in YAML.
4. Diamond dependency → correct `depends_on` chains.
5. Push trigger → `trigger.branch` in YAML.
6. ChangeRequest trigger → `trigger.event: [pull_request]`.
7. Manual trigger → `trigger.event: [custom]`.
8. Schedule trigger → `trigger.cron` in YAML.
9. Container runtime → `image` field in step.
10. Host runtime → emulated (default image, diagnostic).
11. Timeout → `timeout` field in step.
12. Condition → unsupported diagnostic.
13. Matrix → unsupported diagnostic.
14. Scalar output → unsupported diagnostic.
15. Generated YAML is valid (parse with `yaml.parse`).
16. Determinism: same graph → identical output.
17. Capability manifest exported and correct.
18. Public API: `compileDrone` + `DroneTarget` + types exported.
