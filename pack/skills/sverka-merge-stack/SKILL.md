---
name: sverka-merge-stack
description: Use when merging a stack of PRs bottom-up. Each PR must pass /act --loop (resolve all threads, CI green, SAST clean, mergeable, CodeRabbit triggered) before merge. Retrospect after each merge feeds self-learning. Loops through the stack until main is reached. Trigger when the user asks to "merge the stack", "merge all PRs", or "merge PR by PR".
---

# sverka-merge-stack

Merge a stack of PRs bottom-up, one PR at a time. Each PR must be
fully clean before merge — no shortcuts, no skip. After each merge,
run retrospect to feed the self-learning loop.

## The Merge Loop

```
   ┌── DISCOVER STACK ──► ACT-LOOP ──► MERGE ──► RETROSPECT ──► ADVANCE ──┐
   │                                                                       │
   │   next PR in stack ◄──────────────────────────────────────────────────┘
   │                                                                       │
   └── (no more PRs) ──► FINAL RETROSPECT ──► DONE (stack flat on main)     │
```

## Step 1: Discover the stack

Query all open PRs and build the chain:

```bash
gh pr list --state open --json number,title,baseRefName,headRefName \
  --jq '.[] | "\(.number) \(.headRefName) \(.baseRefName)"'
```

Build the chain: find the PR whose base is `main` (bottom). Then find
the PR whose base is that PR's head. Continue until no more PRs chain.

Output: `[PR_1, PR_2, ..., PR_N]` where PR_1 base=main, PR_2 base=PR_1.head, etc.

## Step 2: /act --loop on current PR

Run `/act` on the current PR (starting from the bottom). The /act loop
MUST converge before merge. Convergence = ALL true on the same HEAD:

1. `open_threads == 0` — all review threads resolved
2. `CI_REQUIRED_PENDING == 0` — all required CI checks pass
3. `SAST_FINDINGS_PENDING == 0` — no unresolved security findings
4. Bot comment count stable (no new reviews after last push)
5. `mergeable == MERGEABLE` — no conflicts, up to date with base
6. Quality gates passed (coverage, code quality — if configured)
7. CodeRabbit review triggered and completed (see below)

### Pre-flight: rebase check

Before /act, check mergeable status:
```bash
gh pr view <N> --json mergeable --jq '.mergeable'
```

If not `MERGEABLE`:
```bash
git checkout <head-branch>
git rebase origin/<base-branch>
git push --force-with-lease
```

### Trigger CodeRabbit review (MANDATORY)

CodeRabbit posts an issue-level comment with a "Trigger review" checkbox.
After each push (or if review was skipped), the agent MUST click the
checkbox to force a re-review.

**How to click the checkbox:**

1. Find the CodeRabbit comment:
```bash
COMMENT_ID=$(gh api repos/sverka-dev/sverka/issues/<PR>/comments \
  --jq '[.[] | select(.user.login == "coderabbitai[bot]")] | .[0].id')
```

2. Get the comment body and find the checkbox line:
```bash
BODY=$(gh api repos/sverka-dev/sverka/issues/comments/$COMMENT_ID --jq '.body')
```

3. Replace `- [ ]` with `- [x]` on the "Trigger review" line and update:
```bash
NEW_BODY=$(echo "$BODY" | sed 's/- \[ \] \(<!-- {"checkboxId"[^}]*} --> 🔍 Trigger review\)/- [x] \1/')
gh api repos/sverka-dev/sverka/issues/comments/$COMMENT_ID \
  -X PATCH -f body="$NEW_BODY"
```

4. Wait for CodeRabbit to post a new review (poll for new comments).
   The new review may open new threads — /act loop handles them.

**This is mandatory after every push.** CodeRabbit does not auto-review
non-default branches. Without triggering, review threads stay stale and
convergence check #4 (bot count stable) is meaningless.

### /act convergence check

Use the /act skill's `pr-state.ts` script:
```bash
bun ~/.agents/skills/act/scripts/pr-state.ts <PR-N>
```

This reports: `OPEN_THREADS`, `CI_REQUIRED_PENDING`, `SAST_FINDINGS_PENDING`,
`SAST_FINDINGS_UNKNOWN`. All must be 0.

### If /act cannot converge

- Context limit: report to mayor, request fresh /act session
- Unfixable issue: report to mayor, escalate to human
- CI flaky: retry once, then escalate

## Step 3: Merge the clean PR

ONLY after /act convergence AND CodeRabbit review completed:

```bash
gh pr merge <N> --squash --delete-branch
```

Squash merge — one clean commit per PR on main.

After merge:
```bash
git checkout main && git pull
```

## Step 4: Retrospect (MANDATORY self-learning)

After each merge, run a retrospect. This is the self-learning loop —
the harness gets better with each PR.

### What to capture

1. **What worked** — patterns that made /act converge fast
2. **What didn't** — issues that took multiple iterations
3. **Review patterns** — common review feedback across PRs
4. **CI patterns** — common CI failures and fixes
5. **Bot patterns** — CodeRabbit/Codacy/Qodo recurring findings
6. **Time to converge** — how many /act iterations were needed

### How to store

```bash
bd remember "merge-stack retrospect PR #<N>: <key findings>"
```

Or write to a retrospect log:
```bash
mkdir -p .gc/retrospects
cat >> .gc/retrospects/merge-stack.md << 'EOF'
## PR #<N> — <title> — <date>
- Iterations: <N>
- Findings: <list>
- Pattern: <recurring pattern if any>
- Lesson: <what to do differently next time>
EOF
```

### Feed back into the loop

Before starting /act on the next PR, read the retrospect log:
```bash
cat .gc/retrospects/merge-stack.md 2>/dev/null
```

Apply lessons learned — if a pattern was identified, proactively fix it
before the bots find it. This is the self-learning loop.

## Step 5: Advance to next PR

If there are more PRs in the stack:

1. The next PR's base was the just-merged branch. Rebase onto main:
```bash
git checkout <next-head-branch>
git fetch origin
git rebase origin/main
git push --force-with-lease
```

2. Update the PR base to main:
```bash
gh pr edit <next-PR> --base main
```

3. Loop back to Step 2 with the next PR.

If no more PRs — run final retrospect (Step 4), then done. Stack is flat on main.

## Final Retrospect

After the entire stack is merged, run a comprehensive retrospect:

1. Total PRs merged
2. Total /act iterations across all PRs
3. Top 3 recurring patterns
4. Top 3 lessons learned
5. Recommendations for future stacks

Store in:
```bash
bd remember "merge-stack final retrospect: <summary>"
cat >> .gc/retrospects/merge-stack.md << 'EOF'
## FINAL — <date> — <N> PRs merged
- Total iterations: <N>
- Top patterns: <list>
- Top lessons: <list>
- Recommendations: <list>
EOF
```

## Rules

- **Never merge a PR that hasn't passed /act convergence.** No exceptions.
- **Never skip CodeRabbit trigger.** Review must be triggered after every push.
- **Never skip rebase.** A PR with conflicts gets rebased, not force-merged.
- **Never skip retrospect.** Self-learning is mandatory after each merge.
- **One PR at a time.** Merge bottom-up, never parallel.
- **Squash merge only.** Clean history, one commit per PR.
- **Delete branches after merge.** No stale branches.
- **Report after each merge.** Mayor logs progress.
- **Escalate on blocker.** Don't loop forever on an unfixable issue.
- **Read past retrospects before starting /act.** Apply lessons learned.

## Files

- `merge-stack.toml` — formula definition (steps: discover → act-loop → merge → retrospect → advance)
