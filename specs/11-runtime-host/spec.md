# Spec 11 — Runtime Host

**Status:** Active
**Source:** specs/architecture-spec.md §22.4, §14
**Package:** `@sverka/runtime-host` (adapted)

## Overview

The host driver executes shell commands as host processes. It implements
the `RuntimeDriver` interface from `@sverka/engine-native`. It enforces a
command allowlist, env var allowlist, timeout, and log truncation.

## Goals

- `HostDriver` implements `RuntimeDriver`
- `canExecute`: returns true for steps with `runtime.mode === "host"` or
  no mode specified (host is the default)
- `executeShell`: spawns a host process, captures stdout/stderr, enforces
  timeout with SIGTERM → SIGKILL escalation
- Command allowlist (reuse from existing)
- Env var allowlist (reuse from existing)
- Log truncation (reuse from existing)

## Non-goals

- Container execution (spec 12)
- Resource limits (not v0)
- User switching / runAsUid (deferred — v0 runs as current user)
- Cache (§32)

## Interfaces

```ts
import type { RuntimeDriver } from "@sverka/engine-native";

interface HostDriverConfig {
  readonly enabled: boolean;
  readonly allowlist: CommandAllowlist;
  readonly envAllowlist: readonly string[];
  readonly env?: Readonly<Record<string, string>>;
  readonly maxLogBytes?: number;
}

function createHostDriver(config: HostDriverConfig): RuntimeDriver;
```

### Exports

```ts
export { createHostDriver };
export type { HostDriverConfig };
export { CommandAllowlist, createAllowlist };
export { HostDriverError, CommandNotAllowedError };
```

## Data models

Reuses `CommandAllowlist` and `createAllowlist` from the existing
runtime-host package unchanged.

`canExecute(step)`: returns true when `config.enabled` is true AND
`step.runtime.mode` is undefined or `"host"` AND the step's first shell
operation command is in the allowlist.

`executeShell(request)`: spawns the command with `spawn()`, forwards
allowlisted env vars + request env + `SVERKA_OUTPUT_DIR`, captures
stdout/stderr, enforces timeout via SIGTERM → SIGKILL after grace period,
truncates logs to `maxLogBytes`.

## Error handling

Reuses existing `HostDriverError` and `CommandNotAllowedError` unchanged.

## Test plan

1. `createHostDriver`: returns a RuntimeDriver.
2. `canExecute`: true for host-mode steps with allowed commands.
3. `canExecute`: false when disabled.
4. `canExecute`: false for container-mode steps.
5. `executeShell`: runs a simple command, returns exitCode 0 and stdout.
6. `executeShell`: timeout → timedOut true, exitCode non-zero.
7. `executeShell`: non-allowed command → throws CommandNotAllowedError.
8. `executeShell`: env vars forwarded per allowlist.
9. `executeShell`: log truncation at maxLogBytes.
10. `createAllowlist`: matching by basename and absolute path.
11. Public API: all exports present, no any types.
