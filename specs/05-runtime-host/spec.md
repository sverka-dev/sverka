# Spec 05 — Host Process Executor

## Overview

The `runtime-host` package implements the `Executor` interface from
`runtime` for running trusted, lightweight tools directly on the host as
child processes. It is intended for fast, low-overhead operations that do not
require container isolation — for example, running a local linter, a type
checker, or a quick script that operates on the workspace.

Usage is **restricted**: the host executor is opt-in, must be explicitly
enabled in configuration, and may only run operations that are explicitly
declared with `executor.type: "host"`. It is never a fallback for container
operations. Security restrictions limit which commands can run, enforce
timeouts, capture output, and prevent ambient privilege escalation.

## Goals

1. Implement the `Executor` interface for host processes with `canExecute` and
   `execute`.
2. Provide fast, low-overhead execution for trusted lightweight tools.
3. Enforce restricted usage: only operations explicitly declaring
   `executor.type: "host"` are eligible; the executor must be explicitly
   enabled in config.
4. Spawn child processes with:
   - Mandatory timeout (kill the process on expiry).
   - Full stdout/stderr capture.
   - Bounded environment variables (no ambient host env leakage beyond an
     explicit allowlist).
   - Working directory constrained to the workspace.
5. Apply a command allowlist to restrict which binaries may be invoked.
6. Collect exit code, logs, and artifacts.
7. Support retry and timeout policies from the Plan.
8. Be fully testable without a container runtime.

## Non-goals

