---
name: sverka-gh-stack
description: >
  Sverka-specific stacked PR workflow for Gas City wave orchestration. Use when
  creating waves, porting feature branches, or managing the v0-port port stack.
  Pairs with the upstream gh-stack skill — this adds project conventions for
  topic-namespaced branches, worktree-based waves, existing-PR adoption via
  `gh stack link`, and the "plan layers before writing code" rule that prevents
  conflict bombs. Gas City agents (mayor, architect, builder, reviewer) must
  follow this skill when producing stacked PRs.
metadata:
  author: sverka-dev
  version: "0.1.0"
  depends_on: gh-stack
---

# Sverka Gas City Stacked PR Workflow

This skill extends the upstream `gh-stack` skill with Sverka + Gas City
conventions. Read the upstream `gh-stack` SKILL.md first for command syntax,
non-interactive usage rules, and exit codes.

## Branch naming: topic namespace required

Every stack branch uses `<topic>/<wave>` naming. Never use bare `wave-a` —
if another initiative starts its own stack, names collide.

Current port initiative topic: `v0-port`

```text
(main) <- v0-port/wave-a <- v0-port/wave-b <- v0-port/wave-c <- v0-port/wave-d
```

- `v0-port/wave-a` — core features (F-01 to F-16): constructs, graph, decorators
- `v0-port/wave-b` — runtime features (F-17 to F-25): docker, host, remote executors
- `v0-port/wave-c` — advanced features (F-29 to F-49): reusable workflows, rules, OIDC
- `v0-port/wave-d` — shell proxy API: `$` tagged template, `shell` proxy

For a different initiative, use a different topic:
`refactor/cdk-split`, `fix/nx-vscode`, `feature/policy-engine`, etc.

## Gas City agent responsibilities

| Agent | Stack responsibility |
|-------|---------------------|
| **Architect** | Plans the layers before any code. Decides which features go in which wave. Files specs in `specs/features/`. |
| **Builder** | Creates branches with `gh stack add <topic>/<wave>` from the top. Commits to the worktree. Runs `gh stack push` after commits. |
| **Reviewer** | Runs `gh stack view --json` to check `needsRebase`. Runs quality gates. Reports `needsRebase` or conflicts to mayor. |
| **Mayor** | Runs `gh stack sync` after any wave updates. Merges top-down with `gh stack merge <top-PR> --yes`. Dispatches next wave. |

**All agents use `gh stack` non-interactively.** See the upstream gh-stack skill
for the "Always run / Never run bare" table.

## Creating a new wave (Gas City flow)

### Architect phase: plan layers

Before any builder starts, the architect decides the wave breakdown and writes
specs. The stack is planned before code exists — this is the #1 conflict
prevention rule.

### Builder phase: create the stack

For a new stack (first wave):

```bash
gh stack init v0-port/wave-a
# commit features
gh stack add v0-port/wave-b
# commit features
gh stack submit --auto
gh stack view --json
```

> **Footgun — `gh stack submit` force-pushes local branch refs.**
> `submit` pushes whatever your local branches point at. If `gh stack init`
> adopted branch names without the correct SHAs (e.g., local refs still point
> at `main` after adoption), `submit` will force-update the remote branch refs,
> replacing the correct commits with wrong ones. This corrupts PR diffs and,
> in stacked PRs, can trigger cascading PR closures — GitHub blocks reopening
> PRs whose head branches were force-pushed, so recovery requires recreating
> the branches and PRs from scratch.
>
> **Before running `gh stack submit`:**
> 1. Verify every local branch SHA matches the expected commit:
>    `git rev-parse --verify <branch>` for each branch in the stack. Compare
>    the full SHA against the expected commit — do not rely on shortened output.
> 2. If any local ref is wrong, fix it first. Create a backup ref before
>    rewriting, identify the owning worktree, and confirm it is clean:
>    ```bash
>    git branch backup/<branch> <branch>          # backup before rewriting
>    git worktree list | grep <branch>            # find owning worktree
>    # If not checked out in a worktree:
>    git branch -f <branch> <correct-sha>
>    # If checked out in a worktree, go there and:
>    git reset --hard <correct-sha>
>    ```
>    Validate `<correct-sha>` exists with `git cat-file -t <correct-sha>`
>    before resetting.
> 3. Only then run `gh stack submit --auto`.
>
> **Safer alternative for linking existing PRs into a stack:** use the REST API
> directly — it creates the stack linkage without touching branch refs. PR
> numbers must be ordered bottom-to-top, and each PR's base ref must match the
> previous PR's head ref:
> ```bash
> echo '{"pull_requests":[92,93,94]}' | gh api -X POST repos/OWNER/REPO/stacks --input -
> ```

