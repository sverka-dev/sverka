---
name: minimal-root-cause
description: Use before patching code when the task may cause overengineering, duplicate logic, unnecessary dependencies, or symptom-only bug fixes. Enforces laziness about solution, rigor about understanding and verification. Climb the laziness ladder before editing.
---

# Minimal Root Cause

Use this skill before patching code when the task may cause overengineering, duplicate logic, unnecessary dependencies, or symptom-only bug fixes.

Core rule:
**Be lazy about the solution, never lazy about understanding or verification.**

## Laziness ladder

Before editing, climb this ladder and stop at the first valid rung:

1. **Does this need to exist?**
   If the requested change is speculative or already covered, do not build it. Explain the smaller alternative.

2. **Does this already exist in the codebase?**
   Search for existing helpers, patterns, utilities, types, routes, components, tests, and callers before writing new code.

3. **Does the standard library solve it?**
   Prefer stdlib over custom helpers.

4. **Does the platform solve it natively?**
   Prefer browser, CSS, HTML, database, shell, framework, or OS native behavior over custom code.

5. **Does an already-installed dependency solve it?**
   Use installed dependencies before adding a new dependency.

6. **Can this be one small change?**
   Apply the smallest root-cause fix, not a symptom patch.

7. **Only then write new code.**
   Write the minimum code that works and leaves runtime proof.

## Bugfix rule

A bug report names a symptom. Before patching, inspect the shared function or shared flow behind the symptom.

Grep callers of any function you plan to touch. Prefer one correct guard in the shared path over repeated guards at every caller.

## Never minimize away

- trust-boundary input validation
- authentication or authorization checks
- security-sensitive escaping/sanitization
- error handling that prevents data loss
- accessibility basics
- user-explicit requirements
- runtime verification

## Patch rule

Shortest working diff wins only after the real flow is understood.

A small patch in the wrong place is not minimal. It is another bug.

## Required summary for a simplification

When proposing or applying a fix, write a short summary covering:

- what was reused or avoided
- why this is the root-cause location
- what was intentionally not built
- what runtime check proves the behavior

## Required output

Laziness ladder rung stopped at: ...
Existing solution found (if any): ...
Reuse decision: ...
Root-cause location: ...
Planned change: ...
What was intentionally not built: ...
Verification approach: ...
