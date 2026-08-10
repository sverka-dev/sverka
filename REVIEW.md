# Review Policy

## Two-Axis Review

Every change is reviewed along two independent axes:

1. **Standards** — does the code follow the repo's documented coding
   standards (AGENTS.md) plus a Fowler smell baseline?
2. **Spec** — does the code faithfully implement the originating spec
   in `specs/`?

Both axes must pass. A change that is clean code but implements the wrong
thing is rejected. A change that implements the right thing with messy code
is rejected.

## Verification Bar

The reviewer runs all checks themselves. No trusting builder claims.

```bash
bun run test          # vitest via nx (NOT `bun test` — that runs Bun's runner)
bun run typecheck     # tsc via nx
bun run lint          # eslint via nx
bun run build         # tsdown via nx
```

Run fresh with `--skip-nx-cache` to avoid cached results.

## Finding Classification

| Class   | Meaning                        | Action          |
| ------- | ------------------------------ | --------------- |
| BLOCKING | Spec violation or broken gate | Must fix        |
| NIT     | Non-blocking style or edge case | Note, don't block |
| DECLINE | Reviewer disagrees with suggestion | Explain why    |

## Minimalism Audit

If the builder wrote more code than the spec requires, that's a rejection
for over-engineering. Less code = fewer bugs. The reviewer audits for:

- Unnecessary abstractions
- Speculative API (exports not used by spec)
- Dead code
- Premature generalization

## Spec Compliance

Every interface, every type, every error code in the spec must be present
in the implementation. No "close enough." No "it's basically the same."

Exports must match spec 1:1. No extra exports beyond what the spec defines
(testability seams excepted — note them as NITs).

## Error Handling

- Custom error classes must use `override` on `cause` (noImplicitOverride)
- No `any` types — use `unknown` and narrow
- Error codes as string unions, not enums

## Scaffolding Checks

- `package.json`: dist outputs as `.mjs`/`.d.mts` (not `.js`/`.d.ts`)
- `project.json`: lint target without `--ext .ts` (ESLint 9 flat config)
- `project.json`: test target with `--passWithNoTests`

## Commit Hygiene

Before committing a wave, verify:

- `git status --short` — every impl + test file is at least staged
- No untracked impl files (recurrence of untracked-test-helpers drill finding)
- Exclude: `city.toml`, `agents/`, `.devin/`, `.gc/`, `.beads/`, `.evidence/`,
  `.opencode/`, `formulas/` (process improvement files)
- Stage only: `packages/<package>/**`, `specs/NN-<name>/`, `engdocs/`, `bun.lock`

## Process

1. Reviewer runs all gates fresh (not cached, not trusted from builder)
2. Reviewer reads the diff and spec
3. Reviewer classifies findings
4. APPROVE or REJECT with specific, actionable feedback
5. On REJECT: builder fixes, reviewer re-reviews
