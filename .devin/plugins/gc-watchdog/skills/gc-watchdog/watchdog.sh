#!/bin/bash
# gc-watchdog — periodic Gas City health monitor with self-healing.
#
# Checks gc status, bd list, session health, Dolt health, and critical
# infrastructure agents. Detects stuck/stale agents, Dolt issues, unclaimed
# work, and mayor prompts. Attempts self-healing before reporting.
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

# Filter out ephemeral wisp/nudge beads from bd output.
count_real_issues() {
  local status="$1"
  local raw
  if ! raw=$(timeout 10 bd list --status="$status" 2>/dev/null); then
    printf -- '-1\n'
    return 1
  fi
  printf '%s\n' "$raw" \
    | { grep -E '^[[:space:]]*[○◐●] sv-[a-zA-Z0-9]{3,}(\.[0-9]+)?($|[[:space:]])' || true; } \
    | { grep -vE '^[[:space:]]*[○◐●] sv-(wisp|nudge)(\.[0-9]+)?($|[[:space:]])' || true; } \
    | wc -l
}

# Get list of real open bead IDs (for unclaimed-work detection)
get_open_bead_ids() {
  timeout 10 bd list --status=open --json 2>/dev/null \
    | python3 -c "
import json, sys
try:
  data = json.load(sys.stdin)
  for b in data:
    bid = b.get('id','')
    if bid.startswith('sv-') and 'wisp' not in bid and 'nudge' not in bid:
      assignee = b.get('assignee','')
      priority = b.get('priority','')
      title = b.get('title','')
      print(f'{bid}|{assignee}|{priority}|{title}')
except: pass
" 2>/dev/null || true
}

# Get in-progress bead IDs with assignees
get_inprogress_beads() {
  timeout 10 bd list --status=in_progress --json 2>/dev/null \
    | python3 -c "
import json, sys
try:
  data = json.load(sys.stdin)
  for b in data:
    bid = b.get('id','')
    if bid.startswith('sv-') and 'wisp' not in bid and 'nudge' not in bid:
      assignee = b.get('assignee','')
      print(f'{bid}|{assignee}')
except: pass
" 2>/dev/null || true
}

# Get active session IDs
get_session_ids() {
  timeout 10 gc session list 2>/dev/null \
    | awk '/^sv-wisp-/ {print $1}' || true
}

# Check if a session ID exists
session_exists() {
  local sid="$1"
  timeout 10 gc session list 2>/dev/null | awk '{print $1}' | grep -qx "$sid"
}

# Find mayor session ID
get_mayor_session_id() {
  timeout 10 gc session list 2>/dev/null \
    | awk '$2 == "mayor" && $3 == "active" {print $1; exit}' || true
}

# --- self-healing actions ---

fix_dolt_port() {
  local dolt_port
  # Try config file first
  if [ -f ".gc/runtime/packs/dolt/dolt-config.yaml" ]; then
    dolt_port=$(grep -E '^\s*port:' ".gc/runtime/packs/dolt/dolt-config.yaml" | head -1 | grep -oE '[0-9]+' || true)
  fi
  # Fallback: find listening dolt process
  if [ -z "$dolt_port" ]; then
    dolt_port=$(ss -tlnp 2>/dev/null | grep dolt | grep -oE ':[0-9]+' | head -1 | tr -d ':' || true)
  fi
  if [ -n "$dolt_port" ]; then
    echo "FIXED dolt-degraded -> bd dolt set port $dolt_port"
    bd dolt set port "$dolt_port" >/dev/null 2>&1 || true
    bd dolt test >/dev/null 2>&1 || true
  else
    echo "ESCALATE dolt-down -> no dolt process found, manual intervention needed"
  fi
}

fix_stuck_session() {
  local sid="$1"
  echo "FIXED agent-stuck:$sid -> gc session close $sid"
  gc session close "$sid" >/dev/null 2>&1 || true
}

fix_zombie_session() {
  local sid="$1"
  echo "FIXED agent-zombie:$sid -> gc session close $sid"
  gc session close "$sid" >/dev/null 2>&1 || true
}

fix_orphaned_work() {
  local bid="$1"
  echo "FIXED orphaned-work:$bid -> bd update $bid --status=open"
  bd update "$bid" --status=open >/dev/null 2>&1 || true
}

nudge_mayor_about_work() {
  local mayor_sid="$1"
  local work_list="$2"
  if [ -n "$mayor_sid" ]; then
    echo "FIXED unclaimed-work -> gc session submit $mayor_sid (interrupt_now)"
    gc session submit "$mayor_sid" "P1 beads unclaimed for >1h: $work_list. Please dispatch builders." --intent interrupt_now >/dev/null 2>&1 || true
  fi
}

# --- main loop ---

