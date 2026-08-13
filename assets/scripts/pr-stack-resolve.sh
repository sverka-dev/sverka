#!/usr/bin/env bash
# pr-stack-resolve.sh — deterministic PR stack resolution checks
#
# Discovers all open PRs, orders them by stack position, and reports the
# resolution state of each. Does NOT make changes — only reports.
# The agent (dispatched via the formula) does the actual /act work.
#
# Output: JSON report to stdout, human-readable log to stderr.
# Exit: 0 if all PRs resolved, 1 if any need work.
set -euo pipefail

REPO="sverka-dev/sverka"
cd "$(git rev-parse --show-toplevel)"

TIMESTAMP=$(date -u +"%Y-%m-%dT%H:%M:%SZ")
log() { echo "[pr-resolve $TIMESTAMP] $*" >&2; }

TMPDIR=$(mktemp -d)
trap 'rm -rf "$TMPDIR"' EXIT

# --- 1. Fetch latest ---
log "Fetching latest from origin..."
git fetch origin --prune 2>&1 | grep -v "^From " || true

# --- 2. Discover all open PRs ---
log "Discovering open PRs..."
gh pr list --repo "$REPO" --state open --json number,headRefName,baseRefName,title > "$TMPDIR/prs.json" 2>/dev/null

PR_COUNT=$(python3 -c "import json; print(len(json.load(open('$TMPDIR/prs.json'))))" 2>/dev/null || echo "0")

if [ "$PR_COUNT" -eq 0 ]; then
  log "No open PRs. All resolved."
  echo '{"prs":[],"all_resolved":true,"prs_resolved":0,"prs_needs_work":0}'
  exit 0
fi

log "Found $PR_COUNT open PR(s)."

# --- 3. Order PRs by stack position (base → top) ---
python3 -c "
import json
prs = json.load(open('$TMPDIR/prs.json'))
by_base = {}
for p in prs:
    by_base.setdefault(p['baseRefName'], []).append(p)

ordered = []
visited = set()

def visit(base):
    for p in by_base.get(base, []):
        if p['number'] in visited:
            continue
        visited.add(p['number'])
        ordered.append(p)
        visit(p['headRefName'])

visit('main')
for p in prs:
    if p['number'] not in visited:
        ordered.append(p)

with open('$TMPDIR/ordered.json', 'w') as f:
    json.dump(ordered, f)

print(' '.join(str(p['number']) for p in ordered))
" > "$TMPDIR/order.txt"

ORDERED_NUMBERS=$(cat "$TMPDIR/order.txt")
log "Stack order (base → top): $ORDERED_NUMBERS"

# --- 4. Check each PR ---
ALL_RESOLVED=true
NEEDS_WORK_COUNT=0
RESOLVED_COUNT=0
ENTRIES=""

