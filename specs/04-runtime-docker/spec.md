# Spec 04 — Docker Executor

## Overview

The `runtime-docker` package implements the `Executor` interface from
`runtime` using Docker as the execution backend. It enforces a strict
container execution policy: the workspace is mounted read-only, network access
is denied by default, all Linux capabilities are dropped, the container runs
as a non-root user, CPU and memory are bounded, a timeout is mandatory,
secrets are passed only via an explicit allowlist, and the Docker socket is
never exposed to the container.

The executor also verifies image digests before execution and manages cache
layers for incremental execution.

## Goals

1. Implement the `Executor` interface for Docker with `canExecute` and
   `execute`.
2. Enforce a hard container execution security policy:
   - Workspace mounted **read-only**.
   - Network **denied** by default (`--network none`).
   - All Linux capabilities **dropped** (`--cap-drop ALL`).
   - Container runs as a **non-root** user.
   - CPU and memory **bounded** per operation.
   - **Timeout mandatory**; no operation runs without one.
   - Secrets passed only via an **explicit allowlist** of environment
     variables.
   - Docker socket **never** mounted into the container.
3. Verify the image digest before execution; refuse to run an image whose
   digest does not match the declared digest.
4. Manage cache inputs and outputs via bind-mounted cache directories.
5. Collect stdout/stderr logs and artifact paths.
6. Support retry and timeout policies as declared in the Plan.
7. Be testable with a mock Docker API where possible; integration tests
   require a real Docker daemon and are marked skippable.

## Non-goals

- Supporting Podman (handled by `runtime-podman`).
- Supporting host-process execution (handled by `runtime-host`).
- Defining the scheduler (handled by `runtime`).
- Building or publishing Docker images.
- Managing Docker daemon lifecycle (assumed available).
- Kubernetes or remote Docker execution.

## Interfaces

```typescript
// src/index.ts — public exports

export { DockerExecutor } from "./docker-executor.js";
export { type DockerExecutorConfig } from "./config.js";
export { verifyImageDigest } from "./image.js";
export { type CacheManager, DockerCacheManager }
  from "./cache.js";
export { DockerExecutorError, ImageDigestError, ContainerPolicyError }
  from "./errors.js";
```

```typescript
// src/config.ts

export interface DockerExecutorConfig {
  /** Path to the Docker CLI or socket. Defaults to auto-detect. */
  readonly dockerPath?: string;
  readonly dockerHost?: string;
  /** Default non-root uid:gid for containers. Defaults to "1000:1000". */
  readonly runAs: string;
  /** Directory for cache layers. */
  readonly cacheDir: string;
  /** Directory for collected artifacts. */
  readonly artifactDir: string;
  /** Workspace root to mount read-only. */
  readonly workspace: string;
  /** Maximum log size in bytes before truncation. Defaults to 10 MiB. */
  readonly maxLogBytes?: number;
}
```

```typescript
// src/docker-executor.ts

import type { Executor, ExecuteRequest, ExecuteResult }
  from "@sverka/runtime";
import type { DockerExecutorConfig } from "./config.js";

/**
 * Docker implementation of the Executor interface.
 */
export class DockerExecutor implements Executor {
  readonly name = "docker";

  constructor(config: DockerExecutorConfig);

  canExecute(operation: PlanOperation): boolean;
  execute(request: ExecuteRequest): Promise<ExecuteResult>;
  dispose(): Promise<void>;
}
```

```typescript
// src/image.ts

import type { DockerExecutorConfig } from "./config.js";

/**
 * Verify that the locally available image digest matches the declared
 * digest. Pulls the image if not present. Throws ImageDigestError on
 * mismatch.
 */
export function verifyImageDigest(
  image: string,
  expectedDigest: string,
  config: DockerExecutorConfig,
): Promise<void>;
```

