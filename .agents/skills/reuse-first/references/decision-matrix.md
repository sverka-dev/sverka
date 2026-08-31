# Decision Matrix — Worked Examples

The SKILL.md gives the 4×4 matrix in compressed form. This reference expands it with concrete scenarios and the reasoning at each cell.

## The matrix (recap)

| Local match? | OSS match? | Dep acceptable? | Decision |
|---|---|---|---|
| Yes (≥80% coverage) | — | — | Reuse local |
| No | Yes | Yes | Add dependency |
| No | Yes | No (heavy for one function) | Hand to `dep-cost` |
| No | No | — | Write new + document why |

The interesting cells are the 2nd, 3rd, and 4th. The 1st is "obvious" but still requires you to verify the coverage.

## Example 1: "I need a debounce function"

**Local search:**
- `rg 'debounce' -t ts` → 4 hits
- `sg run -p 'export function debounce($$$ARGS): $RET { $$$BODY }' -l ts src/` → 1 match in `src/utils/timing.ts`
- Read the implementation — it does exactly what I need, including cancellation

**OSS search:** not needed, local covers it.

**Decision: reuse local.** Document: "Reused existing debounce in src/utils/timing.ts. Cancellation support is included; no change needed."

## Example 2: "I need a markdown parser for a Node app"

**Local search:** no matches.

**OSS search:**
- `gh search code "markdown to html" --language typescript --limit 5 --sort stars` → marked, markdown-it, remark
- DeepWiki on marked: confirms it does what I need
- `npm view marked dist.unpackedSize` → 142KB
- I'll use 80% of the API (headings, lists, code blocks, sanitization hooks)

**Decision: add dependency.** Document: "Added marked@^14. Reason: no local parser exists, marked is the boring choice (5M weekly downloads, last release 2026-05, MIT, 142KB). Used surface is high (~80% of API), so dep cost is justified."

## Example 3: "I need a date formatter"

**Local search:** no matches.

**OSS search:**
- `gh search code "date format" --language typescript --limit 5` → date-fns, dayjs, moment, luxon
- `npm view date-fns dist.unpackedSize` → 78MB unpacked (but tree-shakeable to 5-15KB)
- I'll use 2 functions: `format` and `parseISO`
- After tree-shaking, my bundle picks up ~3KB

**Decision: add dependency.** Document: "Added date-fns. Reason: tree-shakes to ~3KB for the 2 functions I use, which is cheaper than the 30-LOC reimplementation with locale handling. dep-cost measured 3KB post-shake vs ~80 LOC reimplement with locale edge cases."

But — the 2 functions might be reimplementable in 20 LOC without locale. In that case, hand to `dep-cost` for the formal comparison.

## Example 4: "I need a CSV parser"

**Local search:** no matches.

**OSS search:**
- `gh search code "csv parser" --language typescript --limit 5` → papaparse, csv-parse, fast-csv
- `npm view papaparse dist.unpackedSize` → 48KB
- I'll use 100% of the basic API
- Reimplementation would be ~200 LOC of tricky code (RFC 4180 compliance, edge cases like embedded quotes, newlines in fields, BOM handling)

**Decision: add dependency.** Document: "Added papaparse. Reason: RFC 4180 compliance is non-trivial to reimplement correctly; dep cost is 48KB but prevents subtle bugs in production. Hand-rolling would be 200+ LOC of tricky code with poor test coverage."

This is the "Critical or tricky" bucket — reimplement is the wrong call.

## Example 5: "I need a ZK proof verifier"

**Local search:** no matches.

**OSS search:**
- `gh search code "zk snark verifier"` → snarkjs, gnark, others
- Most are research-grade, license-restricted, or use specific curves
- Reimplementation: literally months of cryptographic work

**Decision: add dependency OR do not implement.** Document: "ZK verifier is out of scope for a typical app. If we need it, we adopt snarkjs and accept the dep cost. If we don't have a real use case, we defer."

This is the case where `reuse-first` might say "don't even start" — the cost-benefit is so lopsided that you only proceed if you have a real need.

## Example 6: "I need a Zod-style schema validator"

**Local search:** no schema library at all.

**OSS search:**
- zod, yup, joi, valibot
- valibot is the new "small" one (~10KB), zod is the standard (~50KB), joi is the legacy one

**Decision: add dependency.** But which one? This is the "multiple candidates" case — see "Choosing between candidates" below.

## Choosing between candidates

When `gh search` returns multiple viable options, the tie-breakers are:

1. **Used surface ratio** — if you'll use 5% of zod, maybe valibot is enough. Use `dep-cost` for the formal analysis.
2. **Boring wins** — the one with the most weekly downloads and the most boring API is usually the right one. Optimizing for "newer/faster/cooler" is rarely worth it.
3. **TypeScript-native vs adapter** — pick native first. Adapters add runtime cost and break type inference.
4. **Bundle size for client code** — for backend, bundle size doesn't matter. For client, prefer tree-shakeable ESM.
5. **Maintenance signal** — last release, open issues, contributor count.

If still tied, flip a coin. The cost of being wrong is low; you can migrate later.

## Edge case: "Local does 70% of what I need"

Reuse the local one and add the missing 30% as an extension, in the same file. Don't fork. Don't write a parallel implementation.

```typescript
// Reuse the existing utility and add the missing case
import { debounce } from './utils/timing';

export function debounceWithMaxWait<T>(fn: T, ms: number, maxWait: number): T {
  // 30% of new code that extends the existing utility
}
```

Document why this is an extension and not a parallel utility.

## Edge case: "OSS lib is unmaintained but works"

Three options:

1. **Fork and maintain** — last resort, only if the lib is critical and small
2. **Find a maintained successor** — usually exists, search the same category
3. **Plan the deprecation** — if you need a real migration plan, document the exit strategy and timeline

For greenfield, always pick option 2.

## Edge case: "Multiple libs do it, hard to choose"

Pick the boring one. Zod over valibot, react over preact, lodash over radash, etc. The "newer, faster, smaller" argument rarely beats the "more eyes, more Stack Overflow answers, more GitHub issues solved" argument.

## Recovering from a wrong call

If you added a dep and later realize it was wrong:

- **Reimplement**: profile first, then reimplement, then remove dep, then verify bundle size actually dropped
- **Replace**: pick a different lib, dual-write for one cycle, then remove the old one
- **Accept it**: if the cost of fixing is higher than the cost of leaving it, document and move on

The decision was defensible at the time. Don't beat yourself up. Update the evidence file with the postmortem.