for PR_NUM in $ORDERED_NUMBERS; do
  PR_DATA=$(python3 -c "
import json
for p in json.load(open('$TMPDIR/ordered.json')):
    if p['number'] == $PR_NUM:
        print(json.dumps(p))
        break
")

  HEAD_REF=$(echo "$PR_DATA" | python3 -c "import json,sys; print(json.load(sys.stdin)['headRefName'])")
  BASE_REF=$(echo "$PR_DATA" | python3 -c "import json,sys; print(json.load(sys.stdin)['baseRefName'])")
  TITLE=$(echo "$PR_DATA" | python3 -c "import json,sys; d=json.load(sys.stdin); print(d['title'].replace('\"','\\'\"'))")

  log "PR #$PR_NUM: $TITLE (head=$HEAD_REF base=$BASE_REF)"

  # Check 1: Merge state
  MERGE_STATE=$(gh pr view "$PR_NUM" --repo "$REPO" --json mergeStateStatus -q '.mergeStateStatus' 2>/dev/null || echo "unknown")
  HAS_CONFLICT=false
  if [ "$MERGE_STATE" = "DIRTY" ] || [ "$MERGE_STATE" = "BLOCKED" ]; then
    HAS_CONFLICT=true
  fi

  # Check 2: Unresolved review threads (via GraphQL — REST API can't filter by resolved state)
  OPEN_THREADS=$(gh api graphql -f query='
query($owner: String!, $repo: String!, $pr: Int!) {
  repository(owner: $owner, name: $repo) {
    pullRequest(number: $pr) {
      reviewThreads(first: 100) {
        nodes { isResolved }
      }
    }
  }
}' -F owner=sverka-dev -F repo=sverka -F pr="$PR_NUM" 2>/dev/null | python3 -c "
import json, sys
try:
    data = json.load(sys.stdin)
    threads = data['data']['repository']['pullRequest']['reviewThreads']['nodes']
    print(sum(1 for t in threads if not t['isResolved']))
except:
    print(0)
" 2>/dev/null || echo "0")

  # Check 3: CI status
  CI_STATE="unknown"
  CI_CHECKS=$(gh pr checks "$PR_NUM" --repo "$REPO" --json name,bucket --required 2>/dev/null || echo "[]")
  CI_STATE=$(echo "$CI_CHECKS" | python3 -c "
import json, sys
try:
    checks = json.load(sys.stdin)
    failing = [c['name'] for c in checks if c.get('bucket') == 'fail']
    pending = [c for c in checks if c.get('bucket') == 'pending']
    if failing:
        print('FAIL:' + ','.join(failing))
    elif pending:
        print('PENDING')
    else:
        print('PASS')
except:
    print('UNKNOWN')
")

  # Check 4: Is branch behind base?
  BEHIND=false
  BEHIND_COUNT=0
  git fetch origin "$HEAD_REF" 2>/dev/null || true
  git fetch origin "$BASE_REF" 2>/dev/null || true
  DIVERGENCE=$(git rev-list --left-right --count "origin/$BASE_REF...origin/$HEAD_REF" 2>/dev/null || echo "0 0")
  BEHIND_COUNT=$(echo "$DIVERGENCE" | awk '{print $1}')
  if [ "$BEHIND_COUNT" -gt 0 ] 2>/dev/null; then
    BEHIND=true
  fi

  # Determine resolution state
  RESOLVED=true
  REASONS=""

  if [ "$HAS_CONFLICT" = "true" ]; then
    RESOLVED=false
    REASONS="${REASONS}merge_conflict "
  fi

  if [ "$OPEN_THREADS" -gt 0 ] 2>/dev/null; then
    RESOLVED=false
    REASONS="${REASONS}open_threads($OPEN_THREADS) "
  fi

  if [[ "$CI_STATE" == FAIL* ]]; then
    RESOLVED=false
    REASONS="${REASONS}ci_failing(${CI_STATE#FAIL:}) "
  fi

  if [[ "$CI_STATE" == "PENDING" ]]; then
    RESOLVED=false
    REASONS="${REASONS}ci_pending "
  fi

  if [ "$BEHIND" = "true" ]; then
    RESOLVED=false
    REASONS="${REASONS}behind_base($BEHIND_COUNT) "
  fi

  if [ "$RESOLVED" = "true" ]; then
    log "  ✓ RESOLVED (CI=$CI_STATE, threads=0, no conflicts, rebased)"
    RESOLVED_COUNT=$((RESOLVED_COUNT + 1))
  else
    log "  ✗ NEEDS WORK: ${REASONS:-unknown}"
    ALL_RESOLVED=false
    NEEDS_WORK_COUNT=$((NEEDS_WORK_COUNT + 1))
  fi

  # Build JSON entry
  PY_RESOLVED=$( [ "$RESOLVED" = "true" ] && echo "True" || echo "False" )
  PY_BEHIND=$( [ "$BEHIND" = "true" ] && echo "True" || echo "False" )
  ENTRY=$(python3 -c "
import json
entry = {
    'number': $PR_NUM,
    'head': '$HEAD_REF',
    'base': '$BASE_REF',
    'resolved': $PY_RESOLVED,
    'merge_state': '$MERGE_STATE',
    'open_threads': $OPEN_THREADS,
    'ci_state': '$CI_STATE',
    'behind': $PY_BEHIND,
    'behind_count': $BEHIND_COUNT,
    'reasons': '${REASONS:-}'.strip()
}
print(json.dumps(entry))
")
  if [ -n "$ENTRIES" ]; then
    ENTRIES="$ENTRIES,$ENTRY"
  else
    ENTRIES="$ENTRY"
  fi
done

ALL_RESOLVED_JSON=$( [ "$ALL_RESOLVED" = "true" ] && echo "true" || echo "false" )
echo "{\"timestamp\":\"$TIMESTAMP\",\"prs\":[$ENTRIES],\"all_resolved\":$ALL_RESOLVED_JSON,\"prs_resolved\":$RESOLVED_COUNT,\"prs_needs_work\":$NEEDS_WORK_COUNT}"

if [ "$ALL_RESOLVED" = "true" ]; then
  log "All $RESOLVED_COUNT PR(s) resolved."
  exit 0
else
  log "$NEEDS_WORK_COUNT PR(s) need work, $RESOLVED_COUNT resolved."
  exit 1
fi
