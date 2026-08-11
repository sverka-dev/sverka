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
# Validate INTERVAL is a positive integer to prevent injection.
if ! [[ "$INTERVAL" =~ ^[1-9][0-9]*$ ]]; then
  echo "ERROR: interval must be a positive integer, got: $INTERVAL" >&2
  exit 2
fi
ITER=0

# Filter out ephemeral wisp/nudge beads from bd output.
# Real issues have IDs like sv-XXXX (4+ chars after sv-).
# Wisp/nudge beads have IDs like sv-wisp-XXXX or sv-nudge-XXXX.
# Status symbols: ○ = open, ◐ = in_progress, ● = blocked, ✓ = closed
# Returns -1 on bd failure (distinct from a legitimate 0 count) so the
# caller can distinguish "no work" from "lookup failed". Adds a timeout
# to bd list so a blocked store cannot stall the watchdog.
count_real_issues() {
  local status="$1"
  local raw
  if ! raw=$(timeout 10 bd list --status="$status" 2>/dev/null); then
    printf -- '-1\n'
    return 1
  fi
  # grep returns 1 when no matches; with pipefail that would fail the
  # pipeline. Use `|| true` to swallow grep's no-match exit code so
  # an empty result yields 0, not -1.
  printf '%s\n' "$raw" \
    | { grep -E '^\s*[○◐●] sv-[a-z0-9]{4,}($| )' || true; } \
    | { grep -vE '^\s*[○◐●] sv-(wisp|nudge)' || true; } \
    | wc -l
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

  MAYOR=$(echo "$STATUS" | grep -m1 -wF -- "harness.mayor" | awk '{print $2}')
  SESSIONS=$(echo "$STATUS" | grep "Sessions:" | head -1 | sed 's/^ *//')
  SUSPENDED=$(echo "$STATUS" | grep -w "Suspended:" | head -1 | awk '{print $2}')
  CONTROLLER=$(echo "$STATUS" | grep "Controller:" | grep -o "supervisor-managed\|stopped\|error" | head -1 || true)

  # Handle transient lookup errors (mayor shows "lookup" instead of "awake")
  if echo "$MAYOR" | grep -q "lookup"; then
    MAYOR="lookup-error"
  fi

  # 2. bd work counts
  OPEN_COUNT=$(count_real_issues "open")
  OPEN_FAILED=$?
  INPROG_COUNT=$(count_real_issues "in_progress")
  INPROG_FAILED=$?

  # 3. Check for issues
  ISSUES=""
  # bd lookup failures are hard issues — don't allow idle exit when store is unreachable
  if [ "$OPEN_FAILED" -ne 0 ] || [ "$INPROG_FAILED" -ne 0 ]; then
    ISSUES="$ISSUES BD_LOOKUP_FAILED"
  fi
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

  # 5. Exit condition: no open AND no in-progress real work, mayor healthy,
  #    and bd lookups succeeded. Soft signals (MAYOR_LOOKUP_TIMEOUT) are
  #    stripped; hard signals (BD_LOOKUP_FAILED) prevent idle exit.
  HARD_ISSUES="${ISSUES// MAYOR_LOOKUP_TIMEOUT/}"
  if [ "$OPEN_COUNT" -eq 0 ] && [ "$INPROG_COUNT" -eq 0 ] && [ -z "$HARD_ISSUES" ]; then
    echo "[$TS] #$ITER IDLE — no open work, no in-progress work. Watchdog exiting."
    exit 0
  fi

  sleep "$INTERVAL"
done
