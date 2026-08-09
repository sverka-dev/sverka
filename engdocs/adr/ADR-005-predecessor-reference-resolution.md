# ADR-005: Predecessor-reference resolution model

## Context

The `core` package's `Operation` interface supports `after(predecessors)` and
`pipeline(...ops)` for building dependency edges. The `OperationSpec.dependsOn`
field is `string[]` (ids). But operation ids are not assigned until planning
time — the spec states `_id` is "assigned during planning." This creates a
tension: how can `after()` populate `dependsOn` with string ids when ids
don't exist yet?

Additionally, `matrix()` expands a single operation into multiple nodes at
planning time, each needing its own id. So ids cannot be reliably assigned at
composition time.

## Decision

Store **predecessor references** (Operation objects) internally on the
operation node, not string ids. Resolution to `dependsOn: string[]` happens
during planning, after ids are assigned.

The internal `OperationNode` carries:
```typescript
interface OperationNode extends Operation {
  readonly predecessors: readonly OperationNode[];
  readonly siblings: readonly OperationNode[];
}
```

`after()` appends to `predecessors`. `pipeline()` wires the chain via
`predecessors`. `parallel()` collects siblings. None of these touch
`spec.dependsOn` at composition time.

During planning:
1. Walk the graph from roots, collect all nodes.
2. Expand matrix nodes into children.
3. Assign deterministic ids.
4. Resolve predecessor refs → `dependsOn` string ids on the emitted
   `OperationSpec`, merged with any user-provided explicit `dependsOn` strings.

## Consequences

- Composables are fully lazy: no id generation at call time, no validation
  that requires ids.
- `dependsOn` on the public `OperationSpec` is populated only during
  planning; at composition time it contains only user-provided explicit ids
  (if any).
- The planner is the single point of edge resolution and cycle detection.
- Matrix expansion works cleanly: children inherit predecessor refs and
  resolve them after id assignment.
- `OperationNode` is internal (`src/internal/node.ts`) and not exported —
  consumers only see the `Operation` interface.

## Alternatives

- **Assign ids at composition time:** Each `run()` gets an id immediately.
  `after()` populates `dependsOn` with string ids right away. Rejected —
  breaks matrix expansion (children don't exist yet), and forces id
  generation to happen during the lazy phase, risking non-determinism if
  composition order varies.
- **Use object identity as the edge key:** `dependsOn` is `Operation[]`
  instead of `string[]`. Rejected — `OperationSpec` must be serializable
  (it's the Plan IR input), so edges must be string ids, not object refs.