```typescript
// src/cache.ts

export interface CacheManager {
  /** Prepare a cache directory for an operation's declared inputs. */
  prepare(inputs: readonly string[], key: string): Promise<string>;
  /** Collect cache outputs after execution. */
  collect(outputs: readonly string[], sourceDir: string): Promise<void>;
}

export class DockerCacheManager implements CacheManager {
  constructor(cacheDir: string);
  prepare(inputs: readonly string[], key: string): Promise<string>;
  collect(outputs: readonly string[], sourceDir: string): Promise<void>;
}
```

## Data models

### Container execution policy

Every `execute()` call constructs a Docker invocation with these flags. No
flag may be overridden by the operation spec to weaken the policy.

```
docker run
  --rm
  --read-only                           # root filesystem read-only
  --cap-drop ALL                        # drop all capabilities
  --network none                        # no network (default)
  --user <runAs>                        # non-root uid:gid
  --memory <memoryLimit>                # hard memory limit
  --cpus <cpuLimit>                     # CPU limit
  --timeout <timeoutSeconds>            # mandatory timeout
  --workdir /workspace
  --mount type=bind,source=<workspace>,target=/workspace,readonly
  --mount type=bind,source=<cacheDir>,target=/cache
  --mount type=bind,source=<artifactDir>,target=/artifacts
  --env <allowlisted credentials only>
  <image>@<digest>
  <command> <args...>
```

### Policy enforcement table

| Policy              | Enforcement                                      | Overridable by op |
|---------------------|--------------------------------------------------|-------------------|
| Workspace read-only | `--read-only` + `readonly` bind mount            | No                |
| Network deny        | `--network none` (unless op declares `allow-egress`) | No (only widened to declared policy) |
| Capabilities        | `--cap-drop ALL`                                 | No                |
| Non-root user       | `--user <runAs>`                                 | No                |
| CPU bounded         | `--cpus <resources.cpu>`                         | No                |
| Memory bounded      | `--memory <resources.memory>`                    | No                |
| Timeout mandatory   | `--timeout <timeoutSeconds>`; reject if missing  | No                |
| Secrets allowlist   | only `credentials[].envVar` values are passed    | No                |
| Docker socket deny  | socket never bind-mounted                        | No                |

### Network policy mapping

| Plan `network`     | Docker flag                     |
|--------------------|---------------------------------|
| `deny`             | `--network none`                |
| `allow-host`       | `--network host` (requires op declaration) |
| `allow-egress`     | default Docker bridge network   |

### Cache management

```
CacheManager
 ├─ prepare(inputs[], key)
 │    └─ creates /cache/<key> with symlinks/copies of declared inputs
 └─ collect(outputs[], sourceDir)
      └─ copies declared outputs back into the persistent cacheDir
```

Cache directories are bind-mounted into the container at `/cache`. The
operation writes outputs there; the executor collects them after execution.

## Error handling

All errors extend `DockerExecutorError`.

```typescript
// src/errors.ts

export class DockerExecutorError extends Error {
  constructor(
    message: string,
    readonly code: string,
    readonly context?: Record<string, unknown>,
  ) {
    super(message);
    this.name = "DockerExecutorError";
  }
}

/** Raised when image digest verification fails. */
export class ImageDigestError extends DockerExecutorError {
  constructor(message: string, context?: Record<string, unknown>) {
    super(message, "IMAGE_DIGEST_MISMATCH", context);
    this.name = "ImageDigestError";
  }
}

/** Raised when a container policy violation is attempted. */
export class ContainerPolicyError extends DockerExecutorError {
  constructor(message: string, context?: Record<string, unknown>) {
    super(message, "CONTAINER_POLICY_VIOLATION", context);
    this.name = "ContainerPolicyError";
  }
}
```

Rules:

1. **Missing timeout.** If `operation.timeoutSeconds` is absent or <= 0, the
   executor raises `ContainerPolicyError` with code `MISSING_TIMEOUT` and does
   not start a container.
2. **Missing image digest.** If `executor.imageDigest` is absent for a
   docker-type operation, the executor raises `ContainerPolicyError` with code
   `MISSING_DIGEST`.
