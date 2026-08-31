# Drill Templates

Canonical templates for drill files, supporting documents, and example workflows. Reference, not loaded automatically.

## Drill file template

```md
---
type: drill
id: 2026-07-11-132105-a1b2c3-api-debug
parent: null
created_at: 2026-07-11T13:21:05Z
updated_at: 2026-07-11T13:23:10Z
status: open
agent: orchestrator
direction: down
sha: a1b2c3
slug: api-debug
goal: Identify the root cause of the API 500 error
scope: Only /api/orders, production logs, and database latency evidence
problem: Requests intermittently fail with 500 during concurrent traffic spikes
delegate: auto
trace: light
merge: summary

# Session pointers – who is working here and where to continue
session:
  agent_id: orchestrator
  role: orchestrator
  session_id: sess_01jz8n4x7e
  parent_session_id: null
  spawned_by: null
  mode: direct
  resume_command: null
  resume_uri: null
---

# Scope

What this drill includes, excludes, and why the boundary is narrow enough.

# Problem Statement

The specific issue this drill is trying to resolve.

# Plan

Ordered approach for the drill.

# Findings

Resolved observations, confirmed hypotheses, rejected hypotheses, and current status.

# Evidence

Relative links to adjacent document directories and files.

# Links

References to related drills, ancestor drills, or sibling investigations.

# Return Payload

The exact summary or structured object intended for the parent on undrill.

# Prevention Plan

Parallel actions that stop this problem from recurring. See `skills/safety/drill/SKILL.md` for the full contract.

- Action, scope, sink, owner, and evidence for each item.
- Supported sinks: `backlog`, `memory`, `knowledgebase`, `agentic-documents`, `upstream-issue`, `code`, `workaround`.
- If the drill found a non-trivial issue and this section is empty, treat it as a retrospective gap.

# Session Continuity

- **Agent**: `{agent.session.agent_id}`
- **Session**: `{agent.session.session_id}`
- **Parent session (if delegated)**: `{agent.session.parent_session_id}`
- **Spawned by**: `{agent.session.spawned_by}`
- **Resume**: `{agent.session.resume_uri || agent.session.resume_command || "continue in current orchestrator session"}`
```

## Return payload example

```yaml
answer: Short answer to the drill's goal
confidence: 0.87
evidence:
  - ./evidence-log-snippet/evidence-log-snippet.md
next_step: Recommended immediate action
prevention_plan:
  - action: Open upstream issue for the failing dependency
    scope: project
    sink: upstream-issue
    owner: parent agent
    evidence: ./findings.md
  - action: Pin the dependency and add a retry in CI
    scope: project
    sink: code
    owner: drill
    evidence: ./ci-log.md
```

## Supporting document template

Adjacent evidence or research documents live in their own directory-plus-file unit so they remain addressable outside a single drill:

```text
sql-plan-capture/
  sql-plan-capture.md
```

```md
---
type: document
kind: evidence
created_at: 2026-07-11T13:22:40Z
source: postgres-explain
related_drills:
  - ../2026-07-11-132105-a1b2c3-api-debug.md
---

# Summary

Short description of the artifact.

# Content

Captured logs, excerpts, SQL plans, traces, screenshots, or notes.

# Notes

Why this artifact matters.
```

## Session block fields

| Field | Meaning |
|-------|---------|
| `agent_id` | which agent owns this drill |
| `role` | `orchestrator` or `subagent` |
| `session_id` | unique session identifier |
| `parent_session_id` | spawning session when delegated |
| `spawned_by` | agent that created this drill (e.g. `orchestrator`) |
| `mode` | `direct` / `delegated` / `resumed` |
| `resume_command` | human or CLI command to restore |
| `resume_uri` | URI-like pointer to the runtime session |

This frontmatter is the **only** place session provenance is stored. `.drills/cursor` says "which drill is current"; the session block says "which agent session owns this drill".

## Example root + nested workflow

Root:

```text
/drill {
  goal="Diagnose intermittent API 500s",
  scope="Only production orders API failures from the last 24h",
  problem="500s occur during concurrency spikes",
  delegate=auto,
  trace=light,
  slug="api-debug",
  prevention=required
}
```

Frontmatter:

```yaml
session:
  agent_id: orchestrator
  role: orchestrator
  session_id: sess_01jz8n4x7e
  parent_session_id: null
  spawned_by: null
  mode: direct
```

Nested narrowing step:

```text
/drill {
  goal="Test whether slow SQL causes request timeouts",
  scope="Only query latency and lock behavior for order lookup",
  delegate=always,
  slug="db-optim"
}
```

Nested frontmatter:

```yaml
session:
  agent_id: db-investigator
  role: subagent
  session_id: sess_01jz8n4y2f
  parent_session_id: sess_01jz8n4x7e
  spawned_by: orchestrator
  mode: delegated
  resume_command: /agents resume sess_01jz8n4y2f
  resume_uri: agent://db-investigator/sessions/sess_01jz8n4y2f
```

Return:

```text
/undrill --merge=structured
```

Equivalent:

```text
/drill { direction = up, merge=structured, trace=light }
```
