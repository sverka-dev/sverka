# Evidence Template — Audit Trail

Every `reuse-first` run produces an evidence file. The format below is the contract between you (the agent) and the next person (or agent) who reads the diff.

## Why this format

- Forces honesty — you can't say "I searched" without showing what you searched
- Makes the decision auditable in 30 seconds
- Catches "I searched for 30 seconds and gave up" before it becomes a code review argument
- Becomes the input to dep-cost if a dep candidate surfaces

## Template

```markdown
# reuse-first evidence — <YYYY-MM-DD>

## Task
<one-line: what new code was being added>

## Step 1: Codebase size detection
- File count: <N>
- Decision: <skip local | full local search>
- Reason: <greenfield | small project | established codebase>

## Step 2: Local search

### rg results
- Command: `rg '<term>' -t <lang> -g '!{node_modules,dist,build}/'`
- Hits: <N>
- Top matches: <file:line> per match

### ast-grep results
- Command: `sg run -p '<pattern>' -l <lang> src/`
- Hits: <N>
- Top matches: <file:line> per match

### Symbol lookup (if used)
- Tool: <ctags | rg | skip>
- Result: <file:line> where X is defined

### Local candidate analysis
- File: <path>
- Coverage: <percentage of use case covered>
- Decision: <reuse | extend | reject>
- Reasoning: <2-3 sentences>

## Step 3: OSS search

### gh search code results
- Command: `gh search code '<term>' --language <lang> --limit 10 --sort stars`
- Top 5: <owner/repo per match with one-line note>

### DeepWiki (if used)
- Repos: <list>
- Key findings: <one-line per repo>

### Sourcegraph.com (if used)
- Query: <string>
- Top 3: <owner/repo per match>

### OSS candidate analysis
- Repo: <owner/repo>
- License: <SPDX>
- Last release: <YYYY-MM-DD>
- Weekly downloads: <N>
- Used surface: <percentage>
- Transitive deps: <count>
- Decision: <adopt | hand to dep-cost | reject>
- Reasoning: <2-3 sentences>

## Step 4: Final decision
<reuse local | add dependency | hand to dep-cost | write new>

## Step 5: Reasoning
<2-5 sentences explaining the decision>

## Step 6: Negative evidence
<what was searched that returned nothing — this is the most important part for trust>
```

## Worked example (filled in)

```markdown
# reuse-first evidence — 2026-07-27

## Task
Add a debounce utility to a React hooks file.

## Step 1: Codebase size detection
- File count: 247
- Decision: full local search
- Reason: established codebase

## Step 2: Local search

### rg results
- Command: `rg 'debounce' -t ts -t js -g '!{node_modules,dist,build}/'`
- Hits: 4
- Top matches:
  - src/utils/timing.ts:12 — `export function debounce<T>(fn: T, ms: number)`
  - src/hooks/useDebouncedValue.ts:1 — `import { debounce } from '../utils/timing'`
  - src/utils/eventHelpers.ts:45 — uses debounce internally
  - src/utils/eventHelpers.ts:78 — uses debounce internally

### ast-grep results
- Command: `sg run -p 'export function debounce($$$ARGS): $RET { $$$BODY }' -l ts src/`
- Hits: 1
- Top matches: src/utils/timing.ts:12

### Local candidate analysis
- File: src/utils/timing.ts
- Coverage: 100% (function, signature, and cancellation support all match the use case)
- Decision: reuse
- Reasoning: Existing utility in src/utils/timing.ts already provides debounce with
  generic types and cancellation. No new code needed; just import.

## Step 3: OSS search
- Skipped: local candidate covers 100%, no need to look outside.

## Step 4: Final decision
reuse local

## Step 5: Reasoning
The local utility in src/utils/timing.ts already provides debounce with generic
types, cancellation support, and matches the use case exactly. No new code
should be written; the right action is to import the existing utility and
remove the inline debounce that triggered this task.

## Step 6: Negative evidence
- OSS search was not performed because local coverage was 100%.
- If local had not covered, OSS candidates to consider: lodash.debounce (too
  heavy for one function), throttled-queue (different semantics).
```

## Common mistakes in evidence files

1. **"Searched for X" with no command shown.** What was the exact query? `rg` is fast, run it again.
2. **"No matches" without showing the command.** Show the command so the next person can verify.
3. **Decision with no reasoning.** The decision is not the point; the reasoning is.
4. **No negative evidence.** What didn't you find? That's the most important part.
5. **Hiding uncertainty.** If you're not sure, say so. "Coverage appears to be 70%, but I haven't tested edge case Y" is honest.

## Where to store evidence files

Options, in order of preference:

1. **In the PR description** as a section, if the work is part of a PR
2. **In a comment on the issue** if the work is part of an issue
3. **In a `docs/decisions/YYYY-MM-DD-reuse-first-<task>.md`** in the repo, if the decision is significant
4. **In the commit message body** if the work is part of a commit

Pick the lightest option that the team will actually read.
