# Spec 01 — Core Package: Workflow Graph, Operations, Outputs

## Overview

The `core` package is the foundation of Sverka. It provides the composable
workflow DSL, the `Operation` and `OperationKind` types, the `Runtime`
interface, and the composables `pipeline()`, `run()`, `parallel()`, `when()`,
`matrix()`, and `workflow()`. Operations are lazy and composable: defining a
workflow never performs side effects. The same workflow definition can be
evaluated in three modes — Plan, Execution, and Compile — without changing the
source code.

The core package is intentionally backend-agnostic. It does not know about
Docker, GitHub Actions, or any specific executor. It produces a graph of
operations and a `Runtime` interprets that graph according to the active mode.

## Goals

1. Provide a TypeScript-first, type-safe composable workflow API.
2. Represent every check, build, test, and analysis step as a lazy
   `Operation`.
3. Support three evaluation modes against one workflow definition:
   - **Plan mode** — records operations into a graph without side effects.
   - **Execution mode** — executes operations through a `Runtime`.
   - **Compile mode** — emits a target artifact (e.g. GitHub Actions YAML)
     through a compiler.
4. Make operations composable via `pipeline()`, `run()`, `parallel()`,
   `when()`, `matrix()`, and `workflow()`.
5. Guarantee that planning never performs side effects (no shell, no network,
   no filesystem mutation).
6. Expose a stable `Runtime` interface that executors and compilers implement.
7. Carry explicit dependency edges so the graph is a DAG, not an opaque list.
8. Export the entire public surface from `src/index.ts`.

## Non-goals

- Implementing executors (handled by `runtime`, `runtime-docker`, etc.).
- Defining the canonical Plan IR schema (handled by the `ir` package).
- Performing project discovery (handled by the `planner` package).
- Normalizing findings (handled by the `findings` package).
- Providing a CLI (handled by the `cli` package).
- Supporting arbitrary deployment orchestration.

## Interfaces

```typescript
// src/index.ts — public exports

export { type Operation, type OperationKind, type OperationSpec,
  type CacheDeclaration, type ArtifactDeclaration, type NetworkPolicy,
  type CredentialDeclaration }
  from "./operation.js";
export { type Runtime, type RuntimeMode, type RuntimeResult,
  type OperationOutcome, type PlanContext, type Artifact }
  from "./runtime.js";
export { pipeline } from "./composables/pipeline.js";
export { run } from "./composables/run.js";
export { parallel } from "./composables/parallel.js";
export { when } from "./composables/when.js";
export { matrix } from "./composables/matrix.js";
export { workflow, type Workflow }
  from "./composables/workflow.js";
export { CoreError, PlanningError, CompositionError }
  from "./errors.js";
```

```typescript
// src/operation.ts

/**
 * The kind of work an Operation represents. Determines how executors and
 * compilers interpret the spec.
 */
export type OperationKind =
  | "run"        // execute a command in a container or host process
  | "check"      // run a verification tool and produce findings
  | "build"      // produce a build artifact
  | "analyze"    // static or dynamic analysis without a pass/fail verdict
  | "fetch"      // retrieve an external resource (cache, dependency)
  | "publish"    // emit an artifact or report
  | "custom";    // user-defined operation kind

/**
 * A fully-resolved, serializable description of a single unit of work.
 * Produced during Plan mode and consumed during Execution or Compile mode.
 */
export interface OperationSpec {
  readonly id: string;
  readonly kind: OperationKind;
  readonly name: string;
  readonly description?: string;
  readonly command?: string;
  readonly args?: readonly string[];
  readonly env?: Readonly<Record<string, string>>;
  readonly workingDir?: string;
  readonly image?: string;
  readonly imageDigest?: string;
  readonly dependsOn?: readonly string[];
  readonly condition?: string;
  readonly matrix?: Readonly<Record<string, readonly unknown[]>>;
  readonly cpuLimit?: string;
  readonly memoryLimit?: string;
  readonly timeoutSeconds?: number;
  readonly retries?: number;
  readonly continueOnError?: boolean;
  readonly cache?: CacheDeclaration;
  readonly artifacts?: readonly ArtifactDeclaration[];
  readonly network?: NetworkPolicy;
  readonly credentials?: readonly CredentialDeclaration[];
  readonly tags?: readonly string[];
}

export interface CacheDeclaration {
  readonly inputs: readonly string[];
  readonly outputs?: readonly string[];
  readonly key?: string;
}

export interface ArtifactDeclaration {
  readonly path: string;
  readonly name?: string;
  readonly retain?: boolean;
}

export type NetworkPolicy = "deny" | "allow-host" | "allow-egress";

export interface CredentialDeclaration {
  readonly name: string;
  readonly envVar: string;
  readonly required: boolean;
}

/**
 * An Operation is a lazy, composable node in the workflow graph. It carries
 * a partial spec that is merged as it is composed. It is never executed at
 * definition time.
 */
export interface Operation {
  readonly kind: OperationKind;
  readonly spec: Readonly<Partial<OperationSpec>>;
  /** Compose this operation into a sequence after the given predecessor. */
  readonly after: (...predecessors: Operation[]) => Operation;
  /** Compose this operation to run in parallel with siblings. */
  readonly with: (...siblings: Operation[]) => Operation;
  /** Attach a human-readable name. */
  readonly named: (name: string) => Operation;
  /** Attach tags for filtering and grouping. */
  readonly tagged: (...tags: string[]) => Operation;
  /** Internal stable id assigned during planning. */
  readonly _id?: string;
}
```

