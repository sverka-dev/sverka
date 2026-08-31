---
name: reuse-first
description: "Search locally and in open-source for existing solutions before writing non-trivial code. Use before adding a new function, utility, module, or significant code block. Skip one-liners and trivial refactors. Operationalizes minimal-root-cause with a decision matrix and tool bootstrap."
metadata:
  tier: 2
  triggers: [user, model]
  source: theplenkov-ai/skills
---

# reuse-first

**When to use:** you are about to write a new function, utility, module, or > 30 LOC of net-new code, and you have not yet proved that nothing existing does the job. Not a debugging skill (`investigate-first`) and not a "be lazy about patching" skill (`minimal-root-cause`) — those are siblings, see Cross-references.

## The principle

The cheapest code is code that already exists and is already paid for. The most expensive code is the new code that duplicates existing code, because you pay it forever (maintenance) and forget why you wrote it (knowledge debt). Before writing anything non-trivial, prove — don't assume — that nothing existing does the job.

This skill operationalizes `minimal-root-cause` and Rule 0 of `token-rationalism` (search before you read). The philosophy says "be lazy about the new solution"; this skill says "here are the exact CLI calls to be lazy with, and here is the decision matrix when nothing matches".

## Procedure

Run in order. Stop after step 5 and surface a decision — do not write code until you have one.

### 1. Detect codebase size

Tiny / greenfield projects skip the local-search step entirely.

```bash
file_count=$(node -e 'const fs=require("fs"),path=require("path");
const exts=new Set([".ts",".py",".go",".rs",".java"]);
const skip=new Set(["node_modules",".git","dist","build"]);
let c=0;
function walk(d){ for(const e of fs.readdirSync(d,{withFileTypes:true})){ const n=e.name; if(e.isDirectory()){ if(!skip.has(n)) walk(path.join(d,n)); } else if(exts.has(path.extname(n))) c++; } }
walk(".");
process.stdout.write(String(c));')
skip_local=false
if [ "$file_count" -lt 20 ]; then
  echo "[reuse-first] tiny codebase ($file_count files) — skipping local search, going to OSS"
  skip_local=true
fi
```

### 2. Ensure local search tools

Do not assume the env is set up. Verify, then ask before installing.

```bash
if [ "$skip_local" = true ]; then
  echo "[reuse-first] greenfield project — skipping local tool setup and search"
else
  rg_available=true
  sg_available=true
  ctags_available=true

  ensure_tool() {
    local tool=$1 install=$2 fallback=$3
    if [ -x "$(command -v "$tool")" ]; then
      return 0
    fi
    echo "[reuse-first] $tool not found."
    echo "  Install: $install"
    echo "  Fallback if declined: $fallback"
    # ASK USER — never install without explicit yes.
    # On yes: run the install command; on no or failure: execute the fallback.
    eval "$fallback"
    return 1
  }

  ensure_tool "rg"    "brew install ripgrep / apt install ripgrep" "rg_available=false"
  ensure_tool "sg"    "brew install ast-grep"                     "sg_available=false"
  ensure_tool "ctags" "brew install universal-ctags"               "ctags_available=false"
fi
```

**Install cost tiers** (the skill MUST respect these when auto-suggesting):

| Tier | Examples | Behavior |
|---|---|---|
| Light (<10MB, <30s, no deps) | `rg`, `ast-grep`, `ctags`, `src` for public | Suggest eagerly |
| Medium (<100MB) | `scip-typescript`, `semgrep` | Ask with description, give choice |
| Heavy (server / model) | ollama + embeddings, self-hosted Sourcegraph Docker | Never auto-suggest; reference only |

### 3. Local search — does it already exist?

If `$skip_local` is `true`, skip this step and go to step 4 (OSS search). If a tool was marked unavailable in step 2 (its `_available` flag is `false`), use the fallback described there.

In order of signal quality, not convenience:

1. **Structural AST** (best signal: "function with this shape"): `sg run -p '<pattern>' -l <lang> <path>`
   Example: `sg run -p 'export function $NAME($$$ARGS): Promise<$$$RET> { $$$BODY }' -l ts src/`
2. **Symbol lookup** (where is X defined): if ctags index exists, query it; otherwise `rg -l '^(export )?(async )?function <name>\b\|^const <name>\s*='`
3. **Text search** (does X appear anywhere): `rg '<term>' -t <lang> -g '!{node_modules,.git,dist,build,vendor}/'`

For each match: read the actual implementation, not just the signature. "Similar shape" is not "covers my use case" — many functions match a pattern but break on edge cases.

### 4. OSS search — does open source do this?

In order of cost, lowest first:

1. **GitHub Code Search**: `gh search code '<specific term>' --limit 10` (works on public + auth'd private)
2. **DeepWiki** for the top 2-3 candidates: read the AI-summary, check it actually solves the use case
3. **Sourcegraph.com public** (no auth for public code): `curl -s 'https://sourcegraph.com/.api/search/stream?q=context:global+<term>&v=V3' | head -100`
4. **Sourcegraph Deep Search** (semantic): public web UI or MCP at `mcp.sourcegraph.com` — best when the term is fuzzy or the task is "find libraries that handle X kind of problem"

For each candidate library, check: (a) last release date, (b) weekly downloads, (c) license, (d) whether the dep is heavier than the use case. If (d) fails, hand off to `dep-cost` for the reimplement-or-keep analysis.

### 5. Decision

| Local match? | OSS match? | Dep acceptable? | Decision |
|---|---|---|---|
| Yes (≥80% coverage) | — | — | **Reuse local** |
| No | Yes | Yes | **Add dependency** |
| No | Yes | **No** (heavy for one function) | **Hand to `dep-cost`** |
| No | No | — | **Write new** — and document what was searched and why nothing matched |

**Always produce an evidence trail.** Output the commands you ran, the matches you got, and the reasoning. The point is not the decision — it is that the decision is defensible by the next person who reads the diff.

## What this skill is NOT

- Not a replacement for `minimal-root-cause` — that is the philosophy; this is the procedure. Both load together.
- Not a license to doomscroll OSS for hours. Set a time budget. 5 minutes of searching is usually enough; if nothing surfaces, the answer is "write it", not "search for 45 more minutes".
- Not always required. One-liners, typo fixes, trivial refactors, and tests do not need it. Threshold: "would I add a new function or new file?" If yes, run this.

## Cross-references

This skill is an orchestrator. Load the cited skills too — they hold the depth. See [related-skills.md](references/related-skills.md) for the full list.

## Top 5 mistakes

1. **Searched 5 minutes, found nothing, wrote from scratch anyway.** Wrong. Document what you searched, what you did not find, and the negative evidence. "I searched" is not the same as "I searched and found nothing".
2. **"Similar signature" treated as "covers my use case".** Read the actual implementation. Many functions match a pattern and break on edge cases that matter to you.
3. **Adding a 4MB dep for one function.** Hand off to `dep-cost` — that is its trigger condition.
4. **Skipping local search because "we have nothing like this".** You have 200k LOC and a transitive dep tree. You have something. `sg` will find it if you ask the right question.
5. **Doing this manually without logging the commands.** The output is the audit trail. Without it, the next person repeats the search, and the next agent after that has no evidence the work was done.

## References

- `references/local-search.md` — concrete `rg` / `sg` recipes by language and pattern type
- `references/oss-search.md` — `gh search` + DeepWiki + Sourcegraph.com recipes with output examples
- `references/greenfield.md` — when to skip local search and go straight to OSS
- `references/decision-matrix.md` — full decision tree with worked examples
- `references/evidence-template.md` — the audit-trail output format
