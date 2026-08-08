# Package Dependencies

## Dependency rules

1. `core` depends on nothing (except shared types).
2. `ir` depends on `core` types only.
3. `runtime` depends on `ir` and `core`.
4. `runtime-*` executors depend on `runtime`.
5. `planner` depends on `core` and `ir`.
6. `findings` depends on `ir`.
7. `policy` depends on `findings`.
8. `checks` depends on `core` and `ir`.
9. `compiler-*` depends on `ir`.
10. `sdk` re-exports from `core` and `checks`.
11. `cli` depends on everything (it's the top-level orchestrator).

## Circular dependency policy

No circular dependencies are allowed. If a package needs types from another
package that would create a cycle, extract the shared types into `core` or `ir`.
