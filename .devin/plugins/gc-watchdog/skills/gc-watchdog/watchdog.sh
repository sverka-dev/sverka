#!/bin/bash
# gc-watchdog — periodic Gas City health monitor with self-healing.
#
# Checks gc status, bd list, session health, Dolt health, API health, and
# critical infrastructure agents. Detects stuck/stale agents, Dolt issues,
# unclaimed work, and mayor prompts. Attempts self-healing before reporting.
# Exits when there is no more open real work and no health warnings.
#
# Usage: bash watchdog.sh [interval_seconds]
# Default interval: 60 seconds.

set -uo pipefail

INTERVAL="${1:-60}"
if ! [[ "$INTERVAL" =~ ^[1-9][0-9]*$ ]]; then
  echo "ERROR: interval must be a positive integer, got: $INTERVAL" >&2
  exit 2
fi
ITER=0

# --- helpers ---
# test-source-begin

# Count real issues by status using JSON output.
# Returns -1 on failure (distinct from a legitimate 0 count) so the
# caller can distinguish "no work" from "lookup failed".
count_real_issues() {
  local status="$1"
  local raw
  if ! raw=$(timeout 10 bd list --status="$status" --json 2>/dev/null); then
    printf -- '-1\n'
    return 1
  fi
  printf '%s\n' "$raw" | python3 -c "
import json, sys
try:
  data = json.load(sys.stdin)
  if not isinstance(data, list):
    print(-1)
    sys.exit(1)
  def _is_real(bid):
    if not bid.startswith('sv-'):
      return False
    # Exclude ephemeral wisp/nudge sessions: exact match or hyphen-suffixed
    # (sv-wisp, sv-wisp-123, sv-nudge, sv-nudge-456) but NOT sv-wispish
    for prefix in ('sv-wisp', 'sv-nudge'):
      if bid == prefix or bid.startswith(prefix + '-'):
        return False
    return True
  count = sum(1 for b in data
              if isinstance(b, dict) and _is_real(b.get('id','')))
  print(count)
except Exception:
  print(-1)
  sys.exit(1)
" 2>/dev/null
}

# Get open bead IDs with age (for unclaimed-work detection).
# Output lines: bid|assignee|priority|title|age_seconds
# Returns nonzero on command or parse failure.
get_open_bead_ids() {
  local raw
  if ! raw=$(timeout 10 bd list --status=open --json 2>/dev/null); then
    return 1
  fi
  printf '%s\n' "$raw" | python3 -c "
import json, sys, time
from datetime import datetime
try:
  data = json.load(sys.stdin)
  if not isinstance(data, list):
    sys.exit(1)
  def _is_real(bid):
    if not bid.startswith('sv-'):
      return False
    for prefix in ('sv-wisp', 'sv-nudge'):
      if bid == prefix or bid.startswith(prefix + '-'):
        return False
    return True
  now = time.time()
  for b in data:
    bid = b.get('id','')
    if _is_real(bid):
      assignee = b.get('assignee','') or ''
      priority = str(b.get('priority','') or '')
      title = b.get('title','') or ''
      created = (b.get('created') or b.get('created_at')
                 or b.get('createdAt') or b.get('ctime') or '')
      age = -1
      if created:
        try:
          dt = datetime.fromisoformat(str(created).replace('Z','+00:00'))
          age = int(now - dt.timestamp())
        except Exception:
          age = -1
      print(f'{bid}|{assignee}|{priority}|{title}|{age}')
except Exception:
  sys.exit(1)
"
}

