---
name: sverka-wave
description: Use when planning or executing a spec-driven development wave. Trigger when the mayor asks to plan the next wave, the architect needs to design a spec, or the builder needs to implement from a spec. Covers the architect→builder→reviewer→finalize cycle, spec tree navigation, and wave gating.
---

# Sverka Wave

A wave is one package's journey from spec to reviewed implementation. Every wave follows the same cycle: **architect designs → builder implements (TDD) → reviewer gates → mayor finalizes**.

## Spec Tree

The spec tree lives in `specs/` as numbered directories:

```
specs/
  00-overview/
  01-core/
  02-ir/
  ...
  15-documentation/
```

Each spec contains: Overview, Goals, Non-goals, Interfaces, Data models, Error handling, Test plan.

## Wave Cycle

### 1. Design (architect)

1. Read the wave's spec in `specs/NN-<name>/spec.md`
2. Read `engdocs/` for existing architectural context
3. Trim the spec — cut everything non-essential (YAGNI), but preserve every
   interface, type, and error code the spec requires. "Trim" means remove
   prose and scope, not required specification surfaces.
4. Produce an implementation plan at `engdocs/architecture/wave-NN-<name>-plan.md`
5. Define TypeScript interfaces — only export what's used, but never remove
   an export that the spec requires. "Only export what's used" means don't
   add speculative API, not that you may delete spec-mandated interfaces.
6. Report to mayor via mail

### 2. Implement (builder)

1. Read the spec and implementation plan
2. Write failing tests first (TDD)
3. Run tests — confirm they fail for the right reason
4. Implement until tests pass
5. Run: `bun run build && bun run test && bun run typecheck && bun run lint`
6. Cut any code that isn't needed
7. Report to mayor via mail

### 3. Review (reviewer)

1. Run all gates fresh (not cached, not trusted from builder):
   ```bash
   bun run test --skip-nx-cache
   bun run typecheck
   bun run lint
   bun run build --skip-nx-cache
   ```
2. Read the diff and spec
3. Check: exports match spec 1:1, no `any`, error classes use `override` on cause
4. APPROVE or REJECT with specific feedback
5. On REJECT: builder fixes, reviewer re-reviews

### 4. Finalize (mayor)

1. Verify reviewer approved
2. Check commit completeness:
   ```bash
   git status --short
   ```
   Confirm no untracked wave files remain before staging.
3. Stage only wave files:
   ```bash
   git add packages/<package>/ specs/NN-<name>/ engdocs/ bun.lock
   ```
4. Exclude: `city.toml`, `agents/`, `.devin/`, `.gc/`, `.beads/`, `formulas/`
5. Commit and push stacked PR
6. Close wave epic, create next wave

## Commit Hygiene

Before committing a wave, verify every impl + test file is committed (not
just staged — staging alone does not survive a forced checkout):

```bash
git status --short
```

Untracked and staged files are fragile under concurrent branch switches. A
forced `git checkout -f` can discard both. Before any branch switch, either
use a separate worktree (`git worktree add`) or commit/stash all changes so
the working tree is clean. Commit the wave's files as soon as review is
approved, before any other session can switch branches.

## Stacked PRs

Each wave's PR targets the previous wave's branch:

```
main
 └── wave-1-core (PR #1, base: main)
      └── wave-2-ir (PR #2, base: wave-1-core)
           └── ...
```

## Failure Handling

When a wave fails review or a builder is stuck:
1. Create a drill task: `gc bd create "DRILL: <problem>"`
2. Dispatch to builder or architect with `skill drill` instructions
3. Wait for drill result before dispatching fix work
4. Never paper over symptoms — drill to root cause first
