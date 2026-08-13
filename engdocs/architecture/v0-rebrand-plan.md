# v0 Rebrand Plan — AI-first Landing Page + Use Case Matrix

**Task:** sv-3b8u (P0)
**Branch:** rebrand/ai-first (stacks on refactor/cdk-split @ 3b35815)

## Critical findings (architect review)

The task description and the existing `engdocs/user/ai-use-cases.md` (untracked,
126 lines, from a prior session) contain **three factual errors** that would
make the rebrand dishonest if shipped as-is:

1. **`sverka compile` does not exist.** The CLI command is `sverka synth`, and
   it is a **STUB** that returns `ExitCode.UsageError`. The target packages
   (`@sverka/github`, `@sverka/gitlab`) exist and export `compileGithub` /
   `compileGitlab`, but they are **not wired into the CLI**. The stub comment
   says "requires Waves H/I" — those waves are **complete**. The stub is stale.

2. **No AI integration exists.** The task asks for "Claude plugin + AI skill"
   and "/sverka command" positioning. Neither exists. No Claude plugin, no AI
   skill, no `/sverka` slash command. The existing ai-use-cases.md lists
   "Claude plugin" and "AI skill" as integration surfaces — they don't exist.

3. **Token savings are estimates, not measured.** The numbers (~5000 vs ~50)
   are plausible but unverified. They should be labeled as estimates.

### What DOES exist (AI-friendly features)

- `--format json` on **all 10 CLI commands** — structured output for agent
  consumption. This is the real AI integration.
- Single-command pipeline execution (`sverka run`).
- Discovery without codebase exploration (`sverka discover`).
- Structured findings (SARIF normalization, fingerprints, baseline diff).
- Policy evaluation (`sverka policy`).
- Target lowering packages that work (`@sverka/github`, `@sverka/gitlab`) but
  are not CLI-accessible.

## Proposed approach

### Phase 0 (prerequisite): Wire the `synth` command

The `synth` stub is stale — Waves H/I are done. Wiring it is ~30 lines:

- Add `@sverka/github` and `@sverka/gitlab` to `packages/cli/package.json` deps.
- Replace the stub body in `packages/cli/src/commands/synth.ts` with calls to
  `compileGithub(graph)` / `compileGitlab(graph)`.
- Output YAML to stdout (human) or JSON envelope (json format).
- Add tests: synth --target github produces valid YAML, synth --target gitlab
  produces valid YAML, unknown target exits 2.

This makes `sverka synth --target github` actually work, so the use case
matrix can document it honestly.

**Decision needed from mayor:** include this code change in the rebrand PR,
or keep the PR docs-only and mark `synth` as "planned" in the use case matrix?

### Phase 1: AI Use Case Matrix (`engdocs/user/ai-use-cases.md`)

Rewrite the existing file to be honest:

- Remove "Claude plugin" and "AI skill" as existing integration surfaces.
  Replace with: "CLI with `--format json`" (exists) and "Claude plugin /
  AI skill" (planned, not yet built).
- Use `sverka synth` (not `sverka compile`).
- Label token savings as estimates.
- Keep the 8 use case scenarios — they're concrete and valuable.
- Keep the CLI command reference table.
- Keep the token math section (labeled as estimate).

### Phase 2: Landing Page Rewrite (`website/src/content/docs/index.mdx`)

Starlight splash template with AI-first hero:

- **Hero tagline:** "AI-first verification framework. One command. Full
  pipeline. Zero token waste."
- **6 cards:**
  1. AI-first — `--format json` on every command. Agents call `sverka run`,
     get structured results. No output parsing.
  2. Token-efficient — Delegate orchestration to the pipeline, not the LLM.
     Agent says what, Sverka handles how.
  3. Localhost engine — Everything runs locally. No cloud, no remote API calls.
  4. TypeScript SDK + DSL — Author workflows in code. Construct, SDK, and
     Decorator APIs produce the same Definition Graph.
  5. CLI — `sverka plan`, `run`, `check`, `synth`, `validate`, `discover`,
     `policy`, `graph`, `doctor`. One tool, full pipeline.
  6. Compile to CI — Same workflow lowers to GitHub Actions or GitLab CI YAML.
     Native lowering, not thin wrappers.
- **Body:** Lead with the agent use case. Then framework components. Then
  how it works (author → plan → run → synth).
- **Secondary:** provider-neutral, target lowering, conformance suite.

### Phase 3: Sync + verify

- Run `bun run sync-docs` in website/ to sync `engdocs/user/ai-use-cases.md`
  to `website/src/content/docs/user/ai-use-cases.md`.
- Run `bun run check` (astro check) — 0 errors.
- Run `bun run build` (astro build) — pages build.
- Preview locally.

## Deliverables

| File | Action |
|------|--------|
| `engdocs/user/ai-use-cases.md` | Rewrite (fix inaccuracies) |
| `website/src/content/docs/index.mdx` | Rewrite (AI-first landing page) |
| `packages/cli/src/commands/synth.ts` | **If mayor approves Phase 0:** wire to target packages |
| `packages/cli/package.json` | **If mayor approves Phase 0:** add github/gitlab deps |
| `packages/cli/src/__tests__/synth.test.ts` | **If mayor approves Phase 0:** new test file |

## Gates

- Website: `astro check` 0 errors, `astro build` succeeds.
- CLI (if Phase 0): `vitest` pass, `typecheck` clean, `lint` clean, `build` clean.
- No `any` in any new code.

## Commit hygiene

Stage ONLY:
- `engdocs/user/ai-use-cases.md`
- `website/src/content/docs/index.mdx`
- `website/sidebar.generated.mjs` (if regenerated)
- `packages/cli/src/commands/synth.ts` + `package.json` + `__tests__/synth.test.ts` (if Phase 0)
- `bun.lock` (if deps changed)

EXCLUDE: `specs/02,03,05,06,17` (uncommitted cdk-split spec renames — separate
concern), `city.toml`, `agents/`, `.devin/`, `.gc/`, `.beads/`, `.evidence/`,
`.opencode/`, `formulas/`, `.agents/skills/` (untracked Cloudflare skills).