# Get in-progress bead IDs with assignees.
# Returns nonzero on command or parse failure.
get_inprogress_beads() {
  local raw
  if ! raw=$(timeout 10 bd list --status=in_progress --json 2>/dev/null); then
    return 1
  fi
  printf '%s\n' "$raw" | python3 -c "
import json, sys
try:
  data = json.load(sys.stdin)
  if not isinstance(data, list):
    sys.exit(1)
  def _is_real(bid):
    if not bid.startswith('sv-'):
      return False
    for prefix in ('sv-wisp', 'sv-nudge'):
      if bid == prefix or bid.startswith(prefix + '-'):
        return False
    return True
  for b in data:
    bid = b.get('id','')
    if _is_real(bid):
      assignee = b.get('assignee','') or ''
      print(f'{bid}|{assignee}')
except Exception:
  sys.exit(1)
"
}

# Get active session IDs
get_session_ids() {
  timeout 10 gc session list 2>/dev/null \
    | awk '/^sv-wisp-/ {print $1}' || true
}

# Check if a session ID exists.
# Returns: 0 = exists, 1 = confirmed absent, 2 = lookup timeout/error.
# Returning 2 (instead of 1) on timeout prevents reopening legitimately
# assigned work during a transient control-plane outage.
session_exists() {
  local sid="$1"
  local sess_list
  if ! sess_list=$(timeout 10 gc session list 2>/dev/null); then
    return 2
  fi
  printf '%s\n' "$sess_list" | awk '{print $1}' | grep -qx "$sid" && return 0 || return 1
}

# Find mayor session ID
get_mayor_session_id() {
  timeout 10 gc session list 2>/dev/null \
    | awk '$2 == "mayor" && $3 == "active" {print $1; exit}' || true
}

# Convert a duration string like "2m", "1h", "30s", "2d" to minutes.
_duration_to_minutes() {
  local dur="$1"
  local num unit
  num="${dur//[!0-9]/}"
  unit="${dur//[0-9]/}"
  case "$unit" in
    s) echo $(( num / 60 )) ;;
    m) echo "$num" ;;
    h) echo $(( num * 60 )) ;;
    d) echo $(( num * 1440 )) ;;
    *) echo 0 ;;
  esac
}

# test-source-end

# --- self-healing actions ---

# Each fix_* function runs its repair command, re-checks the condition,
# and emits a FIXED line only after recovery is confirmed. On failure it
# emits an ESCALATE line instead. The caller captures stdout into the
# FIXED_ACTIONS array.

fix_dolt_port() {
  local dolt_port=""
  # Try config file first
  if [[ -f ".gc/runtime/packs/dolt/dolt-config.yaml" ]]; then
    dolt_port=$(grep -E '^\s*port:' ".gc/runtime/packs/dolt/dolt-config.yaml" | head -1 | grep -oE '[0-9]+' || true)
  fi
  # Fallback: find listening dolt process
  if [[ -z "$dolt_port" ]]; then
    dolt_port=$(ss -tlnp 2>/dev/null | grep dolt | grep -oE ':[0-9]+' | head -1 | tr -d ':' || true)
  fi
  if [[ -n "$dolt_port" ]]; then
    bd dolt set port "$dolt_port" >/dev/null 2>&1 || true
    # Re-test after fix — only report FIXED if dolt test passes
    if timeout 10 bd dolt test >/dev/null 2>&1; then
      echo "FIXED dolt-degraded -> bd dolt set port $dolt_port"
      return 0
    else
      echo "ESCALATE dolt-degraded -> port set to $dolt_port but dolt test still failing"
      return 1
    fi
  else
    echo "ESCALATE dolt-down -> no dolt process found, manual intervention needed"
    return 1
  fi
}

fix_stuck_session() {
  local sid="$1"
  if gc session close "$sid" >/dev/null 2>&1; then
    echo "FIXED agent-stuck:$sid -> gc session close $sid"
    return 0
  else
    echo "ESCALATE agent-stuck:$sid -> gc session close failed"
    return 1
  fi
}

fix_zombie_session() {
  local sid="$1"
  if gc session close "$sid" >/dev/null 2>&1; then
    echo "FIXED agent-zombie:$sid -> gc session close $sid"
    return 0
  else
    echo "ESCALATE agent-zombie:$sid -> gc session close failed"
    return 1
  fi
}

