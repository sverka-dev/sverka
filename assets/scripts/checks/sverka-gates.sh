#!/usr/bin/env bash
set -euo pipefail

# Sverka quality gates — runs the four monorepo gates fresh.
# Used as [steps.check] in sverka-wave formula steps where code artifacts
# are expected (implement, review).
#
# Exit 0 = all gates green; exit 1 = at least one gate failed.
# Failures print machine-readable lines on stderr for the dispatcher's
# gc.attempt_log repair context.

fail() { echo "sverka-gates: $*" >&2; exit 1; }

ROOT="${GC_WORK_DIR:-$(pwd)}"

cd "$ROOT"

# Gates to run. Override by setting SVERKA_GATES (comma-separated subset).
GATES="${SVERKA_GATES:-test,typecheck,lint,build}"

run_gate() {
  local gate="$1"
  local out
  echo "sverka-gates: running 'bun run $gate'..."
  if out="$(bun run "$gate" 2>&1)"; then
    echo "sverka-gates: $gate PASS"
    return 0
  fi
  echo "sverka-gates: $gate FAIL" >&2
  # Print last 30 lines of output for repair context
  printf '%s\n' "$out" | tail -30 >&2
  return 1
}

FAILED=0
IFS=',' read -r -a GATE_LIST <<<"$GATES"
for g in "${GATE_LIST[@]}"; do
  g="$(printf '%s' "$g" | tr -d '[:space:]')"
  [[ -n "$g" ]] || continue
  run_gate "$g" || { FAILED=1; break; }
done

if [[ "$FAILED" -ne 0 ]]; then
  fail "one or more gates failed"
fi

echo "sverka-gates: all gates green"
exit 0
