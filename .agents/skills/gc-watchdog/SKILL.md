---
name: gc-watchdog
description: Use when setting up a periodic Gas City health monitor. Trigger when the user asks for a watchdog, periodic status check, or monitoring loop for gc status. Covers the check cycle, exit conditions, and reporting format.
---

# GC Watchdog

Periodic Gas City health monitor. Checks `gc status` and `bd ready` on an
interval, reports issues, and exits when there is no more open work.

## When to use

- User asks to "watch" or "monitor" Gas City while work is in progress
- User wants periodic status reports during a long-running wave
- User wants to know when the city goes idle (all work done)

## Exit conditions

The watchdog stops when ALL of these are true:

1. No open real tasks: `bd list --status=open` returns no issues (excluding
   ephemeral wisp/nudge beads)
2. No in-progress workflows: no beads with `gc.kind: workflow` in
   `in_progress` state
3. Mayor is awake and not suspended (clean shutdown, not a crash)

If the mayor is down or the city is suspended, the watchdog reports the
error and keeps running (does NOT exit on failure — only on success).

## Check cycle

Each tick:

1. `gc status` — extract mayor status, sessions, suspended, controller
2. `bd list --status=open` — count real (non-wisp, non-nudge) open issues
3. `bd list --status=in_progress` — count real in-progress issues
4. Report one line
5. If no open AND no in-progress real issues → report "idle" and exit 0

## Reporting format

```
[HH:MM:SS] ✓ mayor:<status> | open:<N> in_progress:<M> | <sessions line>
[HH:MM:SS] ⚠ <issues> | open:<N> in_progress:<M> | <sessions line>
[HH:MM:SS] IDLE — no open work, no in-progress work. Watchdog exiting.
```

## Usage

### As a skill (agent-driven)

The agent reads this SKILL.md, runs the check script, and reports back.
Each tick is one subagent invocation: wait 60s, check, report.

### As a standalone script

```bash
bash .agents/skills/gc-watchdog/watchdog.sh [interval_seconds]
```

Default interval: 60 seconds. Runs until idle or interrupted.

## Files

- `watchdog.sh` — standalone shell script implementing the check cycle
- `SKILL.md` — this file (documentation for agents)