For adopting existing PRs that were created manually (recovery scenario),
use the REST API with PR numbers (not `gh stack link` with branch names,
which can push local branches and create unwanted PRs):

```bash
echo '{"pull_requests":[62,63,75]}' | gh api -X POST repos/sverka-dev/sverka/stacks --input -
```

### Adding a new wave on top

From the top branch's worktree:

```bash
gh stack add v0-port/wave-d
# commit features
gh stack push
```

Or from the main repo if the branch is in a worktree:

```bash
gh stack link <stack-number> v0-port/wave-d
```

## Worktree-based waves

Gas City builders work in separate git worktrees, one per wave:

```text
<project-root>              # main repo (trunk, mayor lives here)
<project-root>-wave-a       # wave-a worktree
<project-root>-wave-b       # wave-b worktree
...
```

Because branches live in separate worktrees, `gh stack checkout` will fail with
"already used by worktree". This is expected. Use `gh stack link` to manage the
stack on GitHub without local checkout, and run `gh stack sync` from the main
repo to keep everything aligned.

## Syncing the stack

After any wave branch is updated (commits added, rebase completed), the mayor
runs:

```bash
gh stack sync            # fetch, rebase cascade, push all branches, refresh PRs
gh stack view --json     # verify state
```

If `sync` exits 0 but prints `Sync aborted` (local and remote stacks have
diverged), the stack is unchanged — do not proceed with merging. Reconcile
the divergence first: inspect both chains with `gh stack view --json`, decide
which is canonical, and either rebase locally or dissolve and recreate the
stack.

If `sync` exits 3 (rebase conflict), the stack is already restored — no rebase
is in progress. The builder must start a new rebase, resolve conflicts, and
continue:

```bash
gh stack rebase              # recreate the conflict
# resolve conflicts in files
git add <resolved-files>
gh stack rebase --continue   # finish the rebase
gh stack push                # push the fixed branches
```

## Merging waves

Waves merge **top-down**, not bottom-to-top. The top PR is rebased onto
`main`, `/act`'d until clean, then merged — bringing all stack changes into
`main`. See `pack/skills/sverka-merge-stack/SKILL.md` and
`pack/formulas/merge-stack.toml` for the full top-down merge procedure.

```bash
gh stack merge <top-PR-number> --yes --squash   # merges top PR + all below it
# verify lower PRs are closed by GitHub
gh stack sync                                   # rebases any remaining stacks
```

**Caveats:**
- `gh stack merge` selects the stack through the target PR and merges every
  unmerged PR below it. The merge is all-or-nothing — if any PR cannot merge,
  none do.
- If the base branch uses a merge queue, GitHub ignores `--squash` and may
  split the stack into multiple merge groups. Check the queue results after
  merging.
- Lower PRs are closed by GitHub after the merge, but verify this — do not
  assume. Check with `gh pr view <PR> --json state,baseRefName`.

## Conflict prevention rules

1. **Plan layers before writing code.** The architect decides wave composition
   before any builder starts. A feature that depends on another must be in the
   same wave or a lower one.

2. **Never branch waves independently from main.** Always branch from the
   previous wave's tip. Use `gh stack add <topic>/<next-wave>` from the top
   branch.

3. **Use `gh stack sync` after any branch changes.** The mayor runs sync to
   keep the cascade rebased and surface conflicts early.

4. **Use `gh stack view --json` to check `needsRebase` before starting work.**
   If a branch needs rebase, sync first.

5. **One stack, one story.** All waves in a stack serve the same initiative.
   Unrelated work gets its own stack with its own topic prefix.

6. **Verify local branch SHAs before `gh stack submit`.** `submit` force-pushes
   local refs to remote. If local refs are stale or wrong (common after
   `gh stack init` adopts existing branches), it destroys remote branches and
   makes PRs unreopenable. Always check `git rev-parse --verify <branch>` for
   every branch first. For linking existing PRs without touching branches, use
   the REST API: `POST /repos/{owner}/{repo}/stacks` with `{"pull_requests":[...]}`.

## Current stack state

Stack on GitHub linking the v0-port waves:

```text
(main) <- wave-a-port-f01-f16 <- wave-b-port-f17-f25 <- wave-c-port-f29-f49
         PR #62 (OPEN)          PR #63 (OPEN)          PR #75 (OPEN)
```

Note: existing branch names predate this naming convention. Future waves should
use `v0-port/wave-d` style naming. To restructure existing branches, use
`gh stack modify` (interactive only) or dissolve with `gh stack unstack` and
recreate with `gh stack init <branch1> <branch2> ...` (always pass branch
arguments — a bare `gh stack init` starts interactive prompts and blocks
agents). Note that neither `unstack` nor `init` renames branch refs; `init`
adopts existing branches as-is or creates new ones.
