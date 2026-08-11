#!/bin/bash
# gc-watchdog — periodic Gas City health monitor with exit condition.
#
# Checks gc status + bd ready on an interval. Reports issues. Exits when
# there is no more open real work (non-wisp, non-nudge) and no in-progress
# real work.
#
# Usage: bash watchdog.sh [interval_seconds]
# Default interval: 60 seconds.

# NOTE: intentionally NOT using set -e. gc status and bd list can fail
# transiently (session snapshot timeouts, store locks). We handle errors
# per-command and continue the loop.
set -uo pipefail

INTERVAL="${1:-60}"
ITER=0

# Filter out ephemeral wisp/nudge beads from bd output.
# Real issues have IDs like sv-XXXX (4 chars after sv-).
# Wisp/nudge beads have IDs like sv-wisp-XXXX or sv-nudge-XXXX.
# Status symbols: ○ = open, ◐ = in_progress, ● = blocked, ✓ = closed
count_real_issues() {
  local status="$1"
  local count
  if ! count=$(
    bd list --status="$status" 2>/dev/null \
      | grep -E '^\s*[○◐●] sv-[a-z0-9]{4} ' \
      | grep -v "wisp\|nudge" \
      | wc -l 2>/dev/null
  ); then
    printf '0\n'
    return 0
  fi
  printf '%s\n' "$count"
}

while true; do
  ITER=$((ITER + 1))
  TS=$(date '+%H:%M:%S')

  # 1. gc status
  STATUS=$(timeout 15 gc status 2>/dev/null || true)

  if [ -z "$STATUS" ]; then
    echo "[$TS] #$ITER ⚠ gc status timeout/error"
    sleep "$INTERVAL"
    continue
  fi

  MAYOR=$(echo "$STATUS" | grep "harness.mayor" | awk '{print $2}')
  SESSIONS=$(echo "$STATUS" | grep "Sessions:" | head -1 | sed 's/^ *//')
  SUSPENDED=$(echo "$STATUS" | grep "Suspended:" | awk '{print $2}')
  CONTROLLER=$(echo "$STATUS" | grep "Controller:" | grep -o "supervisor-managed\|stopped\|error" | head -1 || true)

  # Handle transient lookup errors (mayor shows "lookup" instead of "awake")
  if echo "$MAYOR" | grep -q "lookup"; then
    MAYOR="lookup-error"
  fi

  # 2. bd work counts
  OPEN_COUNT=$(count_real_issues "open")
  INPROG_COUNT=$(count_real_issues "in_progress")

  # 3. Check for issues
  ISSUES=""
  [ -z "$MAYOR" ] && ISSUES="$ISSUES MAYOR_MISSING"
  if [ -n "$MAYOR" ] && [ "$MAYOR" != "awake" ] && [ "$MAYOR" != "running" ] && [ "$MAYOR" != "active" ] && [ "$MAYOR" != "lookup-error" ]; then
    ISSUES="$ISSUES MAYOR($MAYOR)"
  fi
  # lookup-error is a transient issue, not a hard failure — report as ⚠ but don't treat as fatal
  if [ "$MAYOR" = "lookup-error" ]; then
    ISSUES="$ISSUES MAYOR_LOOKUP_TIMEOUT"
  fi
  # Treat missing status fields as unknown, not healthy defaults
  if [ -z "${SUSPENDED:-}" ]; then
    ISSUES="$ISSUES SUSPENDED_MISSING"
  elif [ "$SUSPENDED" != "no" ]; then
    ISSUES="$ISSUES SUSPENDED"
  fi
  if [ -z "${CONTROLLER:-}" ]; then
    ISSUES="$ISSUES CONTROLLER_MISSING"
  elif [ "$CONTROLLER" != "supervisor-managed" ]; then
    ISSUES="$ISSUES CONTROLLER($CONTROLLER)"
  fi

  # 4. Report
  if [ -n "$ISSUES" ]; then
    echo "[$TS] #$ITER ⚠$ISSUES | open:$OPEN_COUNT in_progress:$INPROG_COUNT | ${SESSIONS:-no-sessions}"
  else
    echo "[$TS] #$ITER ✓ mayor:$MAYOR | open:$OPEN_COUNT in_progress:$INPROG_COUNT | ${SESSIONS:-no-sessions}"
  fi

  # 5. Exit condition: no open AND no in-progress real work, mayor healthy
  # Note: lookup-error is transient, don't exit on it — only exit on clean idle
  if [ "$OPEN_COUNT" -eq 0 ] && [ "$INPROG_COUNT" -eq 0 ] && [ -z "$ISSUES" ]; then
    echo "[$TS] #$ITER IDLE — no open work, no in-progress work. Watchdog exiting."
    exit 0
  fi

  sleep "$INTERVAL"
done
