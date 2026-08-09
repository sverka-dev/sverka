# Spec 02 — Canonical Plan IR

## Overview

The `ir` package defines the canonical Plan intermediate representation: the
stable, serializable contract between the planner, the runtime, and the
compilers. A Plan is a fully-resolved, validated DAG of operations with all
ambiguity removed. It is the single source of truth that executors execute and
that compilers translate to target formats.

The schema is versioned (`sverka.dev/v1`) and designed for forward
compatibility. Every Plan carries deterministic IDs, an explicit dependency
graph, executor and image digest pinning, resource limits, network policy,
credential declarations, cache inputs/outputs, artifact declarations,
retry/timeout policy, a source context hash, and compiler metadata.

## Goals

1. Define a stable, versioned, serializable Plan schema (`sverka.dev/v1`).
2. Assign deterministic IDs so the same workflow + context always produces the
   same plan.
3. Carry an explicit dependency graph (DAG) with no implicit ordering.
4. Pin executor and image digest for reproducible execution.
5. Declare resource limits (CPU, memory), network policy, and credentials
   explicitly per operation.
6. Declare cache inputs and outputs for incremental execution.
7. Declare artifact outputs for collection and publishing.
8. Carry retry and timeout policy per operation.
9. Carry a source context hash so plan identity is tied to source state.
10. Carry compiler metadata so compilers can attach target-specific annotations
    without mutating the core schema.
11. Provide Plan validation and (de)serialization.

## Non-goals

- Defining the workflow DSL (handled by `core`).
- Performing project discovery (handled by `planner`).
- Executing operations (handled by `runtime`).
- Compiling to target formats (handled by `compiler-*`).
- Defining findings normalization (handled by `findings`).
- Supporting multiple simultaneous schema versions in v1 (one version: `v1`).

## Interfaces

```typescript
// src/index.ts — public exports

export { type Plan, type PlanOperation, type PlanMetadata }
  from "./plan.js";
export { type PlanValidator, validatePlan, ValidationResult }
  from "./validate.js";
export { serializePlan, deserializePlan }
  from "./serialize.js";
export { computePlanId, computeOperationId }
  from "./ids.js";
export { IRError, ValidationError, SerializationError }
  from "./errors.js";
export { PLAN_SCHEMA_VERSION }
  from "./version.js";
```

```typescript
// src/version.ts

export const PLAN_SCHEMA_VERSION = "sverka.dev/v1";
```

```typescript
// src/plan.ts

import type { OperationKind } from "@sverka/core";

/**
 * The canonical Plan. A validated, serializable DAG.
 */
export interface Plan {
  readonly apiVersion: "sverka.dev/v1";
  readonly id: string;                 // deterministic plan id
  readonly name: string;
  readonly sourceContextHash: string;  // hash of source files + config
  readonly operations: readonly PlanOperation[];
  readonly metadata: PlanMetadata;
  readonly createdAt: string;          // ISO 8601, informational only
}

export interface PlanOperation {
  readonly id: string;                 // deterministic, stable across runs
  readonly kind: OperationKind;
  readonly name: string;
  readonly description?: string;
  readonly command?: string;
  readonly args?: readonly string[];
  readonly env?: Readonly<Record<string, string>>;
  readonly workingDir?: string;

  // Dependency graph
  readonly dependsOn: readonly string[];   // ids of prerequisite operations

  // Execution target
  readonly executor: ExecutorSpec;

  // Resource limits
  readonly resources: ResourceLimits;

  // Network policy
  readonly network: NetworkPolicy;

  // Credentials
  readonly credentials: readonly CredentialDeclaration[];

  // Cache
  readonly cache?: CacheDeclaration;

  // Artifacts
  readonly artifacts: readonly ArtifactDeclaration[];

  // Reliability
  readonly retry: RetryPolicy;
  readonly timeoutSeconds: number;     // mandatory, must be > 0

  // Control flow
  readonly condition?: string;
  readonly continueOnError: boolean;

  // Compiler metadata (target-specific, ignored by runtime)
  readonly compiler?: Readonly<Record<string, unknown>>;
}

export interface ExecutorSpec {
  readonly type: "docker" | "podman" | "host" | "remote";
  readonly image?: string;
  readonly imageDigest?: string;       // sha256 digest, required for container types
  readonly remote?: RemoteExecutorRef;
}

export interface RemoteExecutorRef {
  readonly provider: "github" | "gitlab" | "sonarcloud" | "custom";
  readonly endpoint: string;
}

export interface ResourceLimits {
  readonly cpu: string;                // e.g. "2", "0.5"
  readonly memory: string;             // e.g. "512Mi", "2Gi"
}

export type NetworkPolicy = "deny" | "allow-host" | "allow-egress";

export interface CredentialDeclaration {
  readonly name: string;
  readonly envVar: string;
  readonly required: boolean;
}

export interface CacheDeclaration {
  readonly inputs: readonly string[];
  readonly outputs: readonly string[];
  readonly key: string;                // deterministic cache key
}

export interface ArtifactDeclaration {
  readonly path: string;
  readonly name?: string;
  readonly retain: boolean;
}

export interface RetryPolicy {
  readonly maxAttempts: number;        // >= 1
  readonly backoffSeconds: number;     // >= 0
  readonly retryOn: readonly ("failure" | "timeout")[];
}

export interface PlanMetadata {
  readonly sverkaVersion: string;
  readonly generatedBy: "planner" | "manual" | "compiler";
  readonly compilerAnnotations?: Readonly<Record<string, unknown>>;
  readonly labels?: Readonly<Record<string, string>>;
}
```