3. **Image digest mismatch.** If the pulled image's digest does not match the
   declared digest, `ImageDigestError` is raised with both digests in context.
   The container is not started.
4. **Secret not in allowlist.** If `credentials` references an env var not in
   the operation's credential declarations, it is not passed. If an env var in
   `operation.env` looks like a secret (matches a denylist pattern) but is not
   declared, `ContainerPolicyError` with code `UNDECLARED_SECRET` is raised.
5. **Docker socket access.** If any mount or env attempts to reference the
   Docker socket, `ContainerPolicyError` with code `DOCKER_SOCKET_DENIED` is
   raised.
6. **Container failure.** A non-zero exit code produces
   `ExecuteResult.status: "failure"` with the exit code and logs. The executor
   does not throw for normal command failures; it throws only for policy and
   infrastructure errors.
7. **Timeout.** If the container exceeds `timeoutSeconds`, it is killed and
   the result has `status: "failure"` with an error indicating timeout.
8. **Log truncation.** Logs exceeding `maxLogBytes` are truncated and a
   truncation notice is appended.

## Test plan

Tests live in `packages/runtime-docker/src/__tests__/` and run via `bun test`.

1. **canExecute**
   - Returns `true` for operations with `executor.type === "docker"`.
   - Returns `false` for `host`, `podman`, and `remote` types.

2. **Container policy (unit tests with mocked Docker CLI)**
   - The constructed `docker run` command includes `--read-only`.
   - The command includes `--cap-drop ALL`.
   - The command includes `--network none` for `network: "deny"`.
   - The command includes `--user 1000:1000` (non-root).
   - The command includes `--memory` and `--cpus` from `resources`.
   - The workspace is mounted with `readonly`.
   - The Docker socket is never present in any mount.

3. **Timeout enforcement**
   - An operation without `timeoutSeconds` raises `ContainerPolicyError`
     (`MISSING_TIMEOUT`) and no container is started.
   - An operation with `timeoutSeconds: 1` that sleeps for 5 seconds is killed
     and returns `status: "failure"` with a timeout error message.

4. **Image digest verification**
   - `verifyImageDigest` with a matching digest resolves successfully.
   - `verifyImageDigest` with a mismatched digest throws `ImageDigestError`
     with both digests in context.
   - An operation without `imageDigest` raises `ContainerPolicyError`
     (`MISSING_DIGEST`).

5. **Secrets allowlist**
   - Only env vars listed in `credentials` are passed to the container.
   - An undeclared secret-like env var raises `ContainerPolicyError`
     (`UNDECLARED_SECRET`).
   - An attempt to mount the Docker socket raises `ContainerPolicyError`
     (`DOCKER_SOCKET_DENIED`).

6. **Network policy**
   - `network: "deny"` → `--network none`.
   - `network: "allow-egress"` → default bridge (no `--network none`).
   - `network: "allow-host"` → `--network host`.

7. **Cache management**
   - `DockerCacheManager.prepare` creates a cache directory keyed by the
     declared key.
   - `DockerCacheManager.collect` copies outputs back to the persistent
     cacheDir.
   - On a second run with the same key, inputs are restored from cache.

8. **Logs and artifacts**
   - stdout and stderr are captured into `ExecuteResult.logs`.
   - Logs exceeding `maxLogBytes` are truncated with a notice.
   - Artifacts declared in the operation are collected into `artifactDir`.

9. **Integration tests (require Docker daemon, skippable)**
   - Run `echo hello` in `busybox@<digest>` and assert `status: "success"`.
   - Run a command that exits 1 and assert `status: "failure"`, `exitCode: 1`.
   - These tests are guarded by `describe.skipIf(!process.env.SVERKA_DOCKER)`.

10. **Type safety**
    - `bun run typecheck` passes with `strict: true` and no `any` types.

11. **Commands**
    ```bash
    bun test packages/runtime-docker
    SVERKA_DOCKER=1 bun test packages/runtime-docker  # include integration
    bun run typecheck
    bun run lint
    ```