while true; do
  ITER=$((ITER + 1))
  TS=$(date '+%H:%M:%S')
  FIXED_ACTIONS=""
  ISSUES=""

  # 1. gc status
  STATUS=$(timeout 15 gc status 2>/dev/null || true)
  if [ -z "$STATUS" ]; then
    echo "[$TS] #$ITER WARN api-down | gc status timeout"
    sleep "$INTERVAL"
    continue
  fi

  MAYOR=$(printf '%s\n' "$STATUS" | awk '/^harness\.mayor / {print $2; exit}')
  SESSIONS=$(printf '%s\n' "$STATUS" | awk '/^Sessions:/ {print; exit}')
  SUSPENDED=$(printf '%s\n' "$STATUS" | awk '/^Suspended:/ {print $2; exit}')

  [ -z "$MAYOR" ] && ISSUES="$ISSUES mayor-missing"
  [ -n "$MAYOR" ] && [ "$MAYOR" != "awake" ] && [ "$MAYOR" != "running" ] && [ "$MAYOR" != "active" ] && ISSUES="$ISSUES mayor:$MAYOR"
  [ -n "${SUSPENDED:-}" ] && [ "$SUSPENDED" != "no" ] && ISSUES="$ISSUES suspended"

  # 2. Dolt health
  if ! timeout 10 bd dolt test >/dev/null 2>&1; then
    ISSUES="$ISSUES dolt-degraded"
    # Self-heal: check if dolt is running and fix port
    if pgrep -f "dolt sql-server" >/dev/null 2>&1; then
      FIX_OUT=$(fix_dolt_port)
      [ -n "$FIX_OUT" ] && FIXED_ACTIONS="$FIXED_ACTIONS $FIX_OUT"
      # Re-test after fix
      if timeout 10 bd dolt test >/dev/null 2>&1; then
        ISSUES="${ISSUES// dolt-degraded/}"
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

  if [ "$OPEN_FAILED" -ne 0 ] || [ "$INPROG_FAILED" -ne 0 ]; then
    ISSUES="$ISSUES bd-lookup-failed"
  fi

  # 4. Unclaimed work detection
  MAYOR_SID=$(get_mayor_session_id)
  UNCLAIMED=""
  if [ "$OPEN_COUNT" -gt 0 ] && [ "$OPEN_FAILED" -eq 0 ]; then
    while IFS='|' read -r bid assignee priority title; do
      [ -z "$bid" ] && continue
      if [ -z "$assignee" ] || [ "$assignee" = "" ]; then
        if [ "$priority" = "1" ]; then
          UNCLAIMED="$UNCLAIMED $bid($title)"
        fi
      fi
    done <<< "$(get_open_bead_ids)"
    if [ -n "$UNCLAIMED" ]; then
      ISSUES="$ISSUES unclaimed-work"
      nudge_mayor_about_work "$MAYOR_SID" "$UNCLAIMED" >/dev/null 2>&1 || true
      FIXED_ACTIONS="$FIXED_ACTIONS FIXED unclaimed-work -> nudge mayor"
    fi
  fi

  # 5. Orphaned work detection
  if [ "$INPROG_COUNT" -gt 0 ] && [ "$INPROG_FAILED" -eq 0 ]; then
    while IFS='|' read -r bid assignee; do
      [ -z "$bid" ] && continue
      if [ -n "$assignee" ] && ! session_exists "$assignee"; then
        ISSUES="$ISSUES orphaned-work:$bid"
        fix_orphaned_work "$bid"
        FIXED_ACTIONS="$FIXED_ACTIONS FIXED orphaned-work:$bid -> bd update --status=open"
      fi
    done <<< "$(get_inprogress_beads)"
  fi

  # 6. Session health
  SESS_LIST=$(timeout 10 gc session list 2>/dev/null || true)
  if [ -n "$SESS_LIST" ]; then
    while read -r sid tmpl state reason rest; do
      [ -z "$sid" ] && continue
      [[ "$sid" != sv-wisp-* ]] && continue

      # user-hold = stuck on authorization
      if echo "$reason" | grep -q "user-hold"; then
        if [ "$tmpl" != "mayor" ]; then
          ISSUES="$ISSUES agent-stuck:$sid"
          fix_stuck_session "$sid"
          FIXED_ACTIONS="$FIXED_ACTIONS FIXED agent-stuck:$sid -> gc session close"
        else
          ISSUES="$ISSUES mayor-stuck:$sid"
        fi
      fi

      # zombie = asleep + killed
      if [ "$state" = "asleep" ] && echo "$reason" | grep -q "killed"; then
        ISSUES="$ISSUES agent-zombie:$sid"
        fix_zombie_session "$sid"
        FIXED_ACTIONS="$FIXED_ACTIONS FIXED agent-zombie:$sid -> gc session close"
      fi
    done <<< "$SESS_LIST"
  fi

  # 7. Mayor prompt check
  if [ -n "$MAYOR_SID" ]; then
    PEEK=$(timeout 10 gc session peek "$MAYOR_SID" 2>/dev/null || true)
    if echo "$PEEK" | grep -q "Press Enter to send\|authorize\|Authorization\|❯.*❯"; then
      # Mayor has a pending prompt — extract it
      PROMPT_SUMMARY=$(echo "$PEEK" | grep -E "❭|authorize|Authorize|Press Enter" | head -3 | tr '\n' ' ' | head -c 120)
      ISSUES="$ISSUES mayor-prompt"
      # In script mode we can only report — agent mode handles auto-respond
      FIXED_ACTIONS="$FIXED_ACTIONS RELAY mayor-prompt -> user: $PROMPT_SUMMARY"
    fi
  fi

  # 8. Report
  if [ -n "$ISSUES" ]; then
    echo "[$TS] #$ITER WARN$ISSUES | open:$OPEN_COUNT in_progress:$INPROG_COUNT | ${SESSIONS:-no-sessions}"
  else
    echo "[$TS] #$ITER OK mayor:$MAYOR | open:$OPEN_COUNT in_progress:$INPROG_COUNT | ${SESSIONS:-no-sessions}"
  fi

  # Print fixed actions
  if [ -n "$FIXED_ACTIONS" ]; then
    for action in $FIXED_ACTIONS; do
      [ -n "$action" ] && echo "[$TS] #$ITER $action"
    done
  fi

  # 9. Exit condition
  if [ "$OPEN_COUNT" -eq 0 ] && [ "$INPROG_COUNT" -eq 0 ] && [ -z "$ISSUES" ]; then
    echo "[$TS] #$ITER IDLE — no open work, no in-progress work. Watchdog exiting."
    exit 0
  fi

  sleep "$INTERVAL"
done
