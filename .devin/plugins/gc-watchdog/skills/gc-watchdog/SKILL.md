---
name: gc-watchdog
description: >
  Periodic Gas City health monitor with self-healing. Checks gc status, bd list,
  agent sessions, Dolt health, and critical infrastructure agents. Detects
  stuck/stale agents, stopped watchdogs, Dolt circuit breaker, and missing
  control dispatch. Attempts to fix problems before reporting them. Exits when
  no more open work.
---

# GC Watchdog

Periodic Gas City health monitor with self-healing. Checks `gc status`,
`bd list`, agent sessions, Dolt health, and critical infrastructure agents.
Detects stuck/stale agents, stopped watchdogs, Dolt circuit breaker, and
missing control dispatch. Attempts to fix problems before reporting them.
Exits when no more open work.

## When to use

- User asks to "watch" or "monitor" Gas City while work is in progress
- User wants periodic status reports during a long-running wave
- User wants to know when the city goes idle (all work done)
- User wants the city to be self-healing during unattended operation

## Check cycle

Each tick runs these checks in order. Self-healing actions are taken
immediately when a problem is detected, before reporting.

### 1. City status

```bash
gc status
```

Extract: mayor status, suspended state, controller PID, store health,
agent pool states, named session states.

### 2. Beads work count and state

```bash
bd list --status=open        # count real open issues (exclude wisp/nudge)
bd list --status=in_progress # count real in-progress issues (exclude wisp/nudge)
```

If `bd` fails with "circuit breaker open" or "connection refused", flag
`dolt-degraded` and apply the Dolt self-healing action below.

For each open bead, check:
- **Unclaimed P1 open > 1h**: A P1 task sitting open with no assignee for
  more than 1 hour means the mayor isn't dispatching. Flag
  `unclaimed-work:<id>:<age>`. Apply the nudge-mayor self-healing action.
- **In-progress but assignee is dead**: If an in_progress bead is assigned
  to a session that no longer exists in `gc session list`, flag
  `orphaned-work:<id>`. The bead is stuck — the assignee is gone.
  Apply the re-queue self-healing action.

Report each unclaimed/orphaned bead in the WARN line, not just counts.

### 3. Session health and agent prompts

```bash
gc session list
```

For each session, check:
- **REASON containing "user-hold"**: agent is blocked on authorization.
  Flag `agent-stuck:<id>`. Apply the stuck-agent self-healing action.
- **LAST ACTIVE > 60m** (for active sessions): agent may be hung.
  Flag `agent-stale:<id>`. Apply the stale-agent self-healing action.
- **STATE "asleep" with REASON "killed"**: zombie session.
  Flag `agent-zombie:<id>`. Apply the zombie cleanup action.

For the **mayor** session specifically, also check for pending prompts:

```bash
gc session peek <mayor-session-id>
```

If the mayor is showing an inline question/prompt (waiting for user input),
the watchdog must relay it to the user. There are two cases:

**Case 1: Answer is obvious (auto-respond)**
If the watchdog can determine the answer from current state (e.g., the work
the mayor is asking about was already done by the watchdog or another agent),
respond on behalf of the user and report a FIXED line. Examples:
- Mayor asks to authorize a push that was already done -> "Already pushed, discard your local changes"
- Mayor asks about a status that the watchdog just checked -> relay the current status

NEVER auto-respond to merge-related prompts. PR merges are the user's decision
only. Always relay merge prompts to the user via `ask_user_question`.

To auto-respond, use `gc session submit` with `--intent interrupt_now`:
```bash
gc session submit <mayor-session-id> "<answer>" --intent interrupt_now
```

`interrupt_now` bypasses the inline prompt and injects the message directly.
Do NOT use `gc session nudge` for prompts -- it queues behind the prompt and
the mayor never sees it. `submit --intent interrupt_now` is the only way to
answer an inline prompt without attaching to the session.

**Case 2: Answer requires user decision (relay to user)**
If the prompt requires a real decision (e.g., "should we change the architecture?",
"which approach do you prefer?"), present it to the user interactively using
`ask_user_question`. Once the user answers, relay it back to the mayor:
```bash
gc session submit <mayor-session-id> "<user's answer>" --intent interrupt_now
```

Always report mayor prompts in the tick report, even when auto-responding:
```text
[HH:MM:SS] FIXED mayor-prompt -> auto-responded: "<summary>" | open:3 in_progress:1
[HH:MM:SS] RELAY mayor-prompt -> user: "<question summary>" | open:3 in_progress:1
```

