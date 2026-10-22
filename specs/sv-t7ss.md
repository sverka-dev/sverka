# sv-t7ss — docs debt: feature PRs land without engdocs — document-first convention not enforced

## Problem

Audit of 21 night-run PRs: only 6 touched docs. `AGENTS.md` declares
"Document-first: Engineering docs in `engdocs/` before code" but nothing
enforces it, and as written the convention overreaches — most of the
audited PRs were fixes/chores that reasonably ship no engdocs at all, so
the real intent was never stated either.

`act.docsPaths` in `bro.config.json` exists, but it does the opposite of
what's needed: it classifies docs-only PRs so the act loop can apply a
tighter round cap (`docsOnlyPr` → `effectiveMaxRounds` in bro). It does
not nudge feature PRs that land without docs.

## Design

Three-part fix, all repo-local:

1. **Scope the convention** — document-first applies to _user-facing
   features and architecture changes_ (new packages, new CLI commands,
   new config surface, new behavior a user or agent must discover).
   Fixes, chores, internal refactors, and test-only work are exempt —
   their record is the spec, the tests, and the commit. This matches how
   the repo actually works and keeps the nudge meaningful.
2. **Enforce with a session-stop guard** — add a `docs-on-stop` entry to
   `guard.defs` in `bro.config.json`, same shape as the existing
   `test-coverage-on-stop` guard: fires when `packages/*/src/**` changed
   and no `engdocs/**` or `specs/**` file moved. A nudge, not a block —
   the agent decides whether the change is user-facing.
3. **Track the backlog** — the docs sweep for already-merged features is
   follow-up work filed as beads, not this PR. Undocumented user-facing
   surfaces at the time of writing: `packages/playground`,
   `packages/reporter`, `packages/ui`, `packages/benchmark`,
   `packages/create-sverka`, `packages/plugin-mcp`,
   `packages/verification`.

A PR-level (act-gate) version of the same nudge belongs to the bro rig —
the act loop and `docsOnlyPr` live there. Out of scope for this change;
filed as a suggestion in the PR body.

## Plan

- [x] Spec `specs/sv-t7ss.md` (satisfies the SDD gate for this bead)
- [ ] `bro.config.json`: add `docs-on-stop` guard def
- [ ] `AGENTS.md`, `engdocs/contributing/guide.md`, `engdocs/README.md`:
      scope the document-first convention to user-facing work
- [ ] File follow-up beads for the per-feature docs sweep
- [ ] `bro self guard test` / equivalent check that the guard def parses
      and fires as intended
