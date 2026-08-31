---
name: drill
description: Scoped descent primitive for agent systems. Creates isolated execution frames, materializes them as directory trees, and returns a result plus a parallel prevention plan so the same problem does not recur.
metadata:
  tags:
    - context-isolation
    - scope-management
    - filesystem-materialization
    - session-tracking
    - delegation
  author: petr-plenkov
  version: 1.1.0
---

# Drill

`/drill` is a scoped descent primitive for agent systems. It creates an isolated work frame, narrows the active problem, materializes that frame as a directory in the filesystem, and optionally delegates focused work to subagents. `/undrill` is the upward traversal primitive — alias for `/drill { direction = up }`.

## Intent

Control context growth, reduce cross-task contamination, and make investigation state durable. Subagents receive only relevant context and return a compressed result instead of sharing a full transcript, which improves focus and contains failures.

The design goal is **narrow → investigate → trace → materialize → prevent**. Every drill is both an execution frame and a reusable knowledge artifact in the project tree.

## Commands

```text
/drill { direction = down | up, ...options }
/undrill                       # alias for /drill { direction = up }
```

`direction = down` enters a narrower frame under the current drill; `direction = up` exits, consolidates findings, and returns control to the parent. If `direction` is omitted, default to `down`.

## Mental model

A hybrid of call stack, case folder, and recursive knowledge tree. Each downward drill creates a child frame with tighter scope; each upward drill closes that frame and promotes only curated outputs.

Key invariant: **isolation**. A child frame must not inherit the full parent transcript, and the parent must not absorb raw child reasoning. Only task-relevant inputs go down; only summarized outputs come back up.

## Filesystem model

Every drill is a directory with a same-named markdown file inside it. Nested drills live under `.drills/` so the tree itself is the index:

```text
.drills/
  2026-07-11-132105-a1b2c3-api-debug/
    2026-07-11-132105-a1b2c3-api-debug.md
    evidence-log-snippet/
      evidence-log-snippet.md
    sql-plan-capture/
      sql-plan-capture.md
    .drills/
      2026-07-11-132530-d4e5f6-db-optim/
        2026-07-11-132530-d4e5f6-db-optim.md
```

Documents live next to the drill file so they remain reusable outside it. See [references/templates.md](references/templates.md) for canonical templates.

## Naming convention

```text
YYYY-MM-DD-HHMMSS-sha-slug
```

Example: `2026-07-11-132105-a1b2c3-api-debug`. Easy to parse, lexically sortable, resilient when slugs collide.

## Execution semantics

### Downward drill

1. Validate the task is strictly narrower than the current frame.
2. Create the child directory under the current frame's `.drills/` directory.
3. Create the child markdown file using the directory name.
4. Copy in only the minimum necessary context, not the full parent transcript.
5. Start a new execution frame with a focused objective and optional delegation plan.

### Upward drill

1. Finalize the current drill file.
2. Add a `prevention_plan` (empty array if there are no actions; populated with parallel actions when the drill found an error, gap, or reusable lesson).
3. Compress findings and the prevention plan into a parent-consumable result.
4. Link important evidence and artifacts.
5. If this drill has a parent, propagate only the `prevention_plan` and selected outputs upward — never the full child history.
6. If this drill is the root, the calling agent enters the post-drill phase after control returns.

### `/undrill`

Syntactic sugar for the upward operation — identical validation, persistence, and merge behavior.

## Delegation

A drill may delegate to subagents. When it does:

- Each subagent gets a fresh, isolated context window.
- Each subagent receives only the task description and selected supporting materials.
- Subagents do not read sibling contexts or the full parent history.
- The parent receives only a compressed return object, not the subagent transcript.

Context bleed and cross-task contamination are the core reasons to isolate subagents in the first place.

## Cursor file

`.drills/cursor` holds exactly one line: the short SHA of the current drill. To resolve: read SHA → search `.drills/` recursively for a matching directory → use as `current_drill`.

The drill file itself stores `parent` in frontmatter, so the cursor + tree = full hierarchy.

## Prevention plan

A drill is not finished when it finds an answer. Every drill that encounters an error, surprise, or reusable lesson must return a **prevention plan** — a set of parallel, concrete actions that stop the same problem from recurring.

The plan is the drill's responsibility, not the parent's. Each drill produces its own plan and, on `/undrill`, passes it upward. Nested drills contribute their plans to the root drill; the topmost parent merges them during the **post-drill phase**.

A prevention plan contains parallel actions such as:

- **Immediate fix / workaround** — what can be done right now to unblock the current task.
- **Upstream issue** — for OSS or external dependencies, open an issue. Submitting a PR is out of scope unless the drill was explicitly asked to do so.
- **Memory / knowledge** — update user or project memory, `.memory/mental-models/`, or the knowledgebase so the context exists next time.
- **Backlog item** — create `.agents/backlog/YYYY-MM-DD-<slug>.md` when the fix requires future work.
- **Skill / rule update** — if the root cause is a missing or misleading skill, propose a change to `.agents/skills/` or `.agents/rules/` (universal/project scope).
- **Documentation / agentic document** — update `AGENTS.md`, README, runbooks, or agent rules.
- **Test / automation / guardrail** — add a test, CI check, or validation step that catches the problem early.

Each action must include:

- `action` — what to do.
- `scope` — universal, project, user, agent, or session.
- `sink` — where to persist it: `backlog`, `memory`, `knowledgebase`, `agentic-documents`, `upstream-issue`, `code`, `workaround`.
- `owner` — who is expected to act (drill itself, parent agent, subagent, human).
- `evidence` — link to findings or supporting artifacts.

Nested drills do not execute the post-drill phase; they only produce and propagate their `prevention_plan`.

## Retrieval

The materialized tree doubles as a project knowledge base. Later runs can retrieve `Findings`, `Return Payload`, `Prevention Plan`, and linked documents instead of replaying full transcripts. This is the broader goal: compress context and communicate through curated outputs.

## Post-drill phase

A drill has two phases: the descent/return phase and the post-drill phase. The post-drill phase runs **exactly once**, after the root `/undrill` returns control to the topmost parent agent.

During post-drill:

1. **Merge** `prevention_plan` entries from the root drill and all nested drills.
2. **Dedupe** by `sink` + `action` and keep the most specific `evidence`.
3. Invoke `retrospect` once with the merged plan; it routes each remaining action to the correct resource.

If the merged prevention plan is empty and the drill encountered a non-trivial issue, the parent agent must still retrospect to discover why the plan was missed.

Nested drills do not run post-drill; they only produce and propagate their plans.

## Cross-references

- [investigate-first](../../methodology/investigate-first/SKILL.md) — narrow scope before editing.
- [unwind](../../orchestration/unwind/SKILL.md) — expand scope by collapsing solved branches.
- [retrospect](../../self-learning/retrospect/SKILL.md) — capture learnings from mistakes.
- [backlog](../../workflow/backlog/SKILL.md) — track actionable follow-up work.
- [persistent-memory](../../foundation/persistent-memory/SKILL.md) — persistent knowledge across sessions.

For templates, frontmatter fields, full example workflows, validation rules, scope rules, error handling, state machine, merge/trace policies, and recommended defaults — see [references/templates.md](references/templates.md) and [references/troubleshooting.md](references/troubleshooting.md).
