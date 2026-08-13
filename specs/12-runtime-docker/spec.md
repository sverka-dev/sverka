# Spec 12 — Runtime Docker

**Status:** Active
**Source:** specs/architecture-spec.md §22.4, §14
**Package:** `@sverka/runtime-docker` (adapted)

## Overview

The Docker driver executes shell commands inside OCI containers via the
Docker CLI. It implements the `RuntimeDriver` interface from
`@sverka/engine-native`. It enforces a strict container execution policy:
read-only root filesystem, dropped capabilities, no network by default,
non-root user, bounded timeout, and the Docker socket is never mounted.

## Goals

- `DockerDriver` implements `RuntimeDriver`
- `canExecute`: returns true for steps with `runtime.mode === "container"`
  and `runtime.image` set
- `executeShell`: runs `docker run` with the step's image, mounts workspace,
  forwards env vars, enforces timeout
- Container security policy (reuse from existing)
- Image ref verification (reuse from existing)

## Non-goals

- Host execution (spec 11)
- Cache (§32)
- Resource limits / CPU-memory (not v0)
- Podman support (separate package, later wave)
- Containerd support (later)

## Interfaces

```ts
import type { RuntimeDriver } from "@sverka/engine-native";

interface DockerDriverConfig {
  readonly dockerPath?: string;
  readonly dockerHost?: string;
  readonly runAs?: string;
  readonly maxLogBytes?: number;
  readonly network?: string;  // default: "none"
}

function createDockerDriver(config: DockerDriverConfig): RuntimeDriver;
```

### Exports

```ts
export { createDockerDriver };
export type { DockerDriverConfig };
export { DockerExecutorError, ContainerPolicyError, ImageDigestError };
```

## Data models

`canExecute(step)`: returns true when `step.runtime.mode === "container"`
AND `step.runtime.image` is a non-empty string.

`executeShell(request)`: builds `docker run` args — read-only rootfs
(`--read-only`), dropped capabilities (`--cap-drop=ALL`), non-root user
(`--user <runAs>`), no network by default (`--network none`), workspace
mount (`-v <workspace>:/workspace`), env vars (`--env`), timeout via
`--stop-timeout`, image ref, and the command. Captures stdout/stderr,
truncates logs.

## Error handling

Reuses existing `DockerExecutorError`, `ContainerPolicyError`, and
`ImageDigestError` unchanged.

## Test plan

1. `createDockerDriver`: returns a RuntimeDriver.
2. `canExecute`: true for container-mode steps with image.
3. `canExecute`: false for host-mode steps.
4. `canExecute`: false when no image set.
5. `buildDockerArgs`: correct args for read-only, non-root, no-network.
6. `buildDockerArgs`: workspace mounted at /workspace.
7. `buildDockerArgs`: env vars forwarded.
8. `buildDockerArgs`: Docker socket never mounted (policy).
9. `executeShell`: runs a command in a container (integration test, skip
   if Docker not available).
10. Error classes: DockerExecutorError base.
11. Public API: all exports present, no any types.