```typescript
// src/ids.ts

/**
 * Compute a deterministic plan id from the plan content (excluding
 * `id` and `createdAt`). The same workflow + source context must always
 * yield the same id.
 *
 * Algorithm: SHA-256 over the canonical serialization (see `serializePlan`)
 * of the plan with `id` and `createdAt` stripped, hex-encoded, prefixed
 * with `plan-`. Uses Node's `crypto.createHash('sha256')` (no external
 * dependency). The hash input is byte-stable because canonical JSON sorts
 * keys and emits no trailing whitespace.
 */
export function computePlanId(
  plan: Omit<Plan, "id" | "createdAt">,
): string;

/**
 * Compute a deterministic operation id from kind, name, and a context
 * record (matrix values, position, or other discriminating fields).
 *
 * Algorithm: SHA-256 over the canonical JSON of `{ kind, name, context }`
 * (keys sorted, UTF-8), hex-encoded, prefixed with `op-`. Matrix expansion
 * produces distinct ids because each combination yields a distinct
 * `context` record.
 */
export function computeOperationId(
  kind: OperationKind,
  name: string,
  context: Readonly<Record<string, unknown>>,
): string;
```

```typescript
// src/validate.ts

export interface ValidationResult {
  readonly valid: boolean;
  readonly errors: readonly ValidationErrorDetail[];
}

export interface ValidationErrorDetail {
  readonly operationId?: string;
  readonly field: string;
  readonly message: string;
  readonly code: string;
}

export interface PlanValidator {
  validate(plan: unknown): ValidationResult;
}

/**
 * Validate an unknown value as a Plan. Returns a ValidationResult; does not
 * throw on invalid input.
 */
export function validatePlan(plan: unknown): ValidationResult;
```

```typescript
// src/serialize.ts

/**
 * Serialize a Plan to a canonical JSON string.
 *
 * Canonical form: UTF-8, `JSON.stringify` with a stable replacer that sorts
 * object keys lexicographically (byte-wise on UTF-16 code units), no
 * trailing whitespace, no comments, 2-space indentation disabled (compact).
 * Array element order is preserved (operations and dependsOn are
 * semantically ordered). `undefined` fields are omitted (never serialized).
 * This is the single canonical primitive: `computePlanId` hashes the output
 * of this function, so two identical plans produce byte-identical JSON and
 * thus the same id.
 */
export function serializePlan(plan: Plan): string;

/**
 * Deserialize and validate a JSON string into a Plan. Throws
 * SerializationError on parse failure or ValidationError on schema
 * violation. The returned Plan is a deep-frozen, readonly view.
 */
export function deserializePlan(json: string): Plan;
```

## Data models

