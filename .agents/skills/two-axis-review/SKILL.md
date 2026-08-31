---
name: two-axis-review
description: Review the changes since a fixed point (commit, branch, tag, or merge-base) along two independent axes — Standards (does the code follow the repo's documented coding standards plus a Fowler smell baseline?) and Spec (does the code faithfully implement the originating issue / PRD / spec?). Runs both reviews in parallel sub-agents. Distinct from github-pr-review (single-axis) and act (thread remediation); this skill holds the two-axis discipline.
---

<!--
Upstream: mattpocock/skills @ skills/engineering/code-review
Adapted for theplenkov-ai/skills conventions. Reference to
`/setup-matt-pocock-skills` removed; the equivalent setup for this repo
lives in the `dotagents` skill if needed, but the two-axis discipline itself
is tracker-agnostic.
-->

# Two-Axis Review

Two-axis review of the diff between `HEAD` and a fixed point the user supplies:

- **Standards** — does the code conform to this repo's documented coding standards?
- **Spec** — does the code faithfully implement the originating issue / PRD / spec?

Both axes run as **parallel sub-agents** so they don't pollute each other's context, then this skill aggregates their findings.

## Process

### 1. Pin the fixed point

Whatever the user said is the fixed point — a commit SHA, branch name, tag, `main`, `HEAD~5`, etc. If they didn't specify one, ask for it.

Capture the diff command once: `git diff <fixed-point>...HEAD` (three-dot, so the comparison is against the merge-base). Also note the list of commits via `git log <fixed-point>..HEAD --oneline`.

Before going further, confirm the fixed point resolves (`git rev-parse <fixed-point>`) and the diff is non-empty. A bad ref or empty diff should fail here — not inside two parallel sub-agents.

### 2. Identify the spec source

Look for the originating spec, in this order:

1. Issue references in the commit messages (`#123`, `Closes #45`, GitLab `!67`, etc.) — fetch via the appropriate integration skill (`external-tools`, etc.).
2. A path the user passed as an argument.
3. A PRD/spec file under `docs/`, `specs/`, or `.scratch/` matching the branch name or feature.
4. If nothing is found, ask the user where the spec is. If they say there isn't one, the **Spec** sub-agent will skip and report "no spec available".

### 3. Identify the standards sources

Anything in the repo that documents how code should be written, such as `CODING_STANDARDS.md` or `CONTRIBUTING.md`, or the existing skills themselves. **The default standards-source set the Standards sub-agent should always receive, in addition to whatever the repo documents:**

- `methodology/review-methodology` — the multi-axis review rubric covering correctness, readability, architecture, security, and performance. **Include this by default** so the Standards axis doesn't miss any of those dimensions when the repo's own standards doc is silent on one of them.
- `engineering/architecture-review`, `engineering/frontend-ui-engineering`, `troubleshooting/performance-investigation`, `engineering/security-and-hardening` — module-shape and cross-cutting concerns.
- `behavior/minimalist`, `methodology/codehome`, `methodology/refactoring` — simplification and placement rules.

On top of whatever the repo documents, the Standards axis always carries the **smell baseline** below — a fixed set of Fowler code smells (_Refactoring_, ch.3) that applies even when a repo documents nothing. Two rules bind it:

- **The repo overrides.** A documented repo standard always wins; where it endorses something the baseline would flag, suppress the smell.
- **Always a judgement call.** Each smell is a labelled heuristic ("possible Feature Envy"), never a hard violation — and, like any standard here, skip anything tooling already enforces.

Each smell reads *what it is* → *how to fix*; match it against the diff:

- **Mysterious Name** — a function, variable, or type whose name doesn't reveal what it does or holds. → rename it; if no honest name comes, the design's murky.
- **Duplicated Code** — the same logic shape appears in more than one hunk or file in the change. → extract the shared shape, call it from both.
- **Feature Envy** — a method that reaches into another object's data more than its own. → move the method onto the data it envies.
- **Data Clumps** — the same few fields or params keep travelling together (a type wanting to be born). → bundle them into one type, pass that.
- **Primitive Obsession** — a primitive or string standing in for a domain concept that deserves its own type. → give the concept its own small type.
- **Repeated Switches** — the same `switch`/`if`-cascade on the same type recurs across the change. → replace with polymorphism, or one map both sites share.
- **Shotgun Surgery** — one logical change forces scattered edits across many files in the diff. → gather what changes together into one module.
- **Divergent Change** — one file or module is edited for several unrelated reasons. → split so each module changes for one reason.
- **Speculative Generality** — abstraction, parameters, or hooks added for needs the spec doesn't have. → delete it; inline back until a real need shows.
- **Message Chains** — long `a.b().c().d()` navigation the caller shouldn't depend on. → hide the walk behind one method on the first object.
- **Middle Man** — a class or function that mostly just delegates onward. → cut it, call the real target direct.
- **Refused Bequest** — a subclass or implementer that ignores or overrides most of what it inherits. → drop the inheritance, use composition.

### 4. Spawn both sub-agents in parallel

**Permission gate.** This step is a model-invoked behaviour. Per the orchestration rules in this repository (see `subagent-capsule` and the role-prompt reference `$subagents-setup` documented in `AGENTS.md § Role prompts`), `Manager → ...` is a downward delegation, and launching parallel sub-agents costs context + money; the user's `adhd` goal focus and `token-rationalism` apply. Require **explicit user permission** before launching both axes in parallel. If the user has not explicitly said "run both", "parallel", or equivalent, default to running the axes **sequentially** (Standards first, then Spec) in a single sub-agent invocation, and report both axes in the aggregate step. The sequential path is the safe default; the parallel path is the optimisation.

If the user has given explicit permission for parallel execution, use this repository's `run_subagent` tool to launch both sub-agents in parallel (a single message with two `run_subagent` calls). Both calls use the **investigator** profile from `subagent-capsule` — the sub-agents are read-only evidence gatherers, not patchers, and do not delegate. Each call's prompt must wrap its content in the `SUBAGENT_CONTEXT_CAPSULE ... END_SUBAGENT_CONTEXT_CAPSULE` structure defined in `subagent-capsule` (root objective, current stack, profile, assigned subtask, success condition, known evidence, allowed/forbidden scope, edit permission = none, verification expectation, output contract). Without that capsule the sub-agent will invent context the parent never gave it.

**Standards sub-agent capsule (assigned subtask) — include:**

- The full diff command and commit list.
- The list of standards-source files you found in step 3, **plus the smell baseline from step 3** pasted in full — the sub-agent has no other access to it.
- The assigned subtask: "Report — per file/hunk where relevant — (a) every place the diff violates a documented standard: cite the standard (file + the rule); and (b) any baseline smell you spot: name it and quote the hunk. Distinguish hard violations from judgement calls — documented-standard breaches can be hard, but baseline smells are always judgement calls, and a documented repo standard overrides the baseline. Skip anything tooling enforces. Under 400 words."

**Spec sub-agent capsule (assigned subtask) — include:**

- The diff command and commit list.
- The path or fetched contents of the spec.
- The assigned subtask: "Report: (a) requirements the spec asked for that are missing or partial; (b) behaviour in the diff that wasn't asked for (scope creep); (c) requirements that look implemented but where the implementation looks wrong. Quote the spec line for each finding. Under 400 words."

If the spec is missing, skip the Spec sub-agent and note this in the final report. The final report's `## Spec` heading is **always emitted**; when no spec is available, its body is the literal text `no spec available; skipped`. This makes the no-spec path a first-class output, not an absence the consumer has to interpret.

### 5. Aggregate

Present the two reports under `## Standards` and `## Spec` headings, verbatim or lightly cleaned. The `## Spec` heading is always present, with the body `no spec available; skipped` when step 2 found no spec. Do **not** merge or rerank findings — the two axes are deliberately separate (see _Why two axes_).

End with a one-line summary: total findings per axis, and the worst issue _within each axis_ (if any). Don't pick a single winner across axes — that's the reranking the separation exists to prevent.

## Why two axes

A change can pass one axis and fail the other:

- Code that follows every standard but implements the wrong thing → **Standards pass, Spec fail.**
- Code that does exactly what the issue asked but breaks the project's conventions → **Spec pass, Standards fail.**

Reporting them separately stops one axis from masking the other.

## Related skills

See [references/related-skills.md](references/related-skills.md) for related skills.