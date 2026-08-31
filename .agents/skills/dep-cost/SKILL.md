---
name: dep-cost
description: "Measure whether a dependency is worth its cost (bundle, install, surface, maintenance) for the part you actually use, and reimplement locally when it is not. Use before adding a new dependency, or when reviewing an existing one that pulls disproportionate weight for a small use. Sibling of reuse-first — that one finds candidates, this one judges whether to keep them."
metadata:
  tier: 2
  triggers: [user, model]
  source: theplenkov-ai/skills
---

# dep-cost

**When to use:** you are about to add a new dependency, or you are reviewing an existing one and suspect it is heavier than the use case justifies. Not a security audit (`security-and-hardening`), not a perf review of the whole app (`performance-investigation`), not a "is this the right version" check (`modern-stack`) — those are siblings, see Cross-references.

## The principle

Dependencies are not free. Every dep is permanent tax: install time, bundle size, supply-chain surface, upgrade burden, breaking-change risk, and the day it goes unmaintained. The default reflex — "just add it, it's on npm" — has made average JS bundles worse than they need to be by 10x in the last decade. Be suspicious of every new dep, and audit old ones periodically.

This skill operationalizes the dependency-awareness part of `minimal-root-cause`. The philosophy says "don't overengineer"; this skill says "here is how to measure when a dep is overengineering at the import level". Because this is an orchestrator, also load `subagents-setup` for delegation boundaries and `shared-plan` for shared planning.

## Procedure

Run in order. Stop after step 5 and surface a decision — do not commit the dep until you have one.

### 1. Identify the dep and what you actually use from it

List every import / require of the dep across the codebase. Group by what you call.

```bash
# Node.js
rg "from ['\"]<pkg>" -t ts -t js --no-filename | sort -u
rg "require\(['\"]<pkg>" -t ts -t js --no-filename | sort -u

# Python
rg "^(from|import) <pkg>" -t py --no-filename | sort -u

# Go
rg '"<pkg>' -t go --no-filename | sort -u

# Rust
rg 'use <pkg>' -t rust --no-filename | sort -u
```

For each unique import path, count call sites. The intersection (deps × used surface) is your "real" dep surface, often 5-30% of what the package actually exports.

### 2. Measure dep cost

Three numbers you want, in this order:

| Metric | What it tells you | How to get it |
|---|---|---|
| **Install / package size** | Onboarding pain, CI time, lockfile churn | `npm view <pkg> dist.unpackedSize` (Node) — for Python/Rust/Go see `measure-python.md` / `measure-rust.md` / `measure-go.md` |
| **Bundle size (production)** | What the user actually pays | `bundlephobia` (web) / `npx cost-of-modules@1.0.1` / `cargo bloat --release` |
| **Used surface / unused signal** | How much of the dep you need, or whether it is unused | Step 1 result / `npx depcheck@1.4.7` / `cargo udeps` / `go mod why` |

The third number is the most important. A 4MB dep where you use 8 functions (out of 200) is the canonical case for reimplementing.

### 3. Estimate reimplementation cost

Honest estimate, in three buckets:

| Bucket | Example | Reimplement verdict |
|---|---|---|
| **Trivial** (≤30 LOC, no edge cases) | `_.get(obj, path)`, `format(date, 'YYYY-MM-DD')` | Almost always yes — reimplement |
| **Tricky** (50-200 LOC, edge cases, formatting/parsing) | Markdown parser, CSV writer, color conversion | Borderline — measure both sides |
| **Critical** (security, crypto, standards compliance, battle-tested) | TLS, JWT, ICU, JPEG decoder, OAuth | Almost never reimplement — the dep is the point |

Be honest about the third bucket. Reimplementing JWT or `bcrypt` to save 200KB is how you get a CVE. The dep's existence is the value.

### 4. Cross-check the dep itself

Before deciding, look at the dep's own health:

- **Last release** — if > 18 months, flag as maintenance risk regardless of size
- **Weekly downloads** — a signal of trust, not a hard requirement
- **License** — must be compatible with the project
- **Open issues / PRs** — pending CVE? Abandoned maintainer? Hand off to `security-and-hardening`
- **Transitive deps** — the dep pulls N other deps. Add their costs to the total. `npm ls <pkg>`, `cargo tree -i <pkg>`

### 5. Decision

| Dep cost | Used surface | Reimpl cost | Decision |
|---|---|---|---|
| Small (<50KB) | Any | Any | **Keep** |
| Large | High (>40% of API) | Trivial | **Borderline** — usually keep, but if you only need 1-2 funcs, reimplement |
| Large | Low (<10% of API) | Trivial | **Reimplement** |
| Large | Low | Tricky | **Reimplement only if you have time to test it** |
| Any | Any | Critical | **Keep** — the dep is the value |
| Unmaintained | Any | Any | **Reimplement or replace** — document the exit strategy and timeline if a migration is needed |

**Always produce an evidence trail.** Output the install size, bundle size, used-surface / unused signal, transitive count, last release date, and your call. The point is not the decision; it is that the next reviewer can verify it in 30 seconds.

## What this skill is NOT

- Not a security audit. For CVE / supply-chain risk, hand to `security-and-hardening`.
- Not a version-bump check. For "is this the latest line", hand to `modern-stack`.
- Not a "is the bundle small" optimization. For overall app perf, hand to `performance-investigation`.
- Not a license review. For license compatibility, see SPDX / ScanCode / `license-checker`.

## Cross-references

This skill is an orchestrator. Load the cited skills too, plus `subagents-setup` for delegation and `shared-plan` for planning. See [related-skills.md](references/related-skills.md) for the full list.

## Top 5 mistakes

1. **"It's on npm, just use it"** without measuring. The default reflex that made every Node bundle 10x heavier in a decade.
2. **Reimplementing something that should never be reimplemented** — TLS, JWT, crypto, standards-compliant parsers. The dep is the value, not the convenience.
3. **Ignoring transitive deps.** A 50KB dep that pulls 12 transitive deps is not 50KB. `npm ls` it.
4. **Optimizing install size at the cost of correctness** for trivial wins. Saving 200KB on a date formatter is not worth a "Feb 30" bug.
5. **Doing this once and never again.** Deps rot. Re-audit on a cadence (e.g., quarterly, or before every major version bump). Add the audit to your CI.

## References

- `references/measure-node.md` — npm/pnpm/yarn, bundlephobia, depcheck, source-map-explorer
- `references/measure-python.md` — pip, pipdeptree, importtime, pydeps
- `references/measure-go.md` — go mod why, go list, bloat
- `references/measure-rust.md` — cargo tree, cargo bloat, cargo udeps
- `references/reimpl-cost-guide.md` — how to honestly estimate the LOC and risk of reimplementing
- `references/evidence-template.md` — the audit-trail output format
