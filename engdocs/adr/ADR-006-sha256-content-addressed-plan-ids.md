# ADR-006: SHA-256 content-addressed Plan and Operation IDs

## Context

Operation IDs in the `core` package must be deterministic across separate
planning runs so that:

1. **Cache stability** — cached outputs keyed by operation ID remain valid
   when the workflow graph is unchanged, even if discovery or traversal
   order differs.
2. **Plan diffing** — two plans produced from the same workflow can be
   compared by ID to detect what changed, enabling incremental
   re-planning and output reuse.
3. **IR serialization** — the `ir` package's `serializePlan` needs a
   stable, reproducible ID that any consumer can recompute without
   contacting the planner.

A counter-based or discovery-order-based ID scheme breaks all three
properties: adding an unrelated root renumbers subsequent operations,
and the same workflow composed in a different order yields different IDs.

## Decision

Operation IDs are **content-addressed** using SHA-256:

```
op-<64 hex chars>
```

The hash is computed over the canonical JSON of `{ kind, name, context }`:

- **`kind`** — the `OperationKind` (`"run"`, `"check"`, `"build"`, etc.).
- **`name`** — `spec.name` if provided, else `spec.command` if provided,
  else the fallback string `"operation"`. The hash still distinguishes
  via `context`.
- **`context`** — a record of discriminating fields:
  - `userId` — `spec.id` if user-provided (influences the hash but is
    not used as the ID directly).
  - `command` — `spec.command` if provided.
  - `args` — `spec.args` if provided.
  - `matrix` — matrix dimension values (e.g. `{ node: "24", os: "linux" }`).
  - `index` — positional index within the discovery walk (ensures two
    structurally identical unnamed operations get distinct IDs).

### Canonical JSON

Keys are sorted lexicographically, output is compact (no indentation),
`undefined` values are omitted, and array order is preserved. This is
the same canonical form used by the `ir` package's `serializePlan`.

The `core` package implements this independently in
`internal/canonical.ts` (no dependency on `ir`; the algorithm is simple
and specified here).

### Duplicate detection

Because IDs are content-addressed, two operations with identical
`{ kind, name, context }` produce the same ID. This is detected during
planning and raises `CompositionError` with the duplicate ID in
`context`. In practice this means the user has defined the same
operation twice — the fix is to differentiate via `name`, `command`, or
`spec.id`.

### Implementation

`core` owns `computeOperationId` in `internal/ids.ts` using Node's
built-in `node:crypto` (`createHash('sha256')`). No external dependency.
The `ir` package's `computeOperationId` (spec 02-ir) implements the same
algorithm for validation purposes; both reference this ADR as the source
of truth.

## Consequences

- IDs are reproducible by any consumer without contacting the planner.
- Adding an unrelated root does not change existing operation IDs.
- Matrix children get distinct IDs by construction (matrix values are
  in `context`); no suffix-based disambiguation is needed.
- User-provided `spec.id` influences the hash but does not override it,
  preserving content-addressing guarantees.
- The ID format is opaque (`op-<hex>`) — not human-readable. Debugging
  relies on `spec.name` and `spec.command` for identification.
- The `ir` package must implement the same algorithm, creating a shared
  contract that must stay in sync.

## Alternatives

- **Readable IDs (`${kind}:${name}`):** Simpler and human-friendly, but
  breaks cache stability and plan diffing when discovery order changes.
  Collisions require suffix-based disambiguation (`-2`, `-3`), which is
  order-dependent. Rejected for production use; retained as the current
  wave-1 implementation for debuggability, with content-addressed IDs
  planned for a future wave.
- **UUID v4:** Random IDs are unique but not reproducible — fails cache
  stability and plan diffing entirely. Rejected.
- **Counter-based IDs:** Simple, but non-deterministic across runs.
  Rejected for the same reasons as discovery-order IDs.

## Status

**Deferred for wave 1.** The current implementation uses readable
`${kind}:${name}` IDs for debuggability during initial development.
Content-addressed IDs will be implemented in a future wave when the `ir`
package and cache infrastructure are in place. The spec
(`specs/01-core/spec.md`) documents the target contract; the
implementation will be updated to match.
