# Drill Troubleshooting and Edge Cases

Validation rules, error handling, and edge cases for the drill primitive.

## Validation rules

Before creating a **downward** drill:

- Active parent frame exists (unless this is a root drill).
- The new goal is strictly narrower than the parent goal.
- The child inherits only selected context, not the full parent transcript.
- The slug is present and filename-safe.
- The generated name is unique within the target `.drills/` directory.

Before moving **upward**:

- The current drill exists and is active.
- Findings or status are written.
- The return payload is present unless the drill is abandoned.
- A `prevention_plan` is present (may be empty).
- Evidence links resolve or are explicitly marked missing.

## Scope rules

A child drill is valid only when it narrows the parent scope. Allowed narrowing:

- Focusing on one subsystem within a larger system issue.
- Testing one hypothesis inside a broader problem statement.
- Inspecting one artifact class (logs, traces, schema, API responses).
- Reducing time, environment, or failure surface.

A child drill is invalid if it broadens, pivots sideways, or introduces a new top-level objective. In that case the agent must first move up, then start a fresh sibling drill from the appropriate ancestor with explicit links back to the originating drill.

## Error handling

Recommended failures:

- Reject nested drill creation if the requested work broadens the scope.
- Root `/undrill` is valid and triggers the post-drill phase once; non-root `/undrill` restores the parent frame.
- Warn when a child returns excessive raw context relative to its merge mode.
- Warn when evidence exists but is unlinked.
- Warn when a sibling drill should be created from a parent instead of from the current drill.
- Warn when a `prevention_plan` is missing for a non-trivial drill result, or when actions are listed sequentially instead of in parallel.

## State machine

| Status | Meaning |
|--------|---------|
| `open` | Created and active. |
| `blocked` | Cannot proceed — missing evidence or permissions. |
| `done` | Reached stable conclusion and was undrilled. |
| `abandoned` | Intentionally closed without full resolution. |

A downward drill creates a new `open` child. An upward drill should change the current drill to `done` or `abandoned`, stamp the closure time, and write the return payload before yielding control upward.

## Parent-child contract

Each child drill must define an explicit return contract. Minimum:

- Short answer.
- Confidence / certainty level.
- Evidence links.
- Open questions.
- Recommended next action.
- `prevention_plan` (may be empty).

A prevention plan is a set of parallel actions. It is not a single follow-up task.

Clear result contracts reduce the information loss that isolation can otherwise introduce.

## Merge policies

| Mode | Use when |
|------|----------|
| `summary` | One concise finding set; default. |
| `structured` | Machine-readable: `answer`, `confidence`, `evidence`, `next_step`, `prevention_plan`. |
| `full` | Extensive notes + trace references; deep debugging only. |

Default to `summary` or `structured` — returning too much child material defeats the purpose of context isolation.

## Trace policies

| Level | Behavior |
|-------|----------|
| `none` | No reasoning trace beyond final findings. |
| `light` | Key steps, tool actions, hypothesis changes. **Default.** |
| `full` | Exhaustive debugging trace. Opt-in — noisy. |

## Recommended options

```text
/drill {
  direction = down | up,
  goal="...",
  scope="...",
  problem="...",
  delegate=auto|never|always,
  trace=none|light|full,
  merge=summary|structured|full,
  prevention=auto|required|structured,
  evidence=link|copy|none,
  slug="..."
}
```

```text
/undrill {
  merge=summary|structured|full,
  trace=none|light|full,
  conflicts=resolve|surface|ignore
}
```

For `/drill { direction = up }` the most important flags are `merge`, `trace`, and an explicit closure note.

## Recommended defaults

- `/drill` means `/drill { direction = down }`.
- `/undrill` means `/drill { direction = up, merge=summary, trace=light }`.
- Child drills are created only when scope is strictly narrower.
- Subagents are allowed only when their inputs can be explicitly bounded.
- Upward merges return summaries, links, and evidence references — never raw transcripts.
- The filesystem tree is the canonical index.
- Every drill must have a `session` block with `agent_id` and `session_id`.
- If delegated, the child must include `parent_session_id`, `spawned_by`, and `mode: delegated`.
