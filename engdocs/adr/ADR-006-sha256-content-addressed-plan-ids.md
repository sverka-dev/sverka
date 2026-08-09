# ADR-006: SHA-256 content-addressed Plan and Operation IDs

## Context

The canonical Plan IR (ADR-003) needs deterministic identifiers so that the
same workflow + source context always produces the same plan id, and so
that matrix expansion produces distinct, stable operation ids. The id is
part of the plan's identity: it is used for caching, diffing, replay, and
for cross-referencing `dependsOn` edges. It must be reproducible by any
tool that reads the plan, without contacting the planner.

The id scheme must be:
- Deterministic (byte-stable input → same output).
- Collision-resistant under realistic plan sizes.
- Dependency-free (no external hashing library).
- Self-describing (a reader can tell a plan id from an operation id).

## Decision

Use SHA-256 (Node built-in `node:crypto`) over the canonical JSON
serialization defined in `serializePlan`:

- **Plan id:** `computePlanId` strips `id` and `createdAt` from the plan,
  canonicalizes the remainder, hashes it, hex-encodes, and prefixes with
  `plan-`. Form: `plan-<64 hex chars>`.
- **Operation id:** `computeOperationId` canonicalizes
  `{ kind, name, context }`, hashes, hex-encodes, prefixes with `op-`.
  Form: `op-<64 hex chars>`. `context` carries matrix values and any other
  discriminating fields, so matrix children are distinct by construction.

The canonical JSON form (sorted keys, compact, `undefined` omitted,
array order preserved) is the single shared primitive: both `serializePlan`
and `computePlanId` call the same `internal/canonical.ts` walker, so the
wire format and the hash input can never drift.

`createdAt` is excluded from the plan id because it is informational only;
including it would make the id time-dependent and defeat replay/diff.

## Consequences

- Two identical plans produce byte-identical serialized output and the
  same id — enabling `plan diff` and cache keys.
- Changing any operation field (other than `createdAt`) changes the plan
  id, so stale caches are never hit after a workflow change.
- Plan and operation ids are distinguishable by prefix without parsing.
- IDs are 69 and 67 characters respectively — longer than sequential ids,
  but stable and globally unique without coordination.
- Validation rule 2 (id matches recomputed) is enforceable by any consumer
  using only the plan contents and `node:crypto`.

## Alternatives

- **UUID v4/v5:** Not content-addressed; would require a registry to map
  content to id. Rejected — defeats reproducibility.
- **Sequential integers:** Not stable across planner runs or matrix
  reordering. Rejected — non-deterministic.
- **BLAKE3:** Faster but not in Node's built-in `crypto`; would add a
  dependency. Rejected — SHA-256 is fast enough for plan-sized inputs and
  needs no dep (consistent with ADR-001's minimal-dependency stance).
- **No prefix:** Saves 5 chars but loses self-description and makes
  `dependsOn` references ambiguous in mixed contexts. Rejected.
