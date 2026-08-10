# Spec 09 — SDK Package: Public TypeScript API

## Overview

The `sdk` package is the public TypeScript API surface for Sverka. It
re-exports the core composables and types from `@sverka/core`, and provides
the composition root that wires `core`, `planner`, `ir`, `runtime`,
`runtime-host`, `runtime-docker`, `findings`, and `policy` together.

The SDK is what users import. It is a thin facade for re-exports plus the
glue that converts a user workflow graph into an IR Plan and drives
execution. It does not re-implement logic that lives in other packages.

## Goals

1. Single import path (`@sverka/sdk`) for all user-facing API.
2. Re-export core composables: `pipeline`, `run`, `parallel`, `when`,
   `matrix`, `workflow`.
3. Re-export key types from `core`, `findings`, `policy`, `planner`, `ir`.
4. Define the workflow definition file format (`sverka.config.ts`).
5. Support two operating modes: **plan** (discover/synthesize, no
   execution) and **execute** (run checks locally, evaluate policy).
6. Provide ergonomic defaults so a project can start with zero config.
7. `defineWorkflow` helper for type-safe workflow definitions.
8. `task` helper for naming operations ergonomically.
9. Export all public types and functions from `src/index.ts`.

## Non-goals (v1)

- **Compile mode.** Compilers (`@sverka/compiler-github`,
  `@sverka/compiler-gitlab`) are built in waves 12–13. The SDK will gain
  `compile()` when they exist. Shipping an interface to nothing is a bad
  API.
- **Findings extraction from executor output.** Check providers
  (`@sverka/checks`, wave 11) define how commands produce findings. Until
  then, `execute()` returns `findings: []` — the pipeline is wired, findings
  populate when checks arrive.
- **Remote discovery.** Deferred in wave 6 (planner is local-only).
- **Output formatting** (`human`/`json`/`sarif`). That is the CLI's job
  (wave 10). The SDK returns structured data.
- Implementing workflow graph logic (lives in `@sverka/core`).
- Implementing discovery logic (lives in `@sverka/planner`).
- Non-TypeScript workflow definitions.

## Interfaces

