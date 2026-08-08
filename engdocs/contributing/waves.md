# Wave Process

## What is a wave?

A wave is a batch of related work that produces a shippable increment.
Each wave corresponds to one or more packages in the monorepo.

## Wave lifecycle

1. **Mayor** reads the spec tree and decides the next wave.
2. **Mayor** creates beads for each task in the wave.
3. **Mayor** dispatches work to agents:
   - `gc sling architect <bead> --formula sverka-wave` for multi-step waves
   - `gc sling architect <bead>` for single tasks
4. **Architect** designs the spec and implementation plan.
5. **Builder** implements from the spec using TDD.
6. **Reviewer** gates quality (tests, build, lint, typecheck).
7. **Mayor** verifies completion and prepares the next wave.

## Wave list

| Wave | Packages | Status |
|------|----------|--------|
| 0 | Spec tree, monorepo scaffold, Gas City | In progress |
| 1 | core | Pending |
| 2 | ir | Pending |
| 3 | runtime | Pending |
| 4 | runtime-docker | Pending |
| 5 | runtime-host | Pending |
| 6 | planner | Pending |
| 7 | findings | Pending |
| 8 | policy | Pending |
| 9 | sdk | Pending |
| 10 | cli | Pending |
| 11 | checks | Pending |
| 12 | compiler-github | Pending |
| 13 | compiler-gitlab | Pending |
| 14 | website | Pending |
| 15 | documentation | Pending |

## Formula

The `sverka-wave` formula automates the architect → builder → reviewer cycle:

```toml
formula = "sverka-wave"

[[steps]]
id = "design"
agent = "architect"

[[steps]]
id = "implement"
needs = ["design"]
agent = "builder"

[[steps]]
id = "review"
needs = ["implement"]
agent = "reviewer"

[[steps]]
id = "finalize"
needs = ["review"]
```
