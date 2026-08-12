# Merge-stack post-merge cleanup

This runbook describes the cleanup steps the mayor performs after the top PR of
a stack is squash-merged into `main`. It is referenced by the
`pack/formulas/merge-stack.toml` formula.

## When to use

- The top PR of a stack has been merged with `gh pr merge <top-PR> --squash --delete-branch`.
- All changes from lower PRs in the stack are now reachable through the single
  squash commit on `main`.

## Steps

1. Pull `main` locally:

   ```bash
   git checkout main
   git pull
   ```

2. Close lower PRs and delete their head branches after verifying that each
   branch's content is already included in `main`. Squash merges create a new
   commit, so ancestry checks (`git merge-base --is-ancestor`) will fail even
   when every change from a lower branch is present. Verify content inclusion
   with a trial 3-way merge instead: if merging the lower branch into
   `origin/main` produces the same tree as `origin/main`, the branch carries
   no new changes.

   ```bash
   # Fetch origin once before verifying any lower PR; if it fails, none of the
   # lower PRs can be safely proven as included, so retain all of them.
   if ! git fetch origin; then
     echo "WARNING: git fetch origin failed — cannot verify lower PRs; retaining all lower PRs and branches"
   else
     BASE_TREE=$(git rev-parse "origin/main^{tree}")

     # For each lower PR in the stack (replace placeholder PR numbers with real values):
     for LOWER_PR in __LOWER_PR_1__ __LOWER_PR_2__; do
       # Resolve the PR's head branch so verification and deletion both use the
       # same per-PR reference.
       HEAD_REF=$(gh pr view "$LOWER_PR" --json headRefName --jq '.headRefName' 2>/dev/null || true)
       if [ -z "$HEAD_REF" ]; then
         echo "WARNING: could not resolve head branch for $LOWER_PR — retaining PR and branch for review" >&2
         continue
       fi
       LOWER_REF="origin/$HEAD_REF"
       CONTENT_INCLUDED=false

       MERGE_BASE=$(git merge-base origin/main "$LOWER_REF") || true
       if [ -n "$MERGE_BASE" ]; then
         MERGED_TREE=""
         MERGE_ERR=$(mktemp)
         if MERGED_TREE=$(git merge-tree --write-tree --no-messages origin/main "$LOWER_REF" 2>"$MERGE_ERR"); then
           MERGE_RC=0
         else
           MERGE_RC=$?
         fi
         rm -f "$MERGE_ERR"

         if [ "$MERGE_RC" -eq 0 ] && [ -n "$MERGED_TREE" ] && \
            [[ "$MERGED_TREE" =~ ^[0-9a-f]{40,64}$ ]] && \
            [ "$(git cat-file -t "$MERGED_TREE" 2>/dev/null)" = "tree" ]; then
           if [ "$MERGED_TREE" = "$BASE_TREE" ]; then
             CONTENT_INCLUDED=true
           fi
         else
           echo "WARNING: merge-tree output is not a valid tree object — treating content as unverified" >&2
         fi
       fi

       if [ "$CONTENT_INCLUDED" = "true" ]; then
         gh pr close "$LOWER_PR" --comment "Merged via #__TOP_PR__ (squash). All stack changes are now in main."
         git push origin --delete "$HEAD_REF" 2>/dev/null || true
       else
         echo "WARNING: $LOWER_REF content not proven to be in main — retaining lower PR $LOWER_PR and branch $HEAD_REF for review" >&2
         # Do not close or delete; the lower PR stays open until inclusion can be verified.
       fi
     done
   fi
   ```

3. Record the merge in `bd` if this stack was tracked:

   ```bash
   bd close <bead-id>
   ```

## Notes

- `git merge-tree --write-tree` requires git >= 2.38. On older git it exits
  with a usage error and the script conservatively treats content as
  unverified.
- `gh pr merge --delete-branch` already removes the top PR's head branch.
