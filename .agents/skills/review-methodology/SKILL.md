---
name: review-methodology
description: >-
  Apply the repository's review policy as a methodology. Use whenever a change
  needs to be judged: establish the yardstick from REVIEW.md, evaluate each
  review axis in fresh context, classify findings, enforce the verification
  bar, and produce the required summary. Does not replace axis-specific skills;
  it governs how they are composed.
metadata:
  tier: 2
  triggers:
    - user
    - model
  source: theplenkov-ai/skills
---

# Review Methodology

`AGENTS.md` is the source of truth for project intent, and `REVIEW.md` is the
source of truth for review criteria. This skill makes that methodology
agent-loadable.
**Read `AGENTS.md` and `REVIEW.md` before reviewing.** Do not rely on memory;
these files are the contract.

## When to use

- Before approving, merging, or blocking any change.
- When writing a review report.
- When evaluating feedback you received.
- When delegating part of a review to a subagent.

## When not to use

- Fixing findings → `act`.
- Platform-specific PR review workflow on GitHub → `github-pr-review`.
- Two-axis Standards + Spec review → `two-axis-review`.

## The contract

A review is **not a linear pass** over the diff. It is an independent-axis
evaluation. Each axis must be judged in fresh context; if subagents are
available, give one to each axis. Do not blend axes: a Correctness finding is
not an Intent finding.

### Axes (from `REVIEW.md`)

| Axis | Core question |
|------|---------------|
| **Intent** | Is it clear what this change is for, and does it do exactly that? |
| **Correctness & Security** | Will it break, leak, or misbehave on hostile input? |
| **Fit** | Does it fit where it was put? |
| **Evidence** | What evidence supports the claim? |
| **Legibility** | Will the next agent understand the repository more cheaply? |

For detailed execution of a specific axis, delegate to the relevant skill:
`two-axis-review` for Standards/Spec decomposition,
`security-and-hardening` for threat modelling,
`evidence` for verification discipline,
`codehome` and `architecture-review` for fit,
`minimalist` and `critical-thinking` for legibility.

### Severity (from `REVIEW.md`)

- 🔴 **Important** — would break behavior, leak data, or ship the wrong thing.
- 🟡 **Nit** — worth fixing, never blocking.
- 🔵 **Question** — a real uncertainty or unproven claim. Question is first-class,
  not a hedge.
- 🟣 **Pre-existing** — real, but not introduced by this change. Cap at five
  per review; count the rest.

Do not use "Critical", "Major", "Minor", or "LGTM" as review language here.

### Verification bar (from `REVIEW.md`)

"Should work" is not evidence. Scale the proof to the change:

- Trivial change: one command and its output.
- Behavioral change: reproducible proof with `file:line` citations.
- Claims about versions, runtimes, or dependencies: live registry or release-page
  citation.

If a claim cannot be backed by evidence, publish it as a 🔵 Question, never as
🔴 Important.

### What to skip

- Anything already enforced by a linter, formatter, type-checker, or CI gate.
- Generated or vendored artifacts, lockfiles, and machine-authored index files.
- Style or renaming preferences without behavioral or comprehension impact.

If an automatable class of findings is not automated, propose the automation
once in the summary rather than flagging it repeatedly.

### Summary shape (from `REVIEW.md`)

1. Inferred or stated intent line (when intent was missing).
2. One-line severity tally.
3. Findings with severity, `file:line`, evidence, and actionable recommendation.
4. Prevention and automation proposals aggregated so they can be harvested.

No filler compliments. "No blocking issues" is one line.

### Prevention

Every 🔴 Important finding carries one line beginning `Prevention:` that names a
lint rule, CI gate, AGENTS.md rule, skill change, or explicitly "none, one-off".
If the finding violates something already written in `AGENTS.md`, `REVIEW.md`,
or a skill, the document is at fault: it must be rewritten or automated. "Be more careful"
is not a prevention.

## Generic guidance

The contract above is the yardstick; the references below are the practical details:

- [Structural remedies](references/structural-remedies.md) — propose the move, not just the problem.
- [Change sizing](references/change-sizing.md) — when and how to split a change.
- [Change descriptions](references/change-descriptions.md) — commit/PR message hygiene.
- [Dependency discipline](references/dependency-discipline.md) — adding and upgrading dependencies.
- [Common rationalizations](references/common-rationalizations.md) — pushback that sounds reasonable but isn't.
- [Red flags](references/red-flags.md) — signals that a review or change is off.
- [Verification checklist](references/verification-checklist.md) — close the loop before merging.
- [Security checklist](references/security-checklist.md) and [performance checklist](references/performance-checklist.md) — per-domain concerns.

## Output

- Status: reviewed, blocked, or inconclusive.
- Stated or inferred intent.
- One-line severity tally.
- Findings with `file:line`, severity, evidence, and recommendation.
- Prevention and automation proposals.
- Verification performed and remaining gaps.