```typescript
// src/runtime.ts

/**
 * The mode in which a Runtime evaluates the workflow graph.
 */
export type RuntimeMode = "plan" | "execute" | "compile";

/**
 * The result of evaluating a workflow graph under a Runtime.
 */
export interface RuntimeResult {
  readonly mode: RuntimeMode;
  readonly operations: readonly OperationSpec[];
  readonly artifacts?: readonly Artifact[];
  readonly logs?: ReadonlyMap<string, string>;
  readonly errors?: readonly CoreError[];
  readonly durationMs: number;
}

/**
 * A named artifact produced during Execution or Compile mode.
 * In Compile mode, `content` holds the emitted artifact (e.g. YAML text).
 */
export interface Artifact {
  readonly name: string;
  readonly path?: string;
  readonly content?: string;
}

/**
 * The context made available to condition expressions during planning.
 * Keys are strings; values are primitives or arrays of primitives. The
 * planner populates this from project context (schedule, branch, env
 * flags, etc.). Condition expressions reference these keys by name.
 */
export interface PlanContext {
  readonly [key: string]: string | number | boolean | readonly string[];
}

/**
 * The Runtime interface is the contract between the core graph and the
 * backend that interprets it. Executors, compilers, and the planner each
 * provide a Runtime implementation.
 *
 * In Plan mode the runtime records operations without side effects.
 * In Execution mode it executes operations through an executor.
 * In Compile mode it emits a target artifact via a compiler.
 */
export interface Runtime {
  readonly mode: RuntimeMode;
  /** Context for condition evaluation during planning. */
  readonly context?: PlanContext;
  /** Record or execute a single resolved operation. */
  evaluate(operation: OperationSpec): Promise<OperationOutcome>;
  /** Finalize and return the aggregate result. */
  finalize(): Promise<RuntimeResult>;
}

export interface OperationOutcome {
  readonly operationId: string;
  readonly status: "planned" | "success" | "failure" | "skipped" | "cancelled";
  readonly exitCode?: number;
  readonly durationMs: number;
  readonly logs?: string;
  readonly artifacts?: readonly string[];
  readonly error?: CoreError;
}
```

```typescript
// src/composables/run.ts

/**
 * Define a single run operation. Lazy: no side effects at call time.
 *
 * @example
 * const lint = run({ command: "eslint", args: ["."], image: "node:24" });
 */
export function run(spec: Partial<OperationSpec>): Operation;
```

```typescript
// src/composables/pipeline.ts

/**
 * Compose operations into a sequential pipeline. Each operation depends on
 * the previous one, forming a linear chain in the DAG.
 *
 * @example
 * const p = pipeline(build, test, lint);
 */
export function pipeline(...operations: Operation[]): Operation;
```