```
Plan
 ├─ apiVersion: "sverka.dev/v1"
 ├─ id: string                    (deterministic, content-addressed)
 ├─ name: string
 ├─ sourceContextHash: string     (hash of source + config inputs)
 ├─ createdAt: string             (ISO 8601, informational)
 ├─ metadata: PlanMetadata
 │    ├─ sverkaVersion
 │    ├─ generatedBy
 │    ├─ compilerAnnotations?
 │    └─ labels?
 └─ operations: PlanOperation[]
      ├─ id                       (deterministic)
      ├─ kind, name, command, args, env, workingDir
      ├─ dependsOn: string[]      (explicit DAG edges)
      ├─ executor: ExecutorSpec
      │    ├─ type: docker|podman|host|remote
      │    ├─ image, imageDigest  (digest required for container types)
      │    └─ remote?             (for remote executors)
      ├─ resources: { cpu, memory }
      ├─ network: deny|allow-host|allow-egress
      ├─ credentials: CredentialDeclaration[]
      ├─ cache?: { inputs, outputs, key }
      ├─ artifacts: ArtifactDeclaration[]
      ├─ retry: { maxAttempts, backoffSeconds, retryOn[] }
      ├─ timeoutSeconds           (mandatory, > 0)
      ├─ condition?, continueOnError
      └─ compiler?: Record<string, unknown>
```

Serialization is canonical JSON: UTF-8, no trailing whitespace, keys sorted
lexicographically, no comments. This guarantees that two identical plans
produce byte-identical serialized output and thus the same content hash.

## Error handling

All errors extend `IRError`.

```typescript
// src/errors.ts

export class IRError extends Error {
  constructor(
    message: string,
    readonly code: string,
    readonly context?: Record<string, unknown>,
  ) {
    super(message);
    this.name = "IRError";
  }
}

export class ValidationError extends IRError {
  constructor(message: string, context?: Record<string, unknown>) {
    super(message, "VALIDATION_ERROR", context);
    this.name = "ValidationError";
  }
}

export class SerializationError extends IRError {
  constructor(message: string, context?: Record<string, unknown>) {
    super(message, "SERIALIZATION_ERROR", context);
    this.name = "SerializationError";
  }
}
```

Validation rules (each violation produces a `ValidationErrorDetail`):

1. `apiVersion` must equal `sverka.dev/v1`.
2. `id` must be non-empty and match the recomputed `computePlanId`.
3. `operations` must be non-empty.
4. Every `dependsOn` id must reference an existing operation id.
5. The dependency graph must be acyclic.
6. Operation ids must be unique within the plan.
7. For `executor.type` of `docker` or `podman`, `imageDigest` must be present
   and match the `sha256:` format.
8. `timeoutSeconds` must be present and greater than 0.
9. `resources.cpu` and `resources.memory` must be non-empty and parseable.
10. `retry.maxAttempts` must be >= 1; `backoffSeconds` >= 0.
11. `network` must be one of the allowed values.
12. `cache.key` must be present when `cache` is declared.
13. `credentials[].envVar` must be non-empty.

`validatePlan` returns a `ValidationResult` and never throws. `deserializePlan`
throws `SerializationError` on JSON parse failure and `ValidationError` when
the parsed object fails validation.

## Test plan

Tests live in `packages/ir/src/__tests__/` and run via `bun test`.

1. **Deterministic IDs**
   - The same workflow + source context produces the same `computePlanId`.
   - Changing one operation changes the plan id.
   - `computeOperationId` is stable across runs for identical inputs.
   - Matrix expansion produces distinct, deterministic operation ids.
   - `computePlanId` output is prefixed `plan-` and is 64 hex chars after
     the prefix (SHA-256). `computeOperationId` is prefixed `op-`.

2. **Validation**
   - A valid plan returns `{ valid: true, errors: [] }`.
   - Each validation rule (1–13 above) has a negative test producing the
     correct `code` and `field`.
   - `dependsOn` referencing a non-existent id is reported.
   - A cycle in `dependsOn` is reported with the cycle path in context.
   - Missing `imageDigest` for a docker executor is reported.
   - `timeoutSeconds` <= 0 is reported.

3. **Serialization**
   - `serializePlan` then `deserializePlan` round-trips a plan losslessly.
   - Serialized output is canonical: two identical plans produce byte-identical
     JSON.
   - `deserializePlan` throws `SerializationError` on malformed JSON.
   - `deserializePlan` throws `ValidationError` on a structurally valid but
     schema-invalid object.

4. **Schema version**
   - A plan with `apiVersion` other than `sverka.dev/v1` fails validation.
   - `PLAN_SCHEMA_VERSION` equals `"sverka.dev/v1"`.

5. **Type safety**
   - `bun run typecheck` passes with `strict: true` and no `any` types.
   - `validatePlan` accepts `unknown` and narrows without `any`.

6. **Commands**
   ```bash
   bun test packages/ir
   bun run typecheck
   bun run lint
   ```
