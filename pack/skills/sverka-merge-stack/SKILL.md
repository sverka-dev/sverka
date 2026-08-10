---
name: sverka-merge-stack
description: Use when merging a stack of PRs top-down. The TOP PR is rebased onto main, /act'd until clean, squash-merged (brings all stack changes into main), then lower PRs are closed. Retrospect after each stack merge feeds self-learning. Trigger when the user asks to "merge the stack", "merge all PRs", or "merge from the top".
---

# sverka-merge-stack

Merge PR stacks TOP-DOWN. The top PR of each stack is rebased onto main,
/act'd until clean, then squash-merged — bringing ALL changes from the
entire stack into main in one commit. Lower PRs are closed (their changes
are included in the top PR's squash commit).

## Why top-down?

- **One merge per stack** (not N merges) — faster
- **One /act convergence per stack** (on the top PR only)
- **Lower PRs are closed, not merged** — their changes are already in main
- The top PR's diff (after rebase onto main) includes ALL commits from
  the entire stack, so squash merge captures everything

## The Merge Loop

```
   ┌── DISCOVER STACKS ──► ACT-LOOP (top PR) ──► MERGE ──► CLOSE LOWERS ──► RETROSPECT ──► ADVANCE ──┐
   │                                                                                                    │
   │   next stack ◄──────────────────────────────────────────────────────────────────────────────────────┘
   │                                                                                                    │
   └── (no more stacks) ──► FINAL RETROSPECT ──► DONE (all flat on main)                                 │
```

## Step 1: Discover the stacks

Query all open PRs and build chains:

```bash
gh pr list --state open --json number,title,baseRefName,headRefName \
  --jq '.[] | "\(.number) \(.headRefName) \(.baseRefName)"'
```

For each stack, identify:
- **TOP PR**: the one whose head is NOT any other PR's base
- **BOTTOM PR**: base = main
- **Members**: all PRs in the chain

Example:
- Stack A: top=#18, members=[#1,#2,#3,#5,#6,#7,#8,#9,#10,#11,#12,#13,#14,#16,#17,#18]
- Stack B: top=#22, members=[#19,#20,#22]

## Step 2: /act --loop on the TOP PR

### Pre-flight: rebase TOP PR onto main

The TOP PR must be rebased onto main so its diff includes ALL stack changes:

```bash
git checkout <top-head-branch>
git fetch origin
git rebase origin/main
git push --force-with-lease
gh pr edit <top-PR> --base main
```

After rebase, the TOP PR's diff = all commits from bottom to top of stack.

### Trigger CodeRabbit review (MANDATORY)

CodeRabbit posts an issue-level comment with a "Trigger review" checkbox.
After each push, the agent MUST click the checkbox to force a re-review.

**How to click the checkbox:**

1. Find the CodeRabbit comment:
```bash
COMMENT_ID=$(gh api repos/sverka-dev/sverka/issues/<PR>/comments \
  --jq '[.[] | select(.user.login == "coderabbitai[bot]")] | .[0].id')
```

2. Get the comment body:
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

### /act convergence check

All must be 0 on the same HEAD:
1. `open_threads == 0`
2. `CI_REQUIRED_PENDING == 0`
3. `SAST_FINDINGS_PENDING == 0`
4. Bot comment count stable
5. `mergeable == MERGEABLE`
6. Quality gates passed
7. CodeRabbit review triggered and completed

```bash
bun ~/.agents/skills/act/scripts/pr-state.ts <top-PR>
```

## Step 3: Merge the TOP PR + close lowers

### Merge the top PR

```bash
gh pr merge <top-PR> --squash --delete-branch
```

This single squash commit brings ALL stack changes into main.

### Close all lower PRs in the stack

For each lower PR (bottom to just-below-top):
```bash
gh pr close <lower-PR> --comment "Merged via #<top-PR> (squash). All stack changes are now in main."
git push origin --delete <lower-head-branch> 2>/dev/null || true
```

### Pull main

```bash
git checkout main && git pull
```

## Step 4: Retrospect (MANDATORY self-learning)

After each stack merge + close:

1. **What worked** — patterns that made /act converge fast
2. **What didn't** — issues that took multiple iterations
3. **Review patterns** — common review feedback
4. **CI patterns** — common CI failures and fixes
5. **Bot patterns** — CodeRabbit/Codacy/Qodo recurring findings
6. **Time to converge** — how many /act iterations
7. **Stack size** — PRs merged vs closed

Store:
```bash
mkdir -p .gc/retrospects
cat >> .gc/retrospects/merge-stack.md << 'EOF'
## Stack (top=#<N>) — <date>
- Members: <list>
- Merged: #<top>
- Closed: <lower PRs>
- Iterations: <N>
- Findings: <list>
- Pattern: <recurring pattern if any>
- Lesson: <what to do differently next time>
EOF
bd remember "merge-stack retrospect stack top=#<N>: <key findings>"
```

### Feed back into the loop

Before starting /act on the next stack, read the retrospect log:
```bash
cat .gc/retrospects/merge-stack.md 2>/dev/null
```

Apply lessons learned — proactively fix patterns before bots find them.

## Step 5: Advance to next stack

If there are more stacks:
1. Take the next stack's TOP PR
2. Rebase onto main (which now has the previous stack's changes)
3. Change base to main
4. Loop back to Step 2

If no more stacks — run final retrospect, then done.

## Final Retrospect

After all stacks are merged:
1. Total stacks merged
2. Total PRs merged (top) vs closed (lower)
3. Total /act iterations
4. Top 3 recurring patterns
5. Top 3 lessons learned
6. Recommendations for future stacks

## Rules

- **TOP-DOWN.** Merge the top PR, close the lowers. Never bottom-up.
- **Never merge a PR that hasn't passed /act convergence.** No exceptions.
- **Never skip CodeRabbit trigger.** Review must be triggered after every push.
- **Never skip retrospect.** Self-learning is mandatory after each stack.
- **One merge per stack.** The top PR's squash includes everything.
- **Close lowers with a comment.** "Merged via #<top>."
- **Squash merge only.** Clean history, one commit per stack.
- **Delete branches after merge/close.** No stale branches.
- **Escalate on blocker.** Don't loop forever on an unfixable issue.
- **Read past retrospects before starting /act.** Apply lessons learned.

## Files

- `merge-stack.toml` — formula definition (steps: discover → act-loop → merge → retrospect → advance)