fix_orphaned_work() {
  local bid="$1"
  # Clear dead assignee so the bead can be re-claimed, then reopen
  bd update "$bid" --unassign >/dev/null 2>&1 || true
  if bd update "$bid" --status=open >/dev/null 2>&1; then
    echo "FIXED orphaned-work:$bid -> bd update --unassign + --status=open"
    return 0
  else
    echo "ESCALATE orphaned-work:$bid -> bd update failed"
    return 1
  fi
}

# Nudge the mayor about unclaimed work using gc session nudge (not
# gc session submit --intent interrupt_now, which is reserved for
# answering pending mayor prompts per SKILL.md).
nudge_mayor_about_work() {
  local mayor_sid="$1"
  local work_list="$2"
  if [[ -n "$mayor_sid" ]]; then
    gc session nudge mayor "P1 beads unclaimed for >1h: ${work_list}. Please dispatch builders." >/dev/null 2>&1
    return $?
  fi
  return 1
}

# --- main loop ---

while true; do
  ITER=$((ITER + 1))
  TS=$(date '+%H:%M:%S')
  FIXED_ACTIONS=()
  ISSUES=""

  # 1. gc status
  STATUS=$(timeout 15 gc status 2>/dev/null || true)
  if [[ -z "$STATUS" ]]; then
    echo "[$TS] #$ITER WARN api-down | gc status timeout"
    sleep "$INTERVAL"
    continue
  fi

  MAYOR=$(printf '%s\n' "$STATUS" | awk '/^harness\.mayor / {print $2; exit}')
  SESSIONS=$(printf '%s\n' "$STATUS" | awk '/^Sessions:/ {print; exit}')
  SUSPENDED=$(printf '%s\n' "$STATUS" | awk '/^Suspended:/ {print $2; exit}')

  [[ -z "$MAYOR" ]] && ISSUES="$ISSUES mayor-missing"
  if [[ -n "$MAYOR" && "$MAYOR" != "awake" && "$MAYOR" != "running" && "$MAYOR" != "active" ]]; then
    ISSUES="$ISSUES mayor:$MAYOR"
  fi
  # Treat missing Suspended field as an issue, not a healthy default
  if [[ -z "${SUSPENDED:-}" ]]; then
    ISSUES="$ISSUES suspended-unknown"
  elif [[ "$SUSPENDED" != "no" ]]; then
    ISSUES="$ISSUES suspended"
  fi

  # 1b. API health probe — verify the HTTP endpoint, not just gc status
  if ! timeout 5 curl -sf --max-time 3 http://127.0.0.1:8372/health >/dev/null 2>&1; then
    ISSUES="$ISSUES api-down"
  fi

  # 2. Dolt health
  if ! timeout 10 bd dolt test >/dev/null 2>&1; then
    ISSUES="$ISSUES dolt-degraded"
    # Self-heal: check if dolt is running and fix port
    if pgrep -f "dolt sql-server" >/dev/null 2>&1; then
      FIX_OUT=$(fix_dolt_port)
      if [[ -n "$FIX_OUT" ]]; then
        FIXED_ACTIONS+=("$FIX_OUT")
        # Remove dolt-degraded from ISSUES only if fix succeeded
        if echo "$FIX_OUT" | grep -q "^FIXED"; then
          ISSUES="${ISSUES// dolt-degraded/}"
          ISSUES="${ISSUES/#dolt-degraded/}"
        fi
      fi
    else
      ISSUES="$ISSUES dolt-down"
    fi
  fi

  # 3. Beads work count
  OPEN_COUNT=$(count_real_issues "open")
  OPEN_FAILED=$?
  INPROG_COUNT=$(count_real_issues "in_progress")
  INPROG_FAILED=$?

  if [[ "$OPEN_FAILED" -ne 0 || "$INPROG_FAILED" -ne 0 ]]; then
    ISSUES="$ISSUES bd-lookup-failed"
  fi

  # 4. Unclaimed work detection (P1 open > 1h with no assignee)
  MAYOR_SID=$(get_mayor_session_id)
  UNCLAIMED=""
  BEAD_LOOKUP_FAILED=0
  if [[ "$OPEN_COUNT" -gt 0 && "$OPEN_FAILED" -eq 0 ]]; then
    OPEN_BEADS_OUT=""
    if ! OPEN_BEADS_OUT=$(get_open_bead_ids); then
      BEAD_LOOKUP_FAILED=1
      ISSUES="$ISSUES bd-lookup-failed"
    fi
    if [[ "$BEAD_LOOKUP_FAILED" -eq 0 ]]; then
      while IFS='|' read -r bid assignee priority title age; do
        [[ -z "$bid" ]] && continue
        if [[ -z "$assignee" ]]; then
          # Only flag P1 beads older than 1 hour (3600 seconds)
          if [[ "$priority" == "1" && "${age:-0}" -gt 3600 ]]; then
            age_min=$((age / 60))
            UNCLAIMED="$UNCLAIMED $bid(${age_min}m)"
            ISSUES="$ISSUES unclaimed-work:$bid:${age_min}m"
          fi
        fi
      done <<< "$OPEN_BEADS_OUT"
      if [[ -n "$UNCLAIMED" ]]; then
        if nudge_mayor_about_work "$MAYOR_SID" "$UNCLAIMED"; then
          FIXED_ACTIONS+=("FIXED unclaimed-work -> gc session nudge mayor")
        else
          FIXED_ACTIONS+=("ESCALATE unclaimed-work -> nudge mayor failed")
        fi
      fi
    fi
  fi

  # 5. Orphaned work detection
  if [[ "$INPROG_COUNT" -gt 0 && "$INPROG_FAILED" -eq 0 ]]; then
    INPROG_BEADS_OUT=""
    if ! INPROG_BEADS_OUT=$(get_inprogress_beads); then
      BEAD_LOOKUP_FAILED=1
      ISSUES="$ISSUES bd-lookup-failed"
    fi
    if [[ "$BEAD_LOOKUP_FAILED" -eq 0 ]]; then
      while IFS='|' read -r bid assignee; do
        [[ -z "$bid" ]] && continue
        if [[ -n "$assignee" ]]; then
          session_exists "$assignee"
          sess_rc=$?
          if [[ "$sess_rc" -eq 1 ]]; then
            # Confirmed absent — orphaned
            ISSUES="$ISSUES orphaned-work:$bid"
            FIX_OUT=$(fix_orphaned_work "$bid")
            [[ -n "$FIX_OUT" ]] && FIXED_ACTIONS+=("$FIX_OUT")
          elif [[ "$sess_rc" -eq 2 ]]; then
            # Timeout/error — don't reopen, flag lookup failure
            ISSUES="$ISSUES session-lookup-failed"
          fi
        fi
      done <<< "$INPROG_BEADS_OUT"
    fi
  fi

  # 6. Session health
  SESS_LIST=""
  if ! SESS_LIST=$(timeout 10 gc session list 2>/dev/null); then
    ISSUES="$ISSUES session-lookup-failed"
  fi
  if [[ -n "$SESS_LIST" ]]; then
    while read -r sid tmpl state reason rest; do
      [[ -z "$sid" ]] && continue
      [[ "$sid" != sv-wisp-* ]] && continue

      # user-hold = stuck on authorization
      if echo "$reason" | grep -q "user-hold"; then
        if [[ "$tmpl" != "mayor" ]]; then
          ISSUES="$ISSUES agent-stuck:$sid"
          FIX_OUT=$(fix_stuck_session "$sid")
          [[ -n "$FIX_OUT" ]] && FIXED_ACTIONS+=("$FIX_OUT")
        else
          ISSUES="$ISSUES mayor-stuck:$sid"
        fi
      fi

      # zombie = asleep + killed
      if [[ "$state" == "asleep" ]] && echo "$reason" | grep -q "killed"; then
        ISSUES="$ISSUES agent-zombie:$sid"
        FIX_OUT=$(fix_zombie_session "$sid")
        [[ -n "$FIX_OUT" ]] && FIXED_ACTIONS+=("$FIX_OUT")
      fi

      # stale = active but LAST ACTIVE > 60m
      if [[ "$state" == "active" ]]; then
        last_active=$(printf '%s\n' "$rest" | tr ' ' '\n' | grep -E '^[0-9]+[smhd]$' | head -1 || true)
        if [[ -n "$last_active" ]]; then
          last_mins=$(_duration_to_minutes "$last_active")
          if [[ "$last_mins" -gt 60 ]]; then
            ISSUES="$ISSUES agent-stale:$sid"
            # Self-heal: kill the session so it can restart
            if gc session kill "$sid" >/dev/null 2>&1; then
              FIXED_ACTIONS+=("FIXED agent-stale:$sid -> gc session kill $sid")
            else
              FIXED_ACTIONS+=("ESCALATE agent-stale:$sid -> gc session kill failed")
            fi
          fi
        fi
      fi
    done <<< "$SESS_LIST"
  fi

  # 7. Critical infrastructure agents
  # Only flag when there is work that requires the agent AND it is not running.
  if [[ -n "$SESS_LIST" && ( "$OPEN_COUNT" -gt 0 || "$INPROG_COUNT" -gt 0 ) ]]; then
    # Check for routed work needing bd.dog
    ROUTED_WORK=$(timeout 10 bd list --status=open --json 2>/dev/null \
      | python3 -c "
import json, sys
try:
  data = json.load(sys.stdin)
  if not isinstance(data, list):
    print(0)
  else:
    routed = sum(1 for b in data
                 if isinstance(b, dict)
                 and b.get('id','').startswith('sv-')
                 and ('routed_to' in b or 'gc.routed_to' in b
                      or 'routed_to' in b.get('metadata',{})))
    print(routed)
except Exception:
  print(0)
" 2>/dev/null || true)
    if [[ "${ROUTED_WORK:-0}" -gt 0 ]]; then
      if ! printf '%s\n' "$SESS_LIST" | grep -q "bd\.dog"; then
        ISSUES="$ISSUES bd.dog-down"
        # Self-heal: nudge mayor, then try gc sling, then ad-hoc session
        if [[ -n "$MAYOR_SID" ]]; then
          gc session nudge mayor "bd.dog pool is stopped with open routed work. Please dispatch." >/dev/null 2>&1 || true
        fi
        if ! gc sling bd.dog "check dolt health" --no-attach >/dev/null 2>&1; then
          # Fallback: create an ad-hoc session (not pool-managed but provides coverage)
          if gc session new bd.dog --no-attach >/dev/null 2>&1; then
            FIXED_ACTIONS+=("FIXED bd.dog-down -> gc session new bd.dog --no-attach")
          else
            FIXED_ACTIONS+=("ESCALATE bd.dog-down -> nudge+sling+new all failed")
          fi
        else
          FIXED_ACTIONS+=("FIXED bd.dog-down -> gc sling bd.dog --no-attach")
        fi
      fi
    fi
    # Check builder pool when there's open work
    if [[ "$OPEN_COUNT" -gt 0 ]]; then
      if ! printf '%s\n' "$SESS_LIST" | grep -q "builder"; then
        ISSUES="$ISSUES builder-pool-down"
        # Self-heal: nudge mayor to dispatch builders
        if [[ -n "$MAYOR_SID" ]]; then
          if gc session nudge mayor "Builder pool is stopped with $OPEN_COUNT open tasks. Please dispatch builders." >/dev/null 2>&1; then
            FIXED_ACTIONS+=("FIXED builder-pool-down -> gc session nudge mayor")
          else
            FIXED_ACTIONS+=("ESCALATE builder-pool-down -> nudge mayor failed")
          fi
        fi
      fi
    fi
  fi

  # Check control-dispatcher only if formula_v2 is true
  FORMULA_V2=""
  if [[ -f "city.toml" ]]; then
    FORMULA_V2=$(grep -E '^\s*formula_v2\s*=' city.toml 2>/dev/null | grep -oE 'true|false' | head -1 || true)
  fi
  if [[ "$FORMULA_V2" == "true" ]]; then
    V2_WORKFLOWS=$(timeout 10 bd list --status=in_progress --json 2>/dev/null \
      | python3 -c "
import json, sys
try:
  data = json.load(sys.stdin)
  if not isinstance(data, list):
    print(0)
  else:
    wf = sum(1 for b in data
             if isinstance(b, dict)
             and (b.get('metadata',{}).get('gc.kind','') == 'workflow'
                  or b.get('gc.kind','') == 'workflow'))
    print(wf)
except Exception:
  print(0)
" 2>/dev/null || true)
    if [[ "${V2_WORKFLOWS:-0}" -gt 0 ]]; then
      if ! printf '%s\n' "$SESS_LIST" | grep -q "control-dispatcher"; then
        ISSUES="$ISSUES control-dispatcher-down"
        # Self-heal: start control-dispatcher, wait 15s, recheck
        if gc session new core.control-dispatcher --no-attach >/dev/null 2>&1; then
          sleep 15
          if timeout 10 gc session list 2>/dev/null | grep -q "control-dispatcher"; then
            FIXED_ACTIONS+=("FIXED control-dispatcher-down -> gc session new core.control-dispatcher --no-attach")
          else
            FIXED_ACTIONS+=("ESCALATE control-dispatcher-down -> started but not visible after 15s")
          fi
        else
          FIXED_ACTIONS+=("ESCALATE control-dispatcher-down -> gc session new failed")
        fi
      fi
    fi
  fi

  # 8. Mayor prompt check
  if [[ -n "$MAYOR_SID" ]]; then
    PEEK=$(timeout 10 gc session peek "$MAYOR_SID" 2>/dev/null || true)
    if echo "$PEEK" | grep -q "Press Enter to send\|authorize\|Authorization\|❯.*❯"; then
      # Mayor has a pending prompt — extract it
      PROMPT_SUMMARY=$(echo "$PEEK" | grep -E "❭|authorize|Authorize|Press Enter" | head -3 | tr '\n' ' ' | head -c 120)
      ISSUES="$ISSUES mayor-prompt"
      # In script mode we can only report — agent mode handles auto-respond
      FIXED_ACTIONS+=("RELAY mayor-prompt -> user: $PROMPT_SUMMARY")
    fi
  fi

  # 9. Report
  if [[ -n "$ISSUES" ]]; then
    echo "[$TS] #$ITER WARN$ISSUES | open:$OPEN_COUNT in_progress:$INPROG_COUNT | ${SESSIONS:-no-sessions}"
  else
    echo "[$TS] #$ITER OK mayor:$MAYOR | open:$OPEN_COUNT in_progress:$INPROG_COUNT | ${SESSIONS:-no-sessions}"
  fi

  # Print fixed actions — each complete action as one report line
  if [[ "${#FIXED_ACTIONS[@]}" -gt 0 ]]; then
    for action in "${FIXED_ACTIONS[@]}"; do
      echo "[$TS] #$ITER $action"
    done
  fi

  # 10. Exit condition
  if [[ "$OPEN_COUNT" -eq 0 && "$INPROG_COUNT" -eq 0 && -z "$ISSUES" ]]; then
    echo "[$TS] #$ITER IDLE — no open work, no in-progress work. Watchdog exiting."
    exit 0
  fi

  sleep "$INTERVAL"
done