```typescript
// src/composables/parallel.ts

/**
 * Compose operations to run concurrently. No dependency edges are added
 * between siblings; they share the same implicit join point.
 *
 * @example
 * const all = parallel(lint, test, typecheck);
 */
export function parallel(...operations: Operation[]): Operation;
```

```typescript
// src/composables/when.ts

/**
 * Conditionally include an operation. The condition is an expression string
 * evaluated at plan time against the plan context. When the condition is
 * false the operation is recorded but marked skipped.
 *
 * @example
 * const nightly = when("schedule == 'nightly'", fullScan);
 */
export function when(condition: string, operation: Operation): Operation;
```

```typescript
// src/composables/matrix.ts

/**
 * Expand an operation across a matrix of variable values. Each combination
 * becomes a separate node in the graph with a deterministic id suffix.
 *
 * @example
 * const multi = matrix({ node: ["20", "22", "24"] }, test);
 */
export function matrix(
  dimensions: Readonly<Record<string, readonly unknown[]>>,
  operation: Operation,
): Operation;
```

```typescript
// src/composables/workflow.ts

/**
 * Define a named workflow from a set of root operations. The workflow is the
 * top-level composable that the planner and CLI accept. Returns a frozen
 * workflow object that can be planned, executed, or compiled.
 *
 * @example
 * const wf = workflow("ci", parallel(build, lint), pipeline(test, report));
 */
export function workflow(
  name: string,
  ...roots: Operation[]
): Workflow;

export interface Workflow {
  readonly name: string;
  readonly roots: readonly Operation[];
  /** Evaluate this workflow under the given runtime. */
  readonly plan: (runtime: Runtime) => Promise<RuntimeResult>;
}
```

## Data models

```text
Workflow
 ├─ name: string
 └─ roots: Operation[]
      └─ Operation
           ├─ kind: OperationKind
           ├─ spec: Partial<OperationSpec>
           │    ├─ id, name, command, args, env, image, imageDigest
           │    ├─ dependsOn: string[]      (dependency edges)
           │    ├─ condition: string        (plan-time guard)
           │    ├─ matrix: Record<dim, values[]>
           │    ├─ cpuLimit, memoryLimit, timeoutSeconds, retries
           │    ├─ continueOnError: boolean
           │    ├─ cache: CacheDeclaration
           │    ├─ artifacts: ArtifactDeclaration[]
           │    ├─ network: NetworkPolicy
           │    ├─ credentials: CredentialDeclaration[]
           │    └─ tags: string[]
           ├─ after(...predecessors)  → adds dependsOn edges
           ├─ with(...siblings)       → parallel composition
           ├─ named(name)             → sets spec.name
           └─ tagged(...tags)         → sets spec.tags
```

The graph is a DAG. Cycles are detected during planning and rejected with a
`CompositionError`. Each `Operation` carries a partial spec; composition
merges specs with later values winning for scalar fields and arrays
concatenated for `dependsOn` and `tags`.

## Planning semantics

Planning is the process that walks a `Workflow`'s root operations, resolves
them into a concrete `OperationSpec[]`, and feeds each to `Runtime.evaluate`.
It runs identically in all three modes — the `Runtime` decides whether to
record, execute, or compile. Planning MUST NOT touch the filesystem, spawn
processes, or make network calls.

### Predecessor resolution

`after()` and `pipeline()` store **predecessor references** (Operation objects)
internally — not string ids — because ids are not assigned until planning.
The internal operation node carries:

```typescript
// src/internal/node.ts — NOT exported
interface OperationNode extends Operation {
  readonly predecessors: readonly OperationNode[];
  readonly siblings: readonly OperationNode[];
}
```

During planning, after ids are assigned, predecessor references are resolved
to `dependsOn: string[]` on the emitted `OperationSpec`. User-provided
`spec.dependsOn` strings (explicit ids) are merged with resolved predecessor
ids, deduplicated.

### ID assignment

Operation ids are **content-addressed** per [ADR-006](../../engdocs/adr/ADR-006-sha256-content-addressed-plan-ids.md).
The planner computes a deterministic SHA-256 hash over the canonical JSON
of `{ kind, name, context }`, hex-encodes it, and prefixes with `op-`:

```
op-<64 hex chars>
```