### 4. Critical infrastructure agents

Check infrastructure agents. There are two types. Being stopped is often
normal -- only flag if there is work that requires them.

**Pool agents** (scaled, show in `gc status` under "Agents:"):

| Agent | Purpose | When stopped is normal | When to flag |
|-------|---------|------------------------|--------------|
| `bd.dog` (pool, 0-2) | Beads/Dolt health monitor | No routed work AND gc supervisor's built-in dolt watchdog is running (check `ps aux \| grep dolt-scope-watchdog`) | Routed work exists (`gc.routed_to` labels on beads) but pool won't wake |
| `builder` (pool, 0-unlimited) | Worker pool | No open/in-progress work | Open work exists but mayor can't dispatch builders |

**Control dispatcher** (infrastructure):

Routes control beads in v2 formula graphs. Only flag if `formula_v2 = true`
in `city.toml` AND there are active v2 formula workflow beads (beads with
`gc.kind: workflow` in `in_progress` state). For simple task dispatch
(mayor nudging builders), control-dispatcher is not needed.

Check if stopped agents should be running:
```bash
# Are there routed beads waiting for a pool?
bd list --status=open --json   # look for gc.routed_to labels

# Are there active v2 formula workflows?
bd list --status=in_progress --json  # look for gc.kind: workflow

# Is gc's built-in dolt watchdog covering for bd.dog?
ps aux | grep dolt-scope-watchdog
```

Only flag `<agent-name>-down` if there is work that requires the agent
AND it is not running. Otherwise, stopped is normal.

### 5. Dolt health

```bash
bd dolt test
```

If this fails:
- Check if a dolt process is running: `ps aux | grep "dolt sql-server"`
- If running, find its port: `ss -tlnp | grep dolt` or check
  `.gc/runtime/packs/dolt/dolt-config.yaml` for the `listener.port`
- If bd is pointing at the wrong port, fix with `bd dolt set port <N>`
- If no dolt process exists, the gc supervisor should restart it --
  wait 30s and recheck. If still down after 30s, flag `dolt-down`.

### 6. API probe

```bash
curl -s --max-time 3 http://127.0.0.1:8372/health
```

If no response, flag `api-down`. This requires manual intervention (gc restart).

## Self-healing actions

The watchdog attempts to fix problems before reporting them.

### agent-stuck (user-hold) -- pool/on_demand sessions

For builder/reviewer/architect sessions (on_demand or pool):

```bash
gc session close <id>    # close permanently -- kill alone just restarts it
```

`gc session kill` terminates the runtime but keeps the session bead active,
so the reconciler restarts it. `gc session close` closes the bead itself,
preventing restart. The mayor will dispatch a fresh session when needed.

### agent-stuck (user-hold) -- always-on named sessions

For `mode = "always"` sessions (e.g., mayor), `gc session close` is
REJECTED while the `[[named_session]]` config entry exists. To permanently
stop an always-on session that is stuck:

1. Remove or comment out the `[[named_session]]` entry in `pack.toml`
2. Wait for the reconciler to downgrade the session from canonical to ordinary
3. Then `gc session close <id>`

This is rarely needed -- always-on sessions should be fixed, not closed.
For mayor stuck on user-hold, investigate the authorization prompt instead.

### agent-stale (LAST ACTIVE > 60m)

```bash
gc session kill <id>     # kill first, see if it recovers
```

If the session comes back as `user-hold` after kill, close it:
```bash
gc session close <id>
```

### agent-zombie (asleep + killed)

```bash
gc session close <id>    # clean up the zombie
```

### pool-agent-down (bd.dog stopped with open work)

Pool agents with `min=0` are started by the orchestrator when `scale_check`
detects demand. If they're stopped with open work, the cold-pool wake probe
may be failing. Do NOT use `gc session new` -- that creates an ad-hoc session
outside the pool's scaling logic. Instead:

1. Check if there is routed work: `bd list --status=open` with `gc.routed_to` labels
2. If work exists but the pool isn't waking, nudge the mayor:
   ```bash
   gc session nudge mayor "bd.dog pool is stopped with open work. Please dispatch."
   ```
3. If no routed work exists, route some:
   ```bash
   gc sling bd.dog "check dolt health" --no-attach
   ```

