---
name: one-shot-patch
description: Use when the relevant file and fix hypothesis are known and the agent needs to make exactly one narrow change, then verify it. Prevents stacked fixes, broad refactors, and chaotic iteration. Best for isolated bug fixes after investigation has identified the likely cause.
---

# One-Shot Patch

Goal: apply exactly one logical fix and verify it.

## Preconditions

Before editing, confirm:

- exact file or files to change
- one fix hypothesis
- expected verification command or runtime proof

If these are missing, stop and ask for the missing item or switch to $investigate-first.

## Procedure

1. Read the exact target code before editing.
2. State the single intended change in public summary.
3. Apply the smallest edit that tests the hypothesis.
4. Do not reformat unrelated code.
5. Inspect the changed area.
6. Run targeted verification.
7. If targeted verification passes, optionally run broader verification if cheap and relevant.

## If verification fails

Do not try a second unrelated fix.

Report:
What failed: ...
Evidence: ...
Option 1, drill-down: ...
Option 2, workaround: ...
Question or next checkpoint: ...

## Required output

Patch hypothesis: ...
Files changed: ...
Change summary: ...
Verification command: ...
Verification result: ...
Diff summary: ...
Remaining risk: ...
