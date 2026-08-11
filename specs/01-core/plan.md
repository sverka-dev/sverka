# Implementation Plan — Core Package (Wave 1)

> **Architect:** This plan translates `specs/01-core/spec.md` into a concrete
> file-by-file build order for the builder. Follow TDD: write the test file
> first, watch it fail, then implement until green.

## File map

```
packages/core/src/
├── index.ts                      # public re-exports
├── operation.ts                  # Operation, OperationKind, OperationSpec, declarations
├── runtime.ts                    # Runtime, RuntimeMode, RuntimeResult, OperationOutcome, PlanContext, Artifact
├── errors.ts                     # CoreError, PlanningError, CompositionError
├── composables/
│   ├── run.ts                    # run()
│   ├── pipeline.ts               # pipeline()
│   ├── parallel.ts               # parallel()
│   ├── when.ts                   # when()
│   ├── matrix.ts                 # matrix()
│   └── workflow.ts               # workflow(), Workflow
├── internal/
│   ├── node.ts                   # OperationNode (internal, not exported)
│   ├── merge.ts                  # spec merge logic
│   ├── canonical.ts              # canonical JSON serialization (ADR-006)
│   ├── ids.ts                    # SHA-256 content-addressed id generation (ADR-006)
│   ├── conditions.ts             # safe condition expression evaluator
│   └── plan.ts                   # graph walk, matrix expansion, cycle detection, topo sort
└── __tests__/
    ├── laziness.test.ts
    ├── composition.test.ts
    ├── dag.test.ts
    ├── conditions.test.ts
    ├── matrix.test.ts
    ├── runtime-modes.test.ts
    ├── public-api.test.ts
    └── composables/
        ├── run.test.ts
        ├── pipeline.test.ts
        ├── parallel.test.ts
        ├── when.test.ts
        └── workflow.test.ts
```

## Build order (TDD — test file first, then implementation)

### Step 1: Errors + Operation types (foundation)

**Files:** `errors.ts`, `operation.ts`

These have no dependencies on other modules. Implement first so everything
else can import them.

1. Write `errors.test.ts` (inline in `public-api.test.ts` is fine):
   - `CoreError` sets `name`, `code`, `context`.
   - `PlanningError` extends `CoreError`, code `PLANNING_ERROR`.
   - `CompositionError` extends `CoreError`, code `COMPOSITION_ERROR`.
   - `instanceof CoreError` works for subclasses.
2. Implement `errors.ts`.
3. Implement `operation.ts` — all types from spec: `OperationKind`,
   `OperationSpec`, `CacheDeclaration`, `ArtifactDeclaration`,
   `NetworkPolicy`, `CredentialDeclaration`, `Operation`.
   - `Operation` is an **interface**; the concrete implementation lives in
     `internal/node.ts` (Step 4). No implementation here, types only.

### Step 2: Runtime types

**Files:** `runtime.ts`

1. Implement all types from spec: `RuntimeMode`, `RuntimeResult`,
   `OperationOutcome`, `PlanContext`, `Artifact`, `Runtime`.
   - Types only, no implementation. `Runtime` is an interface implemented by
     consumers (and by test doubles).

### Step 3: Internal node + spec merge

**Files:** `internal/node.ts`, `internal/merge.ts`

1. Write `composition.test.ts` (covers merge behavior):
   - `mergeSpecs(a, b)`: scalar fields — `b` wins if defined; `dependsOn`
     and `tags` — arrays concatenated and deduplicated; nested objects
     (`cache`, `credentials`, `artifacts`) — `b` wins if defined (no deep
     merge for v1).
   - `OperationNode` created by `run()` carries empty `predecessors`/`siblings`.
   - `after(p)` returns a new node with `predecessors = [...this.predecessors, p]`.
   - `with(s)` returns a new node with `siblings = [...this.siblings, s]`.
   - `named(n)` returns a new node with `spec.name = n`.
   - `tagged(...t)` returns a new node with `spec.tags` concatenated.
