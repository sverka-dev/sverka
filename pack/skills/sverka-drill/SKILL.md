---
name: sverka-drill
description: Use when a sverka wave fails review, a builder is stuck, or tests break unexpectedly. Trigger when the mayor needs to investigate a failure, the builder hits an unexpected error, or any agent needs to isolate a root cause before attempting a fix. Covers drill task creation, scoped investigation, and prevention planning.
---

# Sverka Drill

When something breaks, drill to root cause before touching code. Never paper over symptoms.

## When to Drill

- Wave fails review with unclear cause
- Tests fail unexpectedly after a change
- Build breaks with no obvious reason
- Builder is stuck and guessing
- Data loss (untracked files wiped by branch switch)

## Drill Procedure

### 1. Create a drill task

```bash
gc bd create "DRILL: <problem description>" --type=task --priority=0
```

Priority 0 = critical. Drill tasks are urgent.

### 2. Scope the investigation

Define what you're investigating:
- What is the symptom?
- What is the expected behavior?
- When did it start?
- What changed recently?

### 3. Isolate

Reproduce the problem reliably:
```bash
# Run the failing test in isolation
cd packages/<name> && bun run vitest run __tests__/<failing-test>.test.ts

# Check git state
git status --short
git log --oneline -5
git diff HEAD~1
```

### 4. Trace the code path

Read the code, don't guess:
- Follow the execution path from entry to failure
- Add targeted logging if needed
- Identify the exact line where behavior diverges from expected

### 5. Identify root cause

State the root cause in one sentence:
"The problem is X because Y."

### 6. Fix

Fix the root cause, not the symptom. One fix, one test, verify.

### 7. Prevention

Record a prevention note so the same problem doesn't recur:

```bash
bd remember "drill-finding-$(date +%Y-%m-%d)-<keyword>: <root cause and prevention>"
```

## Common Sverka Drill Patterns

### Untracked files lost on branch switch

Root cause: a forced checkout (`git checkout -f` or `git checkout --force`)
wipes untracked files that conflict with the target branch. A normal
checkout preserves local changes or aborts on conflicts — forced checkout
is what causes data loss. Staging alone is NOT sufficient: a forced
checkout can still discard staged changes and conflicting untracked files.
Prevention: before switching branches, either (a) use a separate worktree
(`git worktree add`) so the working tree is never disturbed, or (b) commit
or stash all changes (`git commit` / `git stash`) so the tree is clean.
Never use `--force` when switching branches. Commit as soon as review is
approved.

### Tests pass in package but monorepo is red

Root cause: entangled changes in another package broke this one.
Prevention: always run `bun run test` for the WHOLE monorepo, not just the package.

### `bun test` fails but `bun run test` passes

Root cause: `bun test` runs Bun's built-in runner, not vitest. The vi shim lacks `vi.hoisted`.
Prevention: always use `bun run test` (nx → vitest). Document in AGENTS.md.

### it.skip() inside it() callback silently passes

Root cause: `it.skip()` called inside an `it()` callback doesn't skip — it silently passes.
Prevention: use `it.skipIf()` at the describe level, not `it.skip()` inside a callback.
