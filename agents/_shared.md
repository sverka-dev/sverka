# Sverka Agents — Shared Context

All Sverka agents share this context. Each agent prompt references this file
instead of duplicating it.

## Narratives

Read `agents/_narratives.md` — 11 non-negotiable narratives governing all
Sverka agents.

## Skills

Skills are globally installed at `~/.agents/skills/`. Load by name before
starting work — the skill describes itself, you don't need to paraphrase it.

Project-specific skills live in `.agents/skills/`: `beads`, `gc-watchdog`,
`gh-stack`, `sverka`, `sverka-gh-stack`.

## Conventions

- TypeScript: strict, ESM. No `any` — use `unknown` and narrow.
- Public API exported from `src/index.ts`.
- Package manager: bun. Build: tsdown via nx. Test: vitest.
- Error handling: custom error classes per package with `override` on `cause`.
- Specs in `specs/NN-*/`, derived from `specs/architecture-spec.md`.
- Engineering docs in `engdocs/` before code.

## Commands

```bash
bun run test && bun run typecheck && bun run lint && bun run build
```

## Commit hygiene

Stage ONLY the wave's package files + specs + plans + bun.lock.
Do NOT commit (conservative profile). Do NOT stage:
`city.toml`, `agents/`, `.devin/`, `.gc/`, `.beads/`, `formulas/`.

## Beads

Run `bd prime` before any bead operations (`bd ready`, `bd show`, `bd close`,
etc.). Use `bd` for all task tracking — do NOT use markdown TODO lists.
Run `bd prime` at session start and when context is stale.

## Environment

Agent name: `$GC_AGENT`. City commands: `gc <cmd> --help`.