2. Implement `internal/node.ts`:
   - `createNode(kind, spec): OperationNode` — factory.
   - Methods return **new** nodes (immutable). Use spread to copy.
   - `predecessors` and `siblings` are `OperationNode[]` (internal fields not
     on the public `Operation` interface — use a type assertion or a branded
     field).
3. Implement `internal/merge.ts`:
   - `mergeSpecs(a: Partial<OperationSpec>, b: Partial<OperationSpec>): Partial<OperationSpec>`
   - Export a helper `concatDedupe(arr: readonly string[]): string[]`.

### Step 4: Composables (run, pipeline, parallel, when, matrix)

**Files:** `composables/run.ts`, `pipeline.ts`, `parallel.ts`, `when.ts`, `matrix.ts`

1. Write per-composable test files in `__tests__/composables/`.
2. Implement each composable — all are thin wrappers over `createNode`:
   - `run(spec): Operation` → `createNode(spec.kind ?? "run", spec)`.
   - `pipeline(...ops): Operation` → chain: each op gets the previous as a
     predecessor. Returns the last node with the chain wired. Specifically,
     `pipeline(a, b, c)` produces nodes where `b.after(a)`, `c.after(b)`,
     and the returned node is `c` (the tail). The planner walks predecessors
     to discover the full chain.
   - `parallel(...ops): Operation` → returns a synthetic join node with all
     ops as siblings. No dependency edges between siblings. The join node
     has `kind: "custom"`, `name: "parallel-join"`, and `siblings = ops`.
     **Design note:** the join node is a planning artifact; in the emitted
     `OperationSpec[]` it does not appear as a separate operation — only the
     siblings appear, with no inter-sibling `dependsOn`. The join exists
     solely so `workflow()` can treat `parallel(...)` as a single root.
   - `when(cond, op): Operation` → returns a new node with `spec.condition = cond`.
   - `matrix(dims, op): Operation` → returns a new node with `spec.matrix = dims`
     and a flag marking it for expansion. Validation of dims (non-empty
     arrays) happens at planning time, not call time (laziness: `matrix()`
     itself must not throw for lazy correctness — validation deferred to
     planning). **Correction:** the spec says `matrix({ node: [] }, op)`
     raises `CompositionError`. This happens during planning, not at call
     time, to preserve laziness. The test should call `workflow(...).plan()`
     and expect the error there.

### Step 5: Condition evaluator + ID generation + canonical JSON

**Files:** `internal/conditions.ts`, `internal/ids.ts`, `internal/canonical.ts`

1. Write `conditions.test.ts`:
   - Tokenizer + recursive descent parser per the grammar in the spec.
   - `evaluate("schedule == 'nightly'", { schedule: "nightly" })` → `true`.
   - `evaluate("a && b || !c", { a: true, b: false, c: false })` → `true`.
   - `evaluate("missing", {})` → `false` (unknown identifier is falsy).
   - `evaluate("true", {})` → `true`.
   - `evaluate("1 == 1", {})` → `true` (number literal).
   - Malformed expression throws `CompositionError` with code
     `INVALID_CONDITION`.
2. Implement `internal/conditions.ts`:
   - `evaluateCondition(expr: string, context: PlanContext | undefined): boolean`
   - If `context` is `undefined`, return `true` (include by default).
   - **No `eval`, no `new Function`.** Hand-rolled tokenizer + parser.
3. Implement `internal/canonical.ts`:
   - `canonicalJson(value: unknown): string` — stable JSON serialization:
     keys sorted lexicographically, compact (no indentation), `undefined`
     omitted, array order preserved. This is the shared primitive for
     id computation (per ADR-006). The `ir` package implements the same
     algorithm independently for `serializePlan`.
4. Implement `internal/ids.ts` (per ADR-006):
   - `computeOperationId(kind, name, context): string` → `op-<64 hex>`.
     Uses `node:crypto.createHash('sha256')` over `canonicalJson({ kind, name, context })`.
   - `buildIdContext(node, index): Record<string, unknown>` — assembles the
     context record from `spec.id` (as `userId` if present), `spec.command`,
     `spec.args`, matrix dimension values, and `index`.
   - No external hashing library. No counter-based suffixes — uniqueness is
     by construction via the context record.
   - `resolveName(node): string` — `spec.name || spec.command || "operation"`.

