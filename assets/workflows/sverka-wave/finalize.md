# Sverka Wave: Finalize

You are the mayor finalizing a completed wave. The reviewer has approved.

## What to do

1. Close the wave epic and all sub-tasks (`bd close <id1> <id2> ...`).
2. Verify git status — stage only the wave's files:
   `git add packages/<package>/ specs/NN-<name>/ engdocs/`
3. EXCLUDE from staging: `city.toml`, `agents/`, `.devin/`, `.gc/`, `.beads/`,
   `formulas/`.
4. Prepare a stacked PR:
   - Create branch: `git checkout -b <wave-prefix>-<wave-num>-<package>`
   - Base it on the previous wave's branch (or `main` for the first wave).
   - Commit the staged changes.
   - Push: `git push -u origin <branch>`
   - Create PR: `gh pr create --base <prev-wave-branch> --head <branch>
     --title "Wave <N>: <package>" --body "..."`
5. Run `bd dolt push` to sync beads (if authorized).
6. Send mail to human: "Wave <N> complete: <package>" with summary.
7. Check `bd ready` for the next unblocked wave, dispatch immediately.
8. Update project memory with `bd remember` if there are lessons learned.

## Stacked PR example

```
main
 └── v1-w1-core-ci (PR base: main)
      └── v1-w2-mcp (PR base: v1-w1-core-ci)
           └── v1-w3-storage (PR base: v1-w2-mcp)
```

## Authorization

Only commit, push, and create PRs when the active profile grants that
authority. Under conservative profile, prepare the commands and present them
to the human for explicit authorization.