- **`kind`** — the `OperationKind`.
- **`name`** — `spec.name` if provided, else `spec.command` if provided,
  else a fallback string `operation` (the hash still distinguishes via
  `context`).
- **`context`** — a record of discriminating fields: matrix dimension
  values, `spec.id` (if user-provided), `spec.command`, `spec.args`, and
  a positional `index` within the discovery walk. This ensures two
  operations with the same kind and name but different commands or matrix
  values get distinct ids by construction.

**User-provided `spec.id`:** If present, it is included in the `context`
record (under the key `userId`), influencing the hash. It is **not** used
as the operation id directly — content-addressing is always enforced so
that ids remain reproducible by any consumer without contacting the
planner. This preserves cache stability and plan diffing.

**Canonical JSON:** Keys sorted lexicographically, compact (no
indentation), `undefined` omitted, array order preserved. This is the
same canonical form used by the `ir` package's `serializePlan` (see
[spec 02-ir](../02-ir/spec.md)). The `core` package implements this
independently in `internal/canonical.ts` (no dependency on `ir`; the
algorithm is simple and specified in ADR-006).

**Duplicate detection:** Because ids are content-addressed, two operations
with identical `{ kind, name, context }` produce the same id. This is
detected during planning and raises `CompositionError` with the duplicate
id in `context`. In practice this means the user has defined the same
operation twice — the fix is to differentiate via `name`, `command`, or
`spec.id`.

**Implementation:** `core` owns `computeOperationId` in
`internal/ids.ts` using Node's built-in `node:crypto` (`createHash('sha256')`).
No external dependency. The `ir` package's `computeOperationId` (spec
02-ir) implements the same algorithm for validation purposes; both
reference ADR-006 as the source of truth.

### Matrix expansion

`matrix({ dim: [v1, v2, ...] }, op)` produces the cartesian product of all
dimensions. Each combination becomes a separate `OperationNode` with:
- A content-addressed id per the rule above. The dimension values are
  included in the `context` record (e.g. `{ node: "24", os: "linux" }`),
  so each combination yields a distinct hash by construction — no
  suffix-based disambiguation needed.
- The dimension values injected into `spec.env` as `MATRIX_<DIM>=<value>`
  (uppercased) so executors and compilers can reference them.
- The same predecessor/sibling edges as the template operation.

Empty dimension arrays or non-array values raise `CompositionError`.

### Condition evaluation

`when(condition, op)` attaches a `condition` string to the operation. During
planning, the condition is evaluated against `Runtime.context` (a
`PlanContext`). The expression syntax is a deliberately minimal, safe subset
(no `eval`, no `Function` constructor):

```
expression := orExpr
orExpr     := andExpr ( '||' andExpr )*
andExpr    := notExpr ( '&&' notExpr )*
notExpr    := '!' notExpr | comparison
comparison := operand ( ( '==' | '!=' ) operand )?
operand    := identifier | stringLit | numberLit | 'true' | 'false'
identifier := [a-zA-Z_][a-zA-Z0-9_.]*   // looked up in PlanContext
stringLit  := "'" [^']* "'"
numberLit  := [0-9]+ ( '.' [0-9]+ )?
```

- An identifier not present in the context resolves to `undefined` (falsy).
- `==` is loose equality (string/number coercion); `!=` is its negation.
- A bare identifier (no comparison) is truthy if its value is truthy.
- If `Runtime.context` is omitted, all conditions evaluate to `true`
  (operations are included by default).

When a condition evaluates to `false`, the operation is still recorded in the
graph (so compilers can emit it with a `condition` field), but in Execution
mode its `OperationOutcome.status` is `"skipped"`.

## Error handling

All errors extend `CoreError` and are exported from `src/index.ts`.

```typescript
// src/errors.ts

export class CoreError extends Error {
  constructor(
    message: string,
    readonly code: string,
    readonly context?: Record<string, unknown>,
  ) {
    super(message);
    this.name = "CoreError";
  }
}

/** Raised when planning performs or attempts a side effect. */
export class PlanningError extends CoreError {
  constructor(message: string, context?: Record<string, unknown>) {
    super(message, "PLANNING_ERROR", context);
    this.name = "PlanningError";
  }
}

/** Raised when composition produces an invalid graph (cycle, duplicate id). */
export class CompositionError extends CoreError {
  constructor(message: string, context?: Record<string, unknown>) {
    super(message, "COMPOSITION_ERROR", context);
    this.name = "CompositionError";
  }
}
```

