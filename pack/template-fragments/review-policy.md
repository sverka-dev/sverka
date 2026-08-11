# Review Policy

This file defines the review policy for this project. The reviewer agent
follows this document. Copy it to the project root as `REVIEW.md` and adapt.

## Two-Axis Review

Every change is reviewed along two independent axes:

1. **Standards** — does the code follow the repo's documented coding
   standards plus a Fowler smell baseline?
2. **Spec** — does the code faithfully implement the originating issue /
   PRD / spec?

Both axes must pass. A change that is clean code but implements the wrong
thing is rejected. A change that implements the right thing with messy code
is rejected.

## Verification Bar

The reviewer runs all checks themselves, fresh (not cached, not trusted from
builder). No trusting builder claims.

- Tests: run them fresh (`--skip-nx-cache`), confirm they pass, confirm they test behavior
- Build: run it fresh (`--skip-nx-cache`), confirm it succeeds
- Lint: run it, confirm zero errors
- Typecheck: run it, confirm zero errors

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

## Error Handling

Custom error classes must use `override` on `cause` (noImplicitOverride).
No `any` types — use `unknown` and narrow.

## Process

1. Reviewer runs all gates fresh (not cached, not trusted from builder)
2. Reviewer reads the diff and spec
3. Reviewer classifies findings
4. APPROVE or REJECT with specific, actionable feedback
5. On REJECT: builder fixes, reviewer re-reviews
