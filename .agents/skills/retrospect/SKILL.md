---
name: retrospect
description: Self-correction protocol for AI agents. Use after mistakes, corrections, or when a drill returns a non-trivial finding, then persist the fix and route parallel prevention actions to the right resource.
---

# Retrospect

When something goes wrong, the agent must stop, understand why, and **persist a fix that actually prevents recurrence**.

## Core Principle

> A retrospection is only successful if the mistake **cannot happen again** in the same context.

The agent decides HOW to persist the fix — memory, skill update, `AGENTS.md` change, code comment, project docs — whatever mechanism is most effective for the specific finding. There is no single right answer.

## Protocol

### 1. Stop

Stop the current approach immediately. Acknowledge the mistake. Don't continue hoping it will work out.

### 2. Understand

- **What went wrong?** — describe precisely
- **Why?** — missing context? wrong assumption? ignored conventions?
- **Is this a pattern?** — has this happened before?

### 3. Determine Scope

The fix must land at the right level:

| Scope | When | Examples |
|-------|------|----------|
| **Universal** | Applies to all agents, all projects | Update `AGENTS.md` or `.agents/skills/` |
| **Project** | Specific to this codebase | Update project docs, README, config |
| **User** | Specific to the user's preferences, style, or workflow across all their projects | Global agent memory under the agent's user-config dir (e.g. `~/.config/<agent>/memory/`) |
| **Agent** | Specific to this agent's behavior on this machine | Local agent rules, tool-specific config |
| **Session** | One-off, won't recur | Mental note, no persistence needed |

**Key rule**: extend existing rules rather than creating new ones. One source of truth per topic.

### 3b. Classify Memory (when persisting to memory)

When the chosen mechanism is **memory** (not file/rules), the agent MUST decide explicitly between **user memory** and **project memory**. Do not leave this to implicit routing.

| Memory type | Lives in | Survives | Visible to |
|-------------|----------|----------|------------|
| **User memory** | Agent's user-config dir under `~/.config/<agent>/memory/` (global) | Across projects, across clones | All of the user's agents on this machine |
| **Project memory** | `.memory/` inside the current repo | As long as the clone exists | Only agents working in this repo |

Decision rules:

- **User memory** — the finding is about the *user*: communication style, approval preferences, frequently used toolchains, things that should follow the user everywhere (e.g. "user prefers concise summaries, no preamble").
- **Project memory** — the finding is about *this project*: conventions, current state, ownership, past decisions, runbooks specific to this repo (e.g. "Codacy token is configured under env `CODACY_API_TOKEN` in this repo").
- **Both** — write the user-scoped half to user memory and the project-scoped half to project memory. Do not duplicate.
- **Neither** — if it is genuinely universal, it goes to `AGENTS.md` or a skill update, not memory.

Default to the narrower scope. Project memory that should be user memory leaks into every new repo; user memory that should be project memory breaks other repos that don't share the convention.

### 4. Persist the Fix

The agent chooses the persistence mechanism based on scope and its own capabilities:

- **Skill update** — if the finding improves a skill's instructions
- **AGENTS.md** — if it's a universal project rule
- **User memory** — if the finding is about the user's preferences and should follow them across projects (see `### 3b`)
- **Agent memory** — if it's agent-specific context (one machine, one agent)
- **Project memory** (`.memory/`) — if it's project-specific and the user-vs-project triage in `### 3b` classified it as project-scoped
- **Code comments** — if it's implementation-level
- **Project docs** — if it's project-specific knowledge

The only requirement: **the fix must be where the agent (or another agent) will encounter it before making the same mistake**.

### 5. Apply Now

Apply the learning to the current task immediately. Don't just document it for the future.

## Drill-driven retrospection

Run this protocol once after the root `/undrill` returns and the topmost parent has merged the `prevention_plan` from the whole drill tree.

For every action in the merged plan, route it to the correct resource based on its `sink`:

- `backlog` → `$skill{backlog}` with the action, scope, and a link to the root drill as the source.
- `memory` → classify as user or project memory per step 3b, then persist the learning through `$skill{persistent-memory}` with the selected scope.
- `knowledgebase` → create or update a knowledge note when the finding is reusable across projects or agents.
- `agentic-documents` → update `AGENTS.md`, `.agents/rules/`, `.agents/commands/`, or project docs based on the scope decision in step 3. If the target is a specific skill's `SKILL.md`, use `$skill{skill-feedback}` to route the change to its canonical `source:` repository instead of editing a generated copy.
- `upstream-issue` → open an issue in the relevant OSS/external repo. Do **not** submit a PR unless the drill explicitly included it.
- `workaround` / `code` → implement the workaround, link it to the root drill, and add a guardrail or test if possible.

If an action is out of the agent's current scope or permissions, document it in the backlog and flag it to the user.

## Authority Hierarchy

When rules conflict:

1. `AGENTS.md` — highest authority
2. `.agents/skills/` — domain rules
3. Project documentation — project-specific
4. User memory (`~/.config/<agent>/memory/`) — user preferences across projects
5. Agent memory — lowest priority

When conflicts are detected: **stop, present to user, wait for resolution**.

## Sending universal findings upstream

When step 3 classifies a finding as **universal** AND the finding points at a specific skill's instructions (rather than `AGENTS.md` itself), do not edit the skill file in the consuming repo — hand off to `$skill{skill-feedback}`. It will file the finding at the skill's declared source repository using the `source:` field in its frontmatter. This keeps skill improvements flowing back to the canonical source instead of forking across clones.

## Anti-Patterns

- ❌ Persisting to a file nobody reads (including yourself)
- ❌ Only using memory when the finding is universal
- ❌ Only using files when the finding is agent-specific
- ❌ Skipping root cause — fixing symptoms instead of causes
- ❌ Blaming the user
- ❌ Continuing without acknowledging the mistake

## References

- [ATTRIBUTION.md](references/ATTRIBUTION.md) — AI attribution headers for external posts
- `drill` — scoped descent that returns a `prevention_plan`.
- `$skill{backlog}` — track actionable follow-up work.
- `$skill{persistent-memory}` — persistent knowledge across sessions.
