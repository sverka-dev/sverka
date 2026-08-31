---
name: refactoring
description: Use when an agent needs to safely restructure existing code without changing observable behavior — extract method/class/module, move method/file, rename with impact analysis, inline dead code, or large code reorganization. Guarantees test-first refactoring discipline and explicit behavior preservation. Differs from one-shot-patch (small fix) and architecture-review (critical read-only diagnosis).
---

# Refactoring

Goal: improve the structure of code without changing its observable behavior, while keeping the test suite green at every step.

Use this skill when:

- a function or class is too large and should be split
- logic is duplicated and should be deduplicated by extraction
- a method, file, or module belongs somewhere else
- a rename is needed across an entire codebase with clear impact
- dead code is suspected and should be inlined or removed
- large reorganization is required before a feature change

Do not use this skill when:

- behavior must change (use one-shot-patch or feature work)
- the question is "should we redesign?" (use architecture-review first)
- the area is not yet understood (use investigate-first)
- the change is across multiple unrelated modules with no test coverage (build coverage first)

## Core Invariant

**Refactoring does not change observable behavior.**

If behavior changes, it is not refactoring. Stop and reopen the change as a feature/bugfix, or split the work into:

1. pure refactor (green tests in, green tests out)
2. behavior change (separate commit/PR with its own tests)

## Refactor Catalog

Each entry has:

- intent
- mechanical steps
- "stop conditions" — situations where the refactor should not proceed
- test-first guarantee

### Extract method

- intent: name a block of code so it can be reused, tested, or read
- steps:
  1. identify the local variables used by the block
  2. declare them as parameters
  3. copy the block
  4. replace with a call
  5. run tests
- stop conditions: block depends on too many in-scope variables (consider Extract Object first)
- tests: existing tests of the enclosing function must pass

### Extract function/Extract class

- intent: split a class or module with multiple responsibilities
- steps:
  1. identify the cohesive subset of fields/methods
  2. create the new class/module
  3. move fields and methods
  4. replace call sites
  5. update tests with the new seams
- stop conditions: shared state between the two halves is large (consider a smaller extraction first)
- tests: tests covering the moved behavior must pass with the new home

### Move method / Move file

- intent: relocate a function or file to a more cohesive home
- steps:
  1. identify all call sites and importers
  2. move the target
  3. update import paths/aliases
  4. remove or update deprecated wrappers only after callers are all migrated
- stop conditions: high call-site fan-out without deprecation path (introduce a thin facade first)
- tests: import all tests for the target; verify the moved symbol resolves

### Rename with impact analysis

- intent: change an identifier across the codebase safely
- steps:
  1. enumerate every occurrence (definition, declaration, call, string, doc, test, config)
  2. update symbol
  3. update references in code, tests, docs, generated files, public schemas
  4. keep public-API renames behind a deprecation alias when needed
- stop conditions: public API or external contract; add a deprecation alias
- tests: typecheck + symbol-resolution tests; do not skip

### Inline dead code / Remove dead code

- intent: eliminate code that is never reached
- steps:
  1. confirm the code is unreachable by coverage, grep, and call-graph analysis
  2. remove
  3. confirm tests still pass and the build artifact is smaller
- stop conditions: low confidence, no test coverage over the area — fall back to commenting and a TODO with owner instead
- tests: full test run

### Change signature (parameter object, defaults)

- intent: gather parameters, drop unused ones
- steps:
  1. introduce parameter object
  2. migrate call sites
  3. update tests
  4. remove old signature only after zero callers
- tests: typecheck + tests for the new signature

## Test-First Refactoring Guarantee

For every refactor:

1. Confirm tests exist for the area.
2. If tests are missing or weak:
   - add characterization tests (capture current behavior)
   - use coverage to identify the gap
   - never refactor untested code without explicit owner approval
3. Run the test suite to confirm a green baseline.
4. Apply the refactor in the smallest committable step.
5. Re-run the test suite. Green is required.
6. Commit only the refactor; do not mix with behavior changes.

## Procedure

### 1. Identify the refactor

From the issue, code review, or architecture-review finding:

- name the refactor (Extract X, Move Y, Rename Z)
- describe the outcome in one sentence
- list the desired and the forbidden behavior changes

### 2. Scope it

- blast radius: list of files, callers, tests, fixtures
- sequencing: smallest independent steps
- exit criteria: tests green, diff reviewed

### 3. Establish baseline

- run targeted tests
- run lint and typecheck
- run broader relevant tests if cheap
- record the green command

### 4. Apply stepwise

For each step:

1. State the step in one sentence.
2. Apply it.
3. Inspect the diff.
4. Run tests.
5. If green, continue. If red, revert the step and debug.

### 5. Verify

- targeted tests pass
- surrounding tests pass
- lint passes
- typecheck passes
- no behavior changes; demonstrate with diff and tests
- build artifact size and runtime unchanged (apply performance-investigation if needed)

### 6. Commit

- one commit per refactor step (preferred)
- clear message: `<Refactor>: <verb> <target>`

## What NOT to do

- Do not change behavior inside a refactor commit.
- Do not mix refactoring with a feature or bugfix.
- Do not refactor without tests in place.
- Do not rename a public API without a deprecation alias.
- Do not "fix" tests by relaxing them.
- Do not edit generated files as part of a hand refactor — regenerate them.
- Do not use the refactor commit to introduce a new dependency unless scoped and justified.
- Do not leave the working tree dirty across sessions; commit or revert.

## Required output

Refactor type and target: ...
Behavior changes (must be empty): none — describe any required and stop
Test baseline (before): ...
Steps applied: ...
Test result (after): ...
Lint, typecheck, build: ...
Diff summary: ...
Commit list: ...
Remaining risk: ...

## Stop conditions

Stop and report blocked if:

- the required behavior change is non-trivial — split the work
- test coverage over the area is below the project's gate and the owner has not approved refactoring without it
- the blast radius exceeds the budget for one commit — split
- generated files would change and the generator is not runnable in this environment

## Related skills

See [related-skills.md](references/related-skills.md) for the full cross-reference list.
