---
name: investigate-first
description: Use before editing when a bug, task, failing test, or code area is not yet understood. Guides agents to inspect files, search symbols and errors, reproduce a failure when practical, and produce evidence before any patching. Useful for weak-model stability, unknown codebases, root-cause analysis, and preventing chaotic edits.
---

# Investigate First

Do not edit during this skill.

Goal: produce enough evidence for a narrow patch plan.

## Procedure

1. Define the investigation target from $ARGUMENTS.
2. Search before reading:
   - exact error strings
   - named functions/classes/components
   - route paths
   - failing test names
   - config keys
   - filenames
3. Read only the most relevant files.
4. Trace the smallest runtime path that could explain the issue.
5. If practical, reproduce the failure with a targeted command.
6. Separate facts from hypotheses.
7. Before recommending a fix, apply @skills:minimal-root-cause to ensure root-cause analysis and prevent overengineering.
8. End with one recommended next action.

## Required output

Investigation target: ...
Evidence found: ...
Likely cause: ...
Files relevant to patch: ...
Suggested next step: ...
Commands run: ...
Uncertainty: ...

## Stop conditions

Stop and report blocked if:

- required files are inaccessible
- reproduction needs secrets or external services not available
- evidence points to multiple unrelated causes
- next step would be editing without a clear target
