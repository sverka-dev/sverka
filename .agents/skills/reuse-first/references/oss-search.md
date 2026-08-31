# OSS Search Recipes

<!-- os-independence-exempt: intentional POSIX bash recipes; on Windows run under Git Bash or WSL -->

Concrete recipes for `gh search code`, DeepWiki, and Sourcegraph.com. Use this reference when running `reuse-first` step 4 (OSS search).

## Tool priority (lowest cost first)

1. **`gh search code`** — fast, requires `gh` auth'd, public + your accessible private
2. **DeepWiki MCP** — AI summary, good for top candidates
3. **Sourcegraph.com** — semantic + global, no auth for public code
4. **Sourcegraph Deep Search** — when the term is fuzzy or abstract

Stop as soon as a tool returns a usable candidate; don't keep going for "completeness".

## gh search code

### Basic search

```bash
gh search code "debounce" --limit 10 --sort stars
gh search code "debounce typescript" --limit 10 --sort stars
gh search code "language:typescript debounce function" --limit 10
```

### Filter by language

```bash
gh search code "useDebounce" --language typescript --limit 10
gh search code "class Trie" --language python --limit 10
```

### Search within an org (fork candidates)

```bash
gh search code "func Name() error" --owner golang --limit 10
```

### Sort and filter

```bash
gh search code "markdown parser" --limit 20 --sort stars | head -10
# Then read each repo's README before going further
```

### Read a candidate repo

```bash
gh repo view owner/repo --json name,description,stargazerCount,pushedAt,licenseInfo
gh repo view owner/repo --json releases --jq '.releases[0]'
# If last release > 18 months, flag as maintenance risk.
```

## DeepWiki (MCP)

Public, no-auth MCP server at `https://mcp.deepwiki.com/mcp`. Three tools: `read_wiki_structure`, `read_wiki_contents`, `ask_question`.

### Read a candidate's structure

```bash
# Use the mavis/deepwiki skill — do not call raw JSON-RPC unless you must
mavis mcp call deepwiki read_wiki_structure '{"repoName": "lodash/lodash"}'
# Returns: list of modules, key files
```

### Ask a targeted question

```bash
mavis mcp call deepwiki ask_question '{
  "repoName": "lodash/lodash",
  "question": "What debounce/throttle utilities does lodash provide and what is their exact signature?"
}'
# Returns: AI summary with file/line references
```

### When to use DeepWiki

- Top 1-3 candidates from `gh search` — verify the repo actually does what the description claims
- Check if a large library has the small thing you need (so you don't pull a 4MB dep for one function)
- Understand how a library is organized before adopting

## Sourcegraph.com (public, no auth)

### Stream search

```bash
curl -s 'https://sourcegraph.com/.api/search/stream?q=context:global+%22debounce%22+lang:typescript&v=V3' | head -50
```

### Query syntax

- `context:global` — search all public code
- `lang:typescript`, `lang:python`, etc.
- `repo:^github\.com/owner/repo$` — restrict to a repo (escape the dots)
- `file:^.*\.ts$` — restrict by file pattern
- Boolean: `and`, `or`, `not`

### When to use

- Wider net than GitHub (searches GitLab, Bitbucket, etc.)
- Cross-language or cross-platform comparison
- When `gh search` returns too few results

## Sourcegraph Deep Search

Web UI: `https://sourcegraph.com/search?q=deep-search` (or via Deep Search button on any sourcegraph.com page).
MCP: at `mcp.sourcegraph.com` (or your private endpoint).

### When to use

- Term is fuzzy / abstract: "find libraries that handle eventual consistency"
- Exhausted `gh search` and `sourcegraph.com` and want one more layer of semantic matching
- Want AI-summarized results across many repos

### What it's NOT

- Not a replacement for reading the README. Use Deep Search to find candidates, then read the actual code.

## Evaluating a candidate

For each candidate library, capture:

| Field | Why | Where to find |
|---|---|---|
| License | Must be compatible | `LICENSE` file / `gh repo view --json licenseInfo` |
| Last release | > 18 months = risk | `gh repo view --json releases` |
| Weekly downloads | Signal of trust | npmjs.com / pypistats.org / crates.io |
| Stars | Faint signal, not a verdict | `gh repo view --json stargazerCount` |
| Open issues / PRs | Pending CVE? | `gh issue list --repo owner/repo --state all --limit 50` |
| Transitive deps | The real bundle cost | `npm ls pkg` / `cargo tree -i pkg` |
| Bus factor | Maintainer count | `git log --format='%ae' \| sort -u \| wc -l` |

Hard fails: license, last release, vulnerabilities. Drop the candidate immediately on any of these.
Soft fails: stars, downloads, bus factor. Document and proceed if not failing.

## Worked example

**Task:** need a markdown parser for a Node app that produces sanitized HTML.

```bash
# Step 1: gh search
gh search code "markdown to html" --language typescript --limit 10 --sort stars
# → marked, markdown-it, remark, showdown

# Step 2: read each via DeepWiki
mavis mcp call deepwiki ask_question '{"repoName":"markedjs/marked","question":"How do I use marked to produce sanitized HTML?"}'
mavis mcp call deepwiki ask_question '{"repoName":"markdown-it/markdown-it","question":"Plugin architecture for sanitization?"}'

# Step 3: measure
npm view marked dist.unpackedSize        # → 142KB
npm view markdown-it dist.unpackedSize   # → 89KB

# Step 4: check freshness
gh repo view markedjs/marked --json releases --jq '.releases[0].publishedAt'
# → 2026-05-12 (recent ✓)

# Decision: marked, 142KB, 5M weekly downloads, well-maintained.
# → Add to deps. Hand to dep-cost only if used surface is < 5%.
```

## Common gotchas

1. **Stars are not a verdict.** 30k stars can be abandoned. Always check `pushedAt`.
2. **"Featured" on npm is curated, not maintained.** `npm view <pkg> time` shows latest publish.
3. **Transitive deps are the real cost.** `npm ls <pkg>` is mandatory before dep-cost finalizes.
4. **License compatibility is not optional.** MIT/BSD/Apache compatible; GPL needs legal review; unlicensed is a hard no.
5. **0 weekly downloads is not "obscure" — it's a fork candidate at best.** Drop it.
6. **A repo that hasn't been pushed to in 18 months is not "stable" — it's risky.** Maintenance freeze != stability.