### Step 6: Planner (graph walk, expansion, validation)

**Files:** `internal/plan.ts`

This is the core engine. It is called by `workflow().plan()`.

1. Write `dag.test.ts` and `matrix.test.ts`:
   - Cycle: `a.after(b)`, `b.after(a)` → `CompositionError` with ids in context.
   - True duplicate: two `run({ command: "eslint", name: "lint" })` with no
     other discriminating fields → same `op-` id → `CompositionError`.
   - Different commands, same name: `run({ name: "x", command: "a" })` and
     `run({ name: "x", command: "b" })` → distinct `op-` ids (command is in
     context).
   - Matrix expansion: `matrix({ node: ["20", "24"] }, op)` → 2 nodes, env
     injected, distinct content-addressed ids.
   - Matrix empty array → `CompositionError`.
   - Matrix non-array → `CompositionError`.
   - Topo sort respects `dependsOn` edges.
   - Id stability: same workflow planned twice produces identical ids.
2. Implement `internal/plan.ts`:
   - `planWorkflow(roots: OperationNode[], runtime: Runtime): Promise<RuntimeResult>`
   - Algorithm:
     1. **Discover** — DFS/BFS from roots, following `predecessors` and
        `siblings`. Collect all nodes. Detect structural issues (null refs).
     2. **Expand matrix** — for each node with `spec.matrix`, generate child
        nodes via cartesian product. Inject `MATRIX_<DIM>` env. Children
        inherit predecessors/siblings. Replace the template node with
        children in the node set. Validate dims here (empty/non-array →
        `CompositionError`).
     3. **Assign ids** — walk in discovery order. For each node, build the
        `context` record (`buildIdContext`), resolve the name
        (`resolveName`), and compute `computeOperationId(kind, name, context)`.
        Track `usedIds`; if a computed id collides (true duplicate — same
        `{ kind, name, context }`), raise `CompositionError` with the
        duplicate `op-` id in `context`.
     4. **Resolve edges** — for each node, resolve `predecessors` refs to
        their assigned ids, merge with user `spec.dependsOn`, deduplicate.
     5. **Cycle detection** — build adjacency list from `dependsOn`, run
        DFS with coloring (white/gray/black). Gray→gray edge = cycle →
        `CompositionError` with the cycle path in `context`.
     6. **Topo sort** — Kahn's algorithm or DFS post-order.
     7. **Evaluate conditions** — for each node in topo order, if
        `spec.condition` exists, evaluate against `runtime.context`. If
        false, mark as skipped (don't call `runtime.evaluate`, or call it
        and let the runtime decide — **decision: call `runtime.evaluate`
        for all nodes; the planner passes the condition result via
        `OperationSpec.condition` and the runtime decides**). Actually,
        simpler: the planner evaluates the condition and if false, sets
        `status: "skipped"` in the outcome without calling evaluate. But
        the spec says the operation is "still recorded in the graph." So:
        build the `OperationSpec` with `condition` set, call
        `runtime.evaluate(spec)` for all, and in Execution mode the
        runtime checks the condition. **Final decision:** the planner
        evaluates conditions and skips `runtime.evaluate` for false
        conditions, producing a synthetic `"skipped"` outcome. The
        `OperationSpec.condition` field is still populated so compilers
        can emit it. This keeps the runtime simple.
     8. **Evaluate** — for each non-skipped node in topo order, call
        `runtime.evaluate(spec)`. Collect `OperationOutcome`s.
     9. **Finalize** — call `runtime.finalize()`, merge with planner
        metadata (operations list, duration).

### Step 7: Workflow composable + public index

**Files:** `composables/workflow.ts`, `index.ts`

