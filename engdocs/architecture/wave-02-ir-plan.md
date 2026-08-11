# Wave 2 — IR Package Implementation Plan

**Architect:** architect-1
**Spec:** `specs/02-ir/spec.md`
**Epic:** sv-gbx (Wave 2: IR package)
**Design task:** sv-ka5
**Builder task:** sv-45z
**Reviewer task:** sv-wtn
**Package:** `@sverka/ir` → `packages/ir`

This plan is the contract the builder implements against. The spec is the
source of truth; this plan adds sequencing, file layout, conventions, and
edge-case guidance. Where the two disagree, the spec wins.

## 1. Scope

Implement the canonical Plan IR for `sverka.dev/v1`:

- Versioned schema types (`Plan`, `PlanOperation`, sub-types).
- Deterministic IDs: `computePlanId`, `computeOperationId` (SHA-256).
- Canonical (de)serialization: `serializePlan`, `deserializePlan`.
- Validation: `validatePlan` (15 rules, never throws) + `ValidationResult`.
- Error hierarchy: `IRError` → `ValidationError`, `SerializationError`.
- `PLAN_SCHEMA_VERSION` constant.
- Public re-exports from `src/index.ts`.

**Dependency:** `ir` depends on `core` types only (`OperationKind`). See
`engdocs/architecture/dependencies.md` rule 2. No other package imports.

## 2. Scaffolding status (already done by architect)

- `packages/ir/package.json` — fixed: dist paths are `.mjs`/`.d.mts`
  (matches `core` and tsdown ESM output), `@sverka/core: workspace:*`
  added to `dependencies`.
- `packages/ir/project.json`, `tsconfig.json`, `tsdown.config.ts` —
  already match `core`; no changes needed.
- `packages/ir/src/index.ts` — placeholder; builder fills exports.

The builder must run `bun install` once after pulling the new
`@sverka/core` dependency so the workspace link resolves.

## 3. File layout

Mirror `core`'s layout (one module per concern, `__tests__/` co-located,
internal helpers under `internal/`):

```text
packages/ir/src/
  index.ts              # public re-exports (matches spec §Interfaces)
  version.ts            # PLAN_SCHEMA_VERSION
  plan.ts               # Plan, PlanOperation, ExecutorSpec, ... types
  ids.ts                # computePlanId, computeOperationId
  serialize.ts          # serializePlan, deserializePlan, canonical JSON
  validate.ts           # validatePlan, ValidationResult, ValidationErrorDetail
  errors.ts             # IRError, ValidationError, SerializationError
  internal/
    canonical.ts        # stable stringify (shared by serialize + ids)
    graph.ts            # DAG cycle detection + dependency reachability
  __tests__/
    ids.test.ts
    validate.test.ts
    serialize.test.ts
    errors.test.ts
    version.test.ts
    public-api.test.ts
    helpers/
      fixtures.ts       # valid plan factory + invalid variants
```

`internal/` is NOT exported. `canonical.ts` is the single source of the
canonical JSON form — both `serializePlan` and `computePlanId` call it so
the hash and the wire format can never drift.

## 4. Implementation order (TDD: tests first, then impl)

The builder writes tests before each module. Suggested commit-sized slices:

### Slice A — Errors + version (foundation, no deps)
1. `errors.test.ts` — `IRError` base, `ValidationError`/`SerializationError`
   codes and `instanceof` chain. Mirror `core/src/errors.ts` exactly
   (constructor sets `name`, calls `super`).
2. `errors.ts` — implement.
3. `version.test.ts` — `PLAN_SCHEMA_VERSION === "sverka.dev/v1"`.
4. `version.ts` — implement.
5. Wire both into `index.ts`.

### Slice B — Plan types
6. `plan.ts` — type definitions only (no runtime). Copy interfaces verbatim
   from spec §Interfaces. `import type { OperationKind } from "@sverka/core"`.
   Note `verbatimModuleSyntax: true` → use `import type`.
7. Export all plan types from `index.ts`.
8. `public-api.test.ts` (skeleton) — assert every exported symbol is
   importable. Extend as slices land.

### Slice C — Canonical serialization (the primitive)
9. `internal/canonical.ts` — `canonicalStringify(value: unknown): string`.
   Stable key sort (lexicographic on UTF-16 code units), compact
   (no indentation), `undefined` omitted, arrays order-preserved.
   Implement with a recursive walker + `JSON.stringify`-free manual emit
   OR a replacer-based `JSON.stringify`; either is fine but must be
   byte-stable. **Test first:** two objects with keys in different insertion
   order produce identical output.
10. `serialize.test.ts` — round-trip, byte-identical output for identical
    plans, key-order independence.
11. `serialize.ts` — `serializePlan` calls `canonicalStringify`.
    `deserializePlan`: `JSON.parse` (throw `SerializationError` on
    `SyntaxError`), then `validatePlan`; on invalid throw `ValidationError`
    with the first error's code/message. Return a deep-frozen object.

### Slice D — IDs (depends on canonical + plan types)
12. `ids.test.ts` — determinism, prefix (`plan-`/`op-`), 64 hex chars,
    matrix distinctness, changing-one-op changes plan id.
13. `ids.ts` — `computePlanId`: strip `id`+`createdAt`, `canonicalStringify`,
    `crypto.createHash('sha256')`, hex, prefix `plan-`.
    `computeOperationId`: `canonicalStringify({ kind, name, context })`,
    sha256 hex, prefix `op-`. Use `node:crypto` (built-in, no dep).

### Slice E — Validation (depends on ids + plan types)
14. `internal/graph.ts` — `hasCycle(operations): string[] | undefined`
    returns the cycle path (ids) or undefined. DFS with WHITE/GRAY/BLACK
    coloring.
