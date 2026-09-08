# Sverka Delivery: Finalize

You are the mayor finalizing a completed delivery phase. The reviewer has approved.

## What to do

1. Close the phase epic and all sub-tasks (`bd close <id1> <id2> ...`).
2. Verify git status — stage only the phase's files:
   `git add packages/<package>/ specs/ engdocs/architecture/delivery-phase-*.md`
   Stage specific paths for THIS phase only.
3. EXCLUDE from staging: `city.toml`, `agents/`, `.devin/`, `.gc/`, `.beads/`,
   `formulas/`, `assets/workflows/`.
4. Prepare a stacked PR:
   - Create branch: `git checkout -b {{branch_prefix}}/{{phase_name}}`
   - Base it on the previous phase's branch (or `main` for Phase 1).
   - Commit the staged changes.
   - Push: `git push -u origin <branch>`
   - Create PR: `gh pr create --base <prev-phase-branch-or-main> --head <branch>
     --title "Delivery Phase {{phase_num}}: {{phase_name}}" --body "..."`
5. Run `bd dolt push` to sync beads (if authorized).
6. Send mail to human: "Delivery Phase {{phase_num}} complete: {{phase_name}}"
   with summary including what was delivered and benchmark metrics (if Phase 3+).
7. Check the megaplan for the next phase. If the next phase's dependencies are
   met, dispatch it immediately using this formula with the next phase's vars.
8. Update project memory with `bd remember` if there are lessons learned.

## Stacked PR structure

```
main
 └── fix/cli-compile-registration (Phase 1, base: main)
      └── feat/package-publishing (Phase 2, base: Phase 1)
           └── feat/benchmark-arena (Phase 3, base: Phase 2)
                └── feat/benchmark-dashboard (Phase 4, base: Phase 3)
                     └── docs/benchmark-results (Phase 5, base: Phase 4)
```

## Phase dispatch sequence

After finalizing each phase, check the megaplan dependency graph:
- Phase 1 → dispatch Phase 2 (publishing depends on CLI fixes)
- Phase 2 → dispatch Phase 3 (benchmark needs installable packages)
- Phase 3 → dispatch Phase 4 (dashboard needs benchmark results)
- Phase 4 → dispatch Phase 5 (docs need benchmark + dashboard)

## Authorization

Only commit, push, and create PRs when the active profile grants that
authority. Under conservative profile, prepare the commands and present them
to the human for explicit authorization.

## When all phases are done

When Phase 5 is finalized:
1. Send a final summary to the human with all benchmark results.
2. Update the website with the benchmark page.
3. Close the delivery mega-epic bead.
4. `bd remember` the key findings from the benchmark.
