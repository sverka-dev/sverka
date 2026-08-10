#!/bin/bash
# gc-watchdog — periodic Gas City health monitor with exit condition.
#
# Checks gc status + bd ready on an interval. Reports issues. Exits when
# there is no more open real work (non-wisp, non-nudge) and no in-progress
# real work.
#
# Usage: bash watchdog.sh [interval_seconds]
# Default interval: 60 seconds.

set -euo pipefail

INTERVAL="${1:-60}"
ITER=0

# Filter out ephemeral wisp/nudge beads from bd output.
# Real issues have IDs like sv-XXXX (4 chars after sv-).
# Wisp/nudge beads have IDs like sv-wisp-XXXX or sv-nudge-XXXX.
count_real_issues() {
  local status="$1"
  bd list --status="$status" 2>/dev/null \
    | grep -E '^\s*○ sv-[a-z0-9]{4} ' \
    | grep -v "wisp\|nudge" \
    | wc -l || true
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
  CONTROLLER=$(echo "$STATUS" | grep "Controller:" | grep -o "supervisor-managed\|stopped\|error" | head -1)

  # 2. bd work counts
  OPEN_COUNT=$(count_real_issues "open")
  INPROG_COUNT=$(count_real_issues "in_progress")

  # 3. Check for issues
  ISSUES=""
  [ -z "$MAYOR" ] && ISSUES="$ISSUES MAYOR_MISSING"
  { [ -n "$MAYOR" ] && echo "$MAYOR" | grep -qvE "awake|running|active"; } && ISSUES="$ISSUES MAYOR($MAYOR)"
  [ "$SUSPENDED" != "no" ] && ISSUES="$ISSUES SUSPENDED"
  [ "$CONTROLLER" != "supervisor-managed" ] && ISSUES="$ISSUES CONTROLLER($CONTROLLER)"

  # 4. Report
  if [ -n "$ISSUES" ]; then
    echo "[$TS] #$ITER ⚠$ISSUES | open:$OPEN_COUNT in_progress:$INPROG_COUNT | $SESSIONS"
  else
    echo "[$TS] #$ITER ✓ mayor:$MAYOR | open:$OPEN_COUNT in_progress:$INPROG_COUNT | $SESSIONS"
  fi

  # 5. Exit condition: no open AND no in-progress real work, mayor healthy
  if [ "$OPEN_COUNT" -eq 0 ] && [ "$INPROG_COUNT" -eq 0 ] && [ -z "$ISSUES" ]; then
    echo "[$TS] #$ITER IDLE — no open work, no in-progress work. Watchdog exiting."
    exit 0
  fi

  sleep "$INTERVAL"
done