- Replacing the Docker or Podman executors for untrusted or heavy workloads.
- Providing filesystem isolation (the host executor operates on the real
  workspace; sandboxing is the container executors' job).
- Network isolation (host processes have ambient host network; if network
  isolation is required, use a container executor).
- Running operations that declare `executor.type` other than `"host"`.
- Privilege escalation or sudo execution.

## Interfaces

```typescript
// src/index.ts — public exports

export { HostExecutor } from "./host-executor.js";
export { type HostExecutorConfig } from "./config.js";
export { type CommandAllowlist } from "./allowlist.js";
export { HostExecutorError, HostTimeoutError, CommandNotAllowedError }
  from "./errors.js";
```

```typescript
// src/config.ts

export interface HostExecutorConfig {
  /** Must be true to enable the host executor. Defaults to false. */
  readonly enabled: boolean;
  /** Workspace root; child processes run with this as cwd. */
  readonly workspace: string;
  /** Directory for collected artifacts. */
  readonly artifactDir: string;
  /** Allowlist of binary names or absolute paths that may be executed. */
  readonly allowlist: CommandAllowlist;
  /** Env vars from the host that are forwarded to child processes. */
  readonly envAllowlist: readonly string[];
  /** Extra env vars to inject. */
  readonly env?: Readonly<Record<string, string>>;
  /** Maximum log size in bytes before truncation. Defaults to 10 MiB. */
  readonly maxLogBytes?: number;
  /** Default uid to run as. Defaults to current user. Not elevated. */
  readonly runAsUid?: number;
}
```

```typescript
// src/allowlist.ts

/**
 * An allowlist of commands the host executor may run. Entries are binary
 * names (resolved via PATH) or absolute paths. Glob patterns are not
 * supported to keep matching deterministic.
 */
export interface CommandAllowlist {
  readonly entries: readonly string[];
  /** Returns true if the given command is allowed. */
  isAllowed(command: string): boolean;
}

export function createAllowlist(entries: readonly string[]): CommandAllowlist;
```

```typescript
// src/host-executor.ts

import type { Executor, ExecuteRequest, ExecuteResult }
  from "@sverka/runtime";
import type { PlanOperation } from "@sverka/ir";
import type { HostExecutorConfig } from "./config.js";

/**
 * Host process implementation of the Executor interface.
 *
 * Restricted: only operations with executor.type === "host" are eligible,
 * and only when config.enabled is true.
 */
export class HostExecutor implements Executor {
  readonly name = "host";

  constructor(config: HostExecutorConfig);

  canExecute(operation: PlanOperation): boolean;
  execute(request: ExecuteRequest): Promise<ExecuteResult>;
  dispose(): Promise<void>;
}
```

## Data models

### Process spawning

```
HostExecutor.execute(request)
  1. Validate config.enabled === true       → else HostExecutorError
  2. Validate operation.executor.type === "host" → else HostExecutorError
  3. Validate operation.timeoutSeconds > 0  → else HostExecutorError (MISSING_TIMEOUT)
  4. Validate allowlist.isAllowed(command)  → else CommandNotAllowedError
  5. Build env:
       - Start empty.
       - Forward only envAllowlist entries from the host environment.
       - Merge config.env overrides.
       - Merge operation.credentials env vars.
       - Merge operation.env vars.
  6. Spawn child process:
       - command: operation.command
       - args: operation.args
       - cwd: config.workspace (or operation.workingDir if relative to workspace)
       - env: built env
       - stdio: pipe (capture stdout + stderr)
  7. Apply timeout:
       - Set a timer for timeoutSeconds * 1000 ms.
       - On expiry: SIGTERM, then SIGKILL after 2s grace.
       - Record status: "failure", error: "timeout".
  8. Capture output:
       - Concatenate stdout + stderr.
       - Truncate at maxLogBytes with a notice.
  9. Collect artifacts:
       - Copy declared artifact paths into config.artifactDir.
  10. Return ExecuteResult:
       - status: success (exit 0) | failure (exit != 0) | cancelled
       - exitCode, durationMs, logs, artifacts
```

### Security restrictions

| Restriction               | Enforcement                                             |
|---------------------------|---------------------------------------------------------|
| Explicit enable           | `config.enabled` must be `true`                         |
| Type guard                | `operation.executor.type` must be `"host"`              |
| Command allowlist         | `command` must match an allowlist entry                 |
| Mandatory timeout         | `timeoutSeconds` must be present and > 0                |
| Bounded env               | Only `envAllowlist` + `credentials` + `operation.env`   |
| No ambient env leakage    | Host env not forwarded unless in `envAllowlist`         |
| Workspace-constrained cwd | `cwd` is within `config.workspace`                      |
| No privilege escalation    | `runAsUid` must not be 0; no `sudo` in allowlist        |
| No network isolation      | Host network is ambient; document this limitation       |

### Eligibility (`canExecute`)

```
canExecute(operation):
  return config.enabled
    && operation.executor.type === "host"
    && allowlist.isAllowed(operation.command ?? "")
    && operation.timeoutSeconds !== undefined
    && operation.timeoutSeconds > 0
```

## Error handling

All errors extend `HostExecutorError`.

```typescript
// src/errors.ts

export class HostExecutorError extends Error {
  constructor(
    message: string,
    readonly code: string,
    readonly context?: Record<string, unknown>,
  ) {
    super(message);
    this.name = "HostExecutorError";
  }
}

/** Raised when a process exceeds its timeout. */
export class HostTimeoutError extends HostExecutorError {
  constructor(message: string, context?: Record<string, unknown>) {
    super(message, "HOST_TIMEOUT", context);
    this.name = "HostTimeoutError";
  }
}

/** Raised when a command is not in the allowlist. */
export class CommandNotAllowedError extends HostExecutorError {
  constructor(message: string, context?: Record<string, unknown>) {
    super(message, "COMMAND_NOT_ALLOWED", context);
    this.name = "CommandNotAllowedError";
  }
}
```

Rules:

1. **Executor disabled.** If `config.enabled` is `false`, `canExecute` returns
   `false` for all operations. If `execute` is called directly, it raises
   `HostExecutorError` with code `EXECUTOR_DISABLED`.
2. **Wrong executor type.** If `operation.executor.type !== "host"`,
   `canExecute` returns `false`. If `execute` is called, it raises
   `HostExecutorError` with code `WRONG_EXECUTOR_TYPE`.
3. **Command not allowed.** If the command is not in the allowlist,
   `CommandNotAllowedError` is raised with the command in context. No process
   is spawned.
4. **Missing timeout.** If `timeoutSeconds` is absent or <= 0,
   `HostExecutorError` with code `MISSING_TIMEOUT` is raised. No process is
   spawned.
5. **Timeout expiry.** When the timer fires, the process receives SIGTERM,
   then SIGKILL after a 2-second grace period. The result has
   `status: "failure"` and `error: "timeout after Ns"`.
6. **Privilege escalation.** If `runAsUid` is 0 or the allowlist contains
   `sudo` or `su`, `HostExecutorError` with code `PRIVILEGE_ESCALATION` is
   raised at construction time.
7. **Working directory.** If `operation.workingDir` resolves outside
   `config.workspace`, `HostExecutorError` with code `WORKDIR_OUTSIDE_WORKSPACE`
   is raised.
8. **Process failure.** A non-zero exit code produces
   `ExecuteResult.status: "failure"` with the exit code and logs. This is not
   an exception; it is a normal result.
9. **Spawn failure.** If the binary cannot be found or spawn fails, the result
   has `status: "failure"` with `error` describing the spawn error.
10. **Log truncation.** Logs exceeding `maxLogBytes` are truncated with a
    notice appended.

## Test plan

Tests live in `packages/runtime-host/src/__tests__/` and run via `bun test`.
No Docker daemon is required.

1. **canExecute**
   - Returns `false` for all operations when `config.enabled` is `false`.
   - Returns `true` for `executor.type: "host"` with an allowed command and a
     valid timeout.
   - Returns `false` for `executor.type: "docker"`.
   - Returns `false` when the command is not in the allowlist.
   - Returns `false` when `timeoutSeconds` is missing.

2. **Process spawning and output capture**
   - Running `echo hello` captures `hello\n` in logs and returns
     `status: "success"`, `exitCode: 0`.
   - Running `exit 1` returns `status: "failure"`, `exitCode: 1`.
   - stdout and stderr are both captured and present in `logs`.

3. **Timeout**
   - An operation with `timeoutSeconds: 1` running `sleep 10` is killed and
     returns `status: "failure"` with a timeout error message.
   - An operation without `timeoutSeconds` raises `HostExecutorError`
     (`MISSING_TIMEOUT`).

4. **Command allowlist**
   - A command not in the allowlist raises `CommandNotAllowedError` with the
     command in context.
   - An allowlist with an exact binary name matches that binary.
   - An allowlist entry that is an absolute path matches only that path.

5. **Environment bounding**
   - Only `envAllowlist` entries from the host are forwarded.
   - `operation.env` values are present in the child environment.
   - `operation.credentials` env vars are present.
   - A host env var not in `envAllowlist` is not present in the child.

6. **Working directory**
   - The child process `cwd` is `config.workspace` by default.
   - `operation.workingDir` relative to the workspace is honored.
   - `operation.workingDir` resolving outside the workspace raises
     `HostExecutorError` (`WORKDIR_OUTSIDE_WORKSPACE`).

7. **Privilege escalation prevention**
   - Constructing `HostExecutor` with `runAsUid: 0` raises
     `HostExecutorError` (`PRIVILEGE_ESCALATION`).
   - An allowlist containing `sudo` or `su` raises
     `HostExecutorError` (`PRIVILEGE_ESCALATION`) at construction.

8. **Artifacts**
   - Declared artifact paths are copied into `config.artifactDir`.
   - Missing artifact paths are reported in the result error but do not
     change the operation status.

9. **Log truncation**
   - Output exceeding `maxLogBytes` is truncated and a notice is appended.

10. **Retry policy**
    - An operation with `maxAttempts: 3` that fails twice then succeeds
      returns `status: "success"`.
    - An operation that fails all attempts returns `status: "failure"`.

11. **Type safety**
    - `bun run typecheck` passes with `strict: true` and no `any` types.

12. **Commands**
    ```bash
    bun test packages/runtime-host
    bun run typecheck
    bun run lint
    ```