1. Write `__tests__/composables/workflow.test.ts` and `runtime-modes.test.ts`:
   - `workflow("ci", parallel(a, b), pipeline(c, d))` — roots are the
     parallel join node and the pipeline tail.
   - `wf.plan(planRuntime)` returns `RuntimeResult` with all operations.
   - Plan mode: no side effects (spies on fs/process/fetch).
   - Execution mode: `evaluate` called for each non-skipped op.
   - Compile mode: `finalize` returns an artifact with content.
2. Implement `composables/workflow.ts`:
   - `workflow(name, ...roots): Workflow`
   - `Workflow.plan(runtime)` → delegates to `internal/plan.ts`.
3. Implement `index.ts` — re-export everything per the spec's public export
   list. **Do not export anything from `internal/`.**

### Step 8: Laziness + public API tests

**Files:** `__tests__/laziness.test.ts`, `__tests__/public-api.test.ts`

1. `laziness.test.ts`:
   - Spy on `child_process.spawn`, `fs.writeFileSync`, `fs.readFile`,
     `globalThis.fetch`.
   - Call every composable + `workflow().plan(planRuntime)`.
   - Assert no spy was called.
2. `public-api.test.ts`:
   - Import every symbol from `@sverka/core` (via `src/index.ts`).
   - Assert each is defined (typeof check).
   - Assert `internal/` modules are NOT importable (attempt import and
     expect failure — or just verify they're not in the export list).

## Key design decisions (for the builder)

1. **Immutability:** All `Operation` methods return new nodes. Never mutate.
2. **Laziness:** Composables do zero I/O. Validation that can be deferred
   (matrix dims, cycle detection) happens in the planner, not at call time.
   The only exception is `CompositionError` for obviously invalid input at
   call time — but per the spec, even matrix validation is deferred to
   planning to preserve laziness. **Rule: composables never throw.**
3. **Internal modules:** `src/internal/*` is implementation detail. Not
   exported from `index.ts`. The builder should use `// @internal` JSDoc
   tags.
4. **No `any`:** Use `unknown` and narrow. `OperationSpec.matrix` values are
   `readonly unknown[]` — narrow to `string | number` during expansion.
5. **`exactOptionalPropertyTypes: true`** is on in tsconfig. Be careful:
   `optionalField?: T` means `T | undefined`, and you cannot assign
   `undefined` explicitly — only omit the key. Use conditional spread:
   `{ ...(x !== undefined && { field: x }) }`.
6. **`verbatimModuleSyntax: true`** is on. Use `export type { X }` for
   type-only re-exports, `export { X }` for values. The spec's `index.ts`
   already follows this pattern.
7. **`noUncheckedIndexedAccess: true`** is on. Array/record access returns
   `T | undefined`. Narrow before use.
8. **Content-addressed ids (ADR-006):** Operation ids are `op-<64 hex>`
   from SHA-256 of `canonicalJson({ kind, name, context })`. Use
   `node:crypto.createHash('sha256')` — no external library. The `ir`
   package implements the same algorithm independently for validation.
   User-provided `spec.id` goes into `context.userId`, not used directly.

## Verification gates (run after implementation)

```bash
cd packages/core
bun run vitest run          # all tests green
bun run tsc --noEmit        # typecheck, no any, no ts-ignore
bun run eslint src --ext .ts
bun run tsdown              # build produces dist/
```

From repo root:
```bash
bun test                    # nx run-many --target=test --all
bun run typecheck
bun run lint
bun run build
```

## Acceptance criteria mapping

| Spec criterion | Verified by |
|---|---|
| Public symbols importable with coverage | `public-api.test.ts` |
| Laziness (no fs/process/network) | `laziness.test.ts` |
| Composition (pipeline/parallel/when/matrix/after/with) | `composition.test.ts`, `composables/*.test.ts` |
| DAG validation (cycles, duplicate ids) | `dag.test.ts` |
| Three Runtime modes | `runtime-modes.test.ts` |
| bun test/typecheck/lint/build green | verification gates |
| No `any`, no `@ts-ignore` | typecheck + lint |
