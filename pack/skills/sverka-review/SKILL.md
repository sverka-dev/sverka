---
name: sverka-review
description: Use when reviewing a sverka wave implementation or gating quality. Trigger when the reviewer needs to check a wave, the mayor needs to verify gates, or any agent needs to run the two-axis review (Standards + Spec). Covers gate commands, finding classification, and commit hygiene.
---

# Sverka Review

Two-axis review: **Standards** (code follows repo conventions) + **Spec** (code implements the spec). Both must pass.

## Gate Commands

Run fresh — never trust builder claims:

```bash
bun run test --skip-nx-cache       # vitest via nx (NOT `bun test`)
bun run typecheck                   # tsc via nx
bun run lint                        # eslint via nx
bun run build --skip-nx-cache       # tsdown via nx
```

## Finding Classification

| Class   | Meaning                        | Action          |
| ------- | ------------------------------ | --------------- |
| BLOCKING | Spec violation or broken gate | Must fix        |
| NIT     | Non-blocking style or edge case | Note, don't block |
| DECLINE | Reviewer disagrees with suggestion | Explain why    |

## Checklist

- [ ] Tests exist and pass (run them yourself)
- [ ] Build succeeds (run it yourself)
- [ ] Lint passes (run it yourself)
- [ ] Typecheck passes (run it yourself)
- [ ] Public API exported from `src/index.ts`
- [ ] No `any` types (use `unknown` and narrow)
- [ ] Error handling: custom classes use `override` on `cause`
- [ ] Code matches spec — every interface, every type
- [ ] No over-engineering — minimal implementation
- [ ] No speculative API — no exports not used by spec
- [ ] `REVIEW.md` policy satisfied

## Scaffolding Checks

- `package.json`: dist outputs as `.mjs`/`.d.mts` (not `.js`/`.d.ts`)
- `project.json`: lint without `--ext .ts` (ESLint 9 flat config)
- `project.json`: test with `--passWithNoTests`

## Exports Audit

Exports must match spec 1:1. Verify:

```bash
# Check what's exported
cat packages/<name>/src/index.ts

# Compare against spec interfaces section
grep -A50 "## Interfaces" specs/NN-<name>/spec.md
```

Extra exports beyond spec = speculative API = NIT or BLOCKING depending on severity.

## Commit Hygiene

Before committing a wave:

```bash
git status --short
```

Stage only:
- `packages/<package>/**`
- `specs/NN-<name>/`
- `engdocs/`
- `bun.lock`

Exclude:
- `city.toml`, `agents/`, `.devin/`, `.gc/`, `.beads/`
- `.evidence/`, `.opencode/`, `formulas/`