```typescript
// ── Re-exports: core composables ──────────────────────────────────
export { pipeline, run, parallel, when, matrix, workflow } from "@sverka/core";

// ── Re-exports: core types ────────────────────────────────────────
export type {
  Operation,
  OperationKind,
  OperationSpec,
  Workflow,
  Runtime,
  RuntimeMode,
  RuntimeResult,
  OperationOutcome,
  PlanContext,
  Artifact,
  CacheDeclaration,
  ArtifactDeclaration,
  NetworkPolicy,
  CredentialDeclaration,
} from "@sverka/core";

export { CoreError, PlanningError, CompositionError } from "@sverka/core";

// ── Re-exports: IR types ──────────────────────────────────────────
export type { Plan, PlanOperation, PlanMetadata, ExecutorSpec } from "@sverka/ir";
export { validatePlan, computePlanId } from "@sverka/ir";

// ── Re-exports: runtime ───────────────────────────────────────────
export { Scheduler, type SchedulerConfig } from "@sverka/runtime";
export type {
  Executor,
  ExecuteRequest,
  ExecuteResult,
} from "@sverka/runtime";
export type {
  ExecutionResult as RuntimeExecutionResult,
  OperationOutcome as RuntimeOperationOutcome,
  ExecutionState,
} from "@sverka/runtime";

// ── Re-exports: planner ───────────────────────────────────────────
export { createPlanner } from "@sverka/planner";
export type {
  Planner,
  DiscoverOptions,
  ProjectContext,
  PlanProposal,
  ProposedCheck,
  DiscoveryExplanation,
} from "@sverka/planner";

// ── Re-exports: findings ──────────────────────────────────────────
export type { Finding, Severity, FindingSource } from "@sverka/findings";
export { normalizeSarif, computeFingerprint } from "@sverka/findings";
export { loadBaseline, saveBaseline, filterOnlyNew } from "@sverka/findings";

// ── Re-exports: policy ────────────────────────────────────────────
export type {
  Verdict,
  Policy,
  FailOnRule,
  PolicyResult,
  PolicyConfig,
} from "@sverka/policy";
export { DEFAULT_POLICY, createPolicy, evaluatePolicy } from "@sverka/policy";

// ── task helper ───────────────────────────────────────────────────
/**
 * Name an operation. Sugar for `op.named(name)`.
 * @example
 * pipeline(task("lint", run({ command: "bun", args: ["run", "lint"] })))
 */
export function task(name: string, op: Operation): Operation;

// ── Workflow definition ───────────────────────────────────────────
/**
 * Type-safe helper for sverka.config.ts. Identity function.
 */
export function defineWorkflow(definition: WorkflowDefinition): WorkflowDefinition;

export interface WorkflowDefinition {
  /** Workflow name. */
  name: string;
  /** The workflow graph. */
  workflow: Workflow;
  /** Optional policy configuration. Defaults to DEFAULT_POLICY. */
  policy?: PolicyConfig;
}

// ── Config discovery and loading ──────────────────────────────────
/**
 * Search upward from `root` for sverka.config.ts (then .js). Returns the
 * path or null. Searches up to 5 parent directories.
 */
export function findConfig(root: string): Promise<string | null>;

/**
 * Dynamically import a sverka.config.ts file and return its default
 * export as a WorkflowDefinition. Validates the shape.
 *
 * Under Bun, .ts files import natively. Under Node, use the .js fallback
 * (findConfig searches .ts first, then .js).
 */
export function loadWorkflow(configPath: string): Promise<WorkflowDefinition>;

// ── Sverka instance ───────────────────────────────────────────────
export interface Sverka {
  plan(options?: SverkaOptions): Promise<PlanResult>;
  execute(options?: SverkaOptions): Promise<ExecutionResult>;
}

export interface SverkaOptions {
  /** Root directory. Defaults to process.cwd(). */
  root?: string;
  /** Path to sverka.config.ts. Defaults to findConfig(root). */
  configPath?: string;
  /** Executor backend. Defaults to "host". */
  executor?: "host" | "docker";
  /** Path to baseline file for only-new filtering. */
  baselinePath?: string;
  /** Only report findings not in the baseline. Default false. */
  onlyNew?: boolean;
  /** Git base ref for changed-file discovery (e.g. "main", "HEAD~1"). */
  baseRef?: string;
}

export function createSverka(options?: SverkaOptions): Sverka;

// ── Top-level convenience functions ───────────────────────────────
export function plan(options?: SverkaOptions): Promise<PlanResult>;
export function execute(options?: SverkaOptions): Promise<ExecutionResult>;

// ── Results ───────────────────────────────────────────────────────
export interface PlanResult {
  /** Discovered project context. */
  context: ProjectContext;
  /** Resolved operations from the workflow graph (empty if auto-discovery). */
  operations: readonly OperationSpec[];
  /** Planner proposal (null if a user config was loaded). */
  proposal: PlanProposal | null;
}

export interface ExecutionResult {
  /** Findings (empty until check providers exist — wave 11). */
  findings: readonly Finding[];
  /** Policy evaluation result. */
  policyResult: PolicyResult;
  /** Final verdict. */
  verdict: Verdict;
  /** Scheduler execution status. */
  status: "success" | "failure" | "partial";
  /** Per-operation outcomes (runtime's OperationOutcome with fromCache). */
  outcomes: ReadonlyMap<string, RuntimeOperationOutcome>;
  /** Total execution time in ms. */
  durationMs: number;
}

// ── Errors ────────────────────────────────────────────────────────
export class SdkError extends Error {
  readonly code: SdkErrorCode;
  override readonly cause: unknown;
  constructor(message: string, code: SdkErrorCode, cause?: unknown) {
    super(message);
    this.name = "SdkError";
    this.code = code;
    this.cause = cause;
  }
}

export type SdkErrorCode =
  | "CONFIG_NOT_FOUND"
  | "CONFIG_INVALID"
  | "CONFIG_LOAD_FAILED"
  | "EXECUTION_FAILED";
```

## Data models

### Workflow definition file format

A `sverka.config.ts` file:

1. Has a **default export** of type `WorkflowDefinition`.
2. Uses `defineWorkflow` for type safety and autocomplete.
3. Is loaded via `loadWorkflow(configPath)` — dynamic `import()`.

```typescript
import { defineWorkflow, pipeline, task, run } from "@sverka/sdk";

export default defineWorkflow({
  name: "verify",
  workflow: pipeline(
    task("lint", run({ command: "bun", args: ["run", "lint"] })),
    task("typecheck", run({ command: "bun", args: ["run", "typecheck"] })),
    task("test", run({ command: "bun", args: ["run", "test"] })),
  ),
  policy: {
    failOn: [{ severity: "high", onlyNew: false }],
  },
});
```

### Config discovery (`findConfig`)

1. `sverka.config.ts` in `root`.
2. `sverka.config.ts` in parent directories (up to 5 levels).
3. `sverka.config.js` as fallback (same search order).

If no config is found, Sverka operates in **auto-discovery mode**: the
planner discovers project context and synthesizes a `PlanProposal` with
built-in checks based on detected languages and package managers.

### Operating modes

#### Plan mode

1. Discover `ProjectContext` via `@sverka/planner`.
2. If a config is found: load it, evaluate the `Workflow` graph through a
   plan-mode `Runtime` (records operations, no side effects) →
   `OperationSpec[]`.
3. If no config: call `planner.plan(context)` → `PlanProposal`.
4. Return `PlanResult` with context, operations (from config) or proposal
   (from auto-discovery).
5. **No checks are executed. No side effects.**

#### Execute mode

1. Discover `ProjectContext` via `@sverka/planner`.
2. Load the workflow config if present; otherwise auto-discover.
3. Evaluate the `Workflow` graph → `OperationSpec[]` (plan-mode runtime).
4. Convert `OperationSpec[]` → IR `Plan` (fill defaults: executor type
   from `options.executor`, resources, retry, timeout, network).
5. `validatePlan(plan)`.
6. Construct `Scheduler` with the selected executor (`HostExecutor` or
   `DockerExecutor`) and run `scheduler.execute(plan)`.