15. `validate.test.ts` — one positive + 15 negative cases (one per rule),
    each asserting `valid === false`, the right `code`, and `field`.
    Cycle test asserts the cycle path appears in `context`/`message`.
16. `validate.ts` — `validatePlan(plan: unknown): ValidationResult`.
    Narrow `unknown` with type guards (never `any`). Collect ALL errors,
    do not short-circuit (callers want the full list). Never throw.
    Rule 2 (id matches recomputed) calls `computePlanId` on the parsed
    shape minus `id`/`createdAt` — guard against missing fields first.

### Slice F — Public API + gates
17. Complete `index.ts` exports to match spec §Interfaces exactly.
18. `public-api.test.ts` — every symbol importable + exercised.
19. Run gates: `bun test packages/ir`, `bun run typecheck`, `bun run lint`,
    `bun run build`. All must be green.

## 5. Convention checklist (enforced by reviewer)

- **No `any`.** Use `unknown` + narrow. No `@ts-ignore`/`@ts-expect-error`.
- **`verbatimModuleSyntax: true`** → all type-only imports use `import type`.
- **`exactOptionalPropertyTypes: true`** → never assign `undefined` to an
  optional field; use conditional spread (see `core` test helper pattern:
  `...(x !== undefined ? { x } : {})`).
- **`noUncheckedIndexedAccess: true`** → array/object access returns
  `T | undefined`; narrow before use.
- **readonly everywhere** — all Plan fields are `readonly`; `deserializePlan`
  returns a `Object.freeze`-deep object.
- **Error `name`** — each error subclass sets `this.name` in the constructor
  (matches `core`).
- **ESM only** — `.js` specifiers in imports (TS `moduleResolution: bundler`
  resolves them). No `.cjs`/`.mjs` source.
- **Public surface** — everything in spec §Interfaces is exported from
  `src/index.ts`; nothing else is.

## 6. Edge cases the builder must handle

- **Validation rule 2** (id matches recomputed): the input is `unknown`.
  If `operations`/`apiVersion`/`name`/`sourceContextHash`/`metadata` are
  missing or wrong type, report rule-1/structure errors first; only
  recompute the id when the shape is otherwise valid. Do not let
  `computePlanId` throw — wrap in a try/catch and emit a validation error.
- **Cycle reporting:** include the offending id path in
  `ValidationErrorDetail.message` (e.g. `a -> b -> c -> a`).
- **`dependsOn` self-loop:** a node depending on itself is a cycle of
  length 1 — report under rule 5, not rule 4.
- **`imageDigest` format:** must match `/^sha256:[0-9a-f]{64}$/`. A digest
  on a `host`/`remote` executor is allowed but not required (rule 7 only
  applies to `docker`/`podman`).
- **`resources.cpu`/`memory` parseable:** non-empty string. `cpu` must
  match a number (e.g. `2`, `0.5`); `memory` must match
  `/^[0-9]+(Ki|Mi|Gi|Ti)?$/`. Report rule 9 on mismatch.
- **`retry.retryOn`** values must be within `("failure" | "timeout")`;
  unknown values report under rule 10.
- **Canonical JSON:** `NaN`/`Infinity` are not valid JSON. If a plan
  contains them, `serializePlan` throws `SerializationError` (defensive —
  the types forbid them, but `unknown` input to `deserializePlan` could
  carry them).
- **`deserializePlan` deep freeze:** freeze nested arrays/objects so the
  readonly contract is enforced at runtime.

## 7. Validation rule → error code map

The builder should use these stable `code` strings (reviewer checks them):

| Rule | code                       | field                          |
|------|----------------------------|--------------------------------|
| 1    | `INVALID_API_VERSION`      | `apiVersion`                   |
| 2    | `ID_MISMATCH`              | `id`                           |
| 3    | `EMPTY_OPERATIONS`         | `operations`                   |
| 4    | `UNKNOWN_DEPENDENCY`       | `operations[].dependsOn`       |
| 5    | `CYCLE_DETECTED`           | `operations[].dependsOn`       |
| 6    | `DUPLICATE_OPERATION_ID`   | `operations[].id`              |
| 7    | `MISSING_IMAGE_DIGEST`     | `operations[].executor.imageDigest` |
| 8    | `INVALID_TIMEOUT`          | `operations[].timeoutSeconds`  |
| 9    | `INVALID_RESOURCES`        | `operations[].resources`       |
| 10   | `INVALID_RETRY_POLICY`     | `operations[].retry`           |
| 11   | `INVALID_NETWORK_POLICY`   | `operations[].network`         |
| 12   | `MISSING_CACHE_KEY`        | `operations[].cache.key`       |
| 13   | `EMPTY_CREDENTIAL_ENVVAR`  | `operations[].credentials[].envVar` |
| 14   | `INVALID_METADATA`         | `metadata`                     |
| 15   | `INVALID_OPERATION`        | `operations[]`                 |

## 8. Gates (reviewer runs these)

```bash
bun install              # resolve new @sverka/core dep
bun test packages/ir     # all tests green
bun run typecheck        # strict, no any
bun run lint             # eslint clean
bun run build            # tsdown produces dist/index.mjs + .d.mts
```

Acceptance criteria are the 8 items on epic sv-gbx.

## 9. Out of scope for this wave

- Planner → IR conversion (Wave: planner).
- Runtime consumption of Plan (Wave: runtime).
- Compiler emission from Plan (Wave: compiler-*).
- Findings normalization (Wave: findings).

The IR package only defines, validates, (de)serializes, and identifies
plans. It does not construct plans from workflows.
