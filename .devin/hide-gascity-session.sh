#!/bin/sh
# Auto-hide Gas City sessions from `devin list`.
# Triggered by SessionStart hook. Only acts when GC_AGENT env is set
# (which Gas City sets for all its agent sessions). User-launched sessions
# do not have GC_AGENT and are left visible.
set -eu

# Only hide Gas City sessions
[ -n "${GC_AGENT:-}" ] || exit 0

# Read session_id from stdin JSON
input="$(cat 2>/dev/null || true)"
[ -n "$input" ] || exit 0

session_id="$(printf '%s' "$input" | python3 -c "import sys,json; print(json.load(sys.stdin).get('session_id',''))" 2>/dev/null || true)"
[ -n "$session_id" ] || exit 0

# Escape the session_id for SQL (only allow alphanumeric and dash)
safe_id="$(printf '%s' "$session_id" | tr -cd 'A-Za-z0-9-')"
[ -n "$safe_id" ] || exit 0

# Hide the session in the default DB
sqlite3 "$HOME/.local/share/devin/cli/sessions.db" \
  "UPDATE sessions SET hidden=1 WHERE id='$safe_id';" 2>/dev/null || true

exit 0