7. Collect findings (empty array — check providers arrive in wave 11).
8. If `baselinePath` and `onlyNew`: load baseline, filter findings.
9. Evaluate findings against policy via `evaluatePolicy`.
10. Return `ExecutionResult`.

### OperationSpec → PlanOperation conversion

The SDK maps each `OperationSpec` to a `PlanOperation` with defaults:

| PlanOperation field | Source |
|---|---|
| `id` | `spec.id` |
| `kind`, `name`, `description`, `command`, `args`, `env`, `workingDir` | direct copy |
| `dependsOn` | `spec.dependsOn ?? []` |
| `executor` | `{ type: options.executor ?? "host", image: spec.image, imageDigest: spec.imageDigest }` |
| `resources` | `{ cpu: spec.cpuLimit ?? "1", memory: spec.memoryLimit ?? "512Mi" }` |
| `network` | `spec.network ?? "deny"` |
| `credentials` | `spec.credentials ?? []` |
| `cache` | `spec.cache` (if present, fill defaults for optional fields) |
| `artifacts` | `spec.artifacts ?? []` (fill `retain: false` default) |
| `retry` | `{ maxAttempts: spec.retries ?? 1, backoffSeconds: 0, retryOn: ["failure", "timeout"] }` |
| `timeoutSeconds` | `spec.timeoutSeconds ?? 300` |
| `condition` | `spec.condition` |
| `continueOnError` | `spec.continueOnError ?? false` |

Plan-level fields:
- `apiVersion`: `"sverka.dev/v1"`
- `id`: `computePlanId(plan without id/createdAt)`
- `name`: from `WorkflowDefinition.name` or `"sverka-plan"`
- `sourceContextHash`: SHA-256 of `context.commit + context.dirty + changedFilePaths` (empty string if no context)
- `metadata`: `{ sverkaVersion: "0.1.0", generatedBy: config ? "manual" : "planner" }`
- `createdAt`: `new Date().toISOString()`

### `createSverka` vs top-level functions

- `createSverka(options)` returns a `Sverka` with default options
  pre-applied. Per-call options override defaults.
- Top-level `plan()` / `execute()` create a default `Sverka` per call.

## Error handling

- **`SdkError`** with `cause: unknown`:
  - `CONFIG_NOT_FOUND` — no config found and auto-discovery produced no
    proposal (no recognized languages/package managers). Only thrown when
    both config is absent AND discovery yields nothing.
  - `CONFIG_INVALID` — default export does not conform to
    `WorkflowDefinition`.
  - `CONFIG_LOAD_FAILED` — config file could not be imported (syntax
    error, missing dependency). Original error in `cause`.
  - `EXECUTION_FAILED` — runtime error during execution. Original error
    in `cause`.
- Auto-discovery mode never throws `CONFIG_NOT_FOUND` if the planner
  produces a proposal (even an empty one with notes).
- No `any` types. `cause` is `unknown`.

## Test plan

Tests in `packages/sdk/src/__tests__/`, run via `bun run test` (vitest).

1. **Re-exports:** all composables, types, and functions are exported and
   callable. Importing `@sverka/sdk` gives access to `pipeline`, `run`,
   `parallel`, `when`, `matrix`, `workflow`, `task`, `defineWorkflow`,
   `createSverka`, `plan`, `execute`, `findConfig`, `loadWorkflow`.
2. **`task`:** returns an `Operation` with the given name. Equivalent to
   `op.named(name)`.
3. **`defineWorkflow`:** returns the same object. Missing required fields
   is a type error (compile-time).
4. **`findConfig`:** finds `sverka.config.ts` in root. Finds in parent
   directory. Falls back to `.js`. Returns `null` after 5 levels.
5. **`loadWorkflow`:** loads a valid config → `WorkflowDefinition`. Throws
   `CONFIG_INVALID` for malformed default export. Throws
   `CONFIG_LOAD_FAILED` for syntax error (cause preserved). Throws
   `CONFIG_NOT_FOUND` for non-existent file.
6. **`plan` mode (auto-discovery):** returns `PlanResult` with context and
   proposal. No side effects. Works with zero config.
7. **`plan` mode (with config):** returns `PlanResult` with operations
   from the workflow graph. Proposal is null.
8. **`execute` mode:** returns `ExecutionResult` with status, outcomes,
   findings (empty), policyResult, verdict. Runs operations via
   HostExecutor. Verdict is "pass" when status is "success", "fail"
   otherwise (with empty findings, policy evaluates to its default).
9. **`execute` with baseline:** loads baseline, applies `filterOnlyNew`
   when `onlyNew` is true.
10. **`createSverka`:** default options applied to subsequent calls.
    Per-call options override.
11. **Error cases:** `CONFIG_INVALID`, `CONFIG_LOAD_FAILED` (cause
    preserved), `EXECUTION_FAILED` (wraps runtime errors).
12. **OperationSpec → Plan conversion:** produces a valid `Plan` that
    passes `validatePlan`. Defaults are filled correctly. `computePlanId`
    is deterministic.