Rules:

1. **No side effects during planning.** If any composable or plan-time path
   touches the filesystem, network, or process layer, a `PlanningError` is
   thrown.
2. **Cycle detection.** If `after()` or `dependsOn` creates a cycle, a
   `CompositionError` is raised with the offending node ids in `context`.
3. **Duplicate ids.** If two operations resolve to the same deterministic id,
   a `CompositionError` is raised.
4. **Invalid matrix.** If `matrix()` receives an empty dimension or a
   non-array value, a `CompositionError` is raised.
5. **Unknown operation kind.** If an `OperationKind` outside the union is
   encountered, a `CoreError` with code `UNKNOWN_KIND` is raised.
6. Errors are never thrown across the `Runtime` boundary without being wrapped
   in a `CoreError` subclass.

## Test plan

Tests live in `packages/core/src/__tests__/` and run via `bun test`.

1. **Laziness**
   - Defining `run()`, `pipeline()`, `parallel()`, `when()`, `matrix()`, and
     `workflow()` must not touch the filesystem, spawn processes, or make
     network calls. Verified with spies on `child_process`, `fs`, and `fetch`.
   - `plan()` in Plan mode must produce operations without executing commands.

2. **Composition**
   - `pipeline(a, b, c)` produces `dependsOn` edges `b→a`, `c→b`.
   - `parallel(a, b)` produces no edges between `a` and `b`.
   - `when("schedule == 'nightly'", op)` with context `{ schedule: "nightly" }`
     includes the operation; with `{ schedule: "ci" }` marks it `skipped`.
   - `when("true", op)` with no context includes the operation.
   - `matrix({ node: ["20", "24"] }, op)` produces two nodes with distinct
     content-addressed ids (both prefixed `op-`) and `env.MATRIX_NODE` set
     to `"20"` and `"24"` respectively.
   - `matrix({ node: ["20", "24"], os: ["linux"] }, op)` produces two nodes
     with distinct ids (matrix values in the hash context ensure uniqueness).
   - `after()` and `with()` merge specs correctly (scalars overwrite, arrays
     concatenate for `dependsOn` and `tags`).

3. **DAG validation**
   - A cycle in `dependsOn` raises `CompositionError` with node ids in context.
   - Two operations with identical `{ kind, name, context }` (true duplicates)
     raise `CompositionError` with the duplicate `op-` id in context.
   - `matrix({ node: [] }, op)` raises `CompositionError`.
   - `matrix({ node: "not-array" }, op)` raises `CompositionError`.

4. **ID assignment (ADR-006)**
   - All operation ids are prefixed `op-` followed by 64 hex chars (SHA-256).
   - The same workflow definition produces the same ids across runs.
   - Different `command` or `args` produce different ids even with the same
     `kind` and `name`.
   - User-provided `spec.id` influences the hash (included as `userId` in
     context) but does not replace the `op-` prefix.
   - No external hashing library — uses `node:crypto.createHash('sha256')`.

5. **Condition evaluation**
   - `schedule == 'nightly'` evaluates true/false against context.
   - `a && b || !c` respects precedence (NOT > AND > OR).
   - Unknown identifiers resolve to falsy.
   - No `eval` or `Function` constructor used (verified by source inspection).

6. **Runtime modes**
   - A test `Runtime` in Plan mode records all operations and returns them in
     `RuntimeResult.operations`.
   - A test `Runtime` in Execution mode calls `evaluate` for each operation.
   - A test `Runtime` in Compile mode produces a string artifact.

7. **Type safety**
   - `bun run typecheck` passes with `strict: true` and no `any` types.
   - No `@ts-expect-error` or `@ts-ignore` in production source.

8. **Public API**
   - Every symbol listed in `src/index.ts` is importable and has at least one
     test exercising it.

9. **Commands**
   ```bash
   bun test packages/core
   bun run typecheck
   bun run lint
   ```
