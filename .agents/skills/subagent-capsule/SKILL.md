---
name: subagent-capsule
description: Use immediately before launching a subagent. Forces the parent to construct a complete context capsule with root objective, current stack, known evidence, scope, permissions, and output contract, because subagents do not reliably inherit parent context. Useful for investigator, patcher, and verifier subagent calls.
---

# Subagent Capsule

Goal: prepare a safe, complete prompt for run_subagent.

A subagent must be treated as having zero reliable memory of the parent task unless the parent includes the relevant protocol and evidence in the launch prompt.

## Before launching

Choose exactly one profile:

- investigator: read-only evidence gathering
- patcher: one narrow approved patch
- verifier: runtime proof only

Do not launch parallel subagents unless the user explicitly asks.

Do not launch a subagent with a vague prompt like:

- check this
- fix it
- look around
- make it work

## Required capsule

Include this exact structure in the subagent prompt:

SUBAGENT_CONTEXT_CAPSULE
Root objective: [one sentence]
Current stack: [Root -> Current -> Blocker]
Subagent profile: [investigator | patcher | verifier]
Assigned subtask: [one narrow task]
Success condition: [what evidence proves this subtask]
Known evidence: [exact errors, file paths, command outputs, observations]
Allowed scope: [files/folders/commands/tools]
Forbidden scope: [everything else or specific exclusions]
Edit permission: [none | exact files only]
Verification expectation: [command/browser/runtime proof expected]
Output contract:

1. Status: resolved, blocked, failed, or inconclusive
2. Findings
3. Evidence with file paths, line refs, or command output
4. Actions taken
5. Verification performed
6. Recommended parent next action
7. Remaining risks
END_SUBAGENT_CONTEXT_CAPSULE

## Parent acceptance rule

After the subagent returns, the parent must inspect the evidence and decide whether to accept, reject, or verify further.

The parent alone can declare the root task resolved.