If `gc sling` is not available or the pool still won't wake, create an ad-hoc
session as a fallback (this is NOT pool-managed but provides temporary coverage):
```bash
gc session new bd.dog --no-attach
```

### control-dispatcher-down

Only critical if v2 formulas are in use. Check if the city uses `formula_v2`:
```bash
grep "formula_v2" city.toml
```

If `formula_v2 = true` and control-dispatcher is stopped:
```bash
gc session new core.control-dispatcher --no-attach
```

Wait 15s for the reconciler to start it, then verify.

If `formula_v2` is not set or false, control-dispatcher being stopped is
not critical -- simple nudges and builder dispatch work without it.

### dolt-degraded (port mismatch)

If `bd dolt test` fails but a dolt server is running:
```bash
# Find the gc-managed dolt port
grep "port:" .gc/runtime/packs/dolt/dolt-config.yaml
# or
ss -tlnp | grep dolt

# Reconnect bd to the gc-managed server
bd dolt set port <N>
bd dolt test
```

### dolt-degraded (circuit breaker open)

The circuit breaker opens when bd can't reach the dolt server. Fix the
underlying connection (port mismatch above) and the breaker resets
automatically on the next successful connection.

### After any self-healing action

Re-run the check to confirm the fix worked. Report both the problem and
the action taken. If the fix didn't work, escalate in the report.

### unclaimed-work (P1 open > 1h with no assignee)

The mayor should be dispatching builders for P1 tasks. If it's not:

```bash
gc session nudge mayor "P1 beads unclaimed for >1h: <list bead IDs and titles>. Please dispatch builders."
```

Wait 60s and recheck. If still unclaimed after nudge, escalate to user
in the report -- the mayor may be stuck or unable to dispatch.

### orphaned-work (in_progress but assignee is dead)

If a bead is in_progress but its assignee session no longer exists:

```bash
# Unassign the bead so it can be re-claimed
bd update <id> --unassign
# Or close and reopen to reset state
bd update <id> --status=open
```

Then nudge the mayor to re-dispatch:
```bash
gc session nudge mayor "Bead <id> was orphaned (assignee died). Re-dispatching."
```

## Exit conditions

The watchdog stops when ALL of these are true:

1. No open real tasks (`bd list --status=open` returns no real issues)
2. No in-progress real tasks (`bd list --status=in_progress` returns none)
3. Mayor is awake and not suspended
4. No active health warnings (Dolt healthy, API responding, no stuck agents,
   critical infrastructure agents running or not needed)

If the mayor is down or the city is suspended, report the error and keep
running (do NOT exit on failure -- only on success).

## Reporting format

```text
[HH:MM:SS] OK mayor:<status> | open:<N> in_progress:<M> | <sessions summary>
[HH:MM:SS] WARN <issues> | open:<N> in_progress:<M> | <sessions summary>
[HH:MM:SS] FIXED <issue> -> <action> | open:<N> in_progress:<M>
[HH:MM:SS] IDLE -- no open work, no in-progress work. Watchdog exiting.
```

Issues are comma-separated in the WARN line:
```text
[11:30:00] WARN dolt-degraded,bd.dog-down,agent-stuck:sv-wisp-i9o4oz | open:1 in_progress:2 | 2/6 agents running
```

After a self-healing action, report a FIXED line:
```text
[11:30:05] FIXED agent-stuck:sv-wisp-i9o4oz -> gc session close sv-wisp-i9o4oz | open:1 in_progress:2
[11:30:10] FIXED dolt-degraded -> bd dolt set port 39322 | open:1 in_progress:2
```

If mayor is awake, not suspended, API responds, Dolt is healthy, critical
agents are running, but there is still open/in-progress work, report OK:
```text
[11:31:00] OK mayor:awake | open:1 in_progress:2 | bd.dog:active, 1 builder running
```

## Usage

### As a skill (agent-driven)

The agent reads this SKILL.md, runs the check cycle, and reports back.
Each tick is one subagent invocation: wait 60s, check, self-heal, report.

### As a standalone script

```bash
bash .devin/plugins/gc-watchdog/skills/gc-watchdog/watchdog.sh [interval_seconds]
```

Default interval: 60 seconds. Runs until idle or interrupted.

## Files

- `watchdog.sh` -- standalone shell script implementing the check cycle
- `SKILL.md` -- this file (documentation for agents)
