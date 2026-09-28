# Spec 50 — Pipeline visualization on the Pages site

**Status:** Active
**Source:** bead sv-4kqt
**Consumers:** `website/` (Astro/Starlight, deployed to GitHub Pages)

## Overview

Publish a `/pipeline/` page on the docs site that visualizes real
`sverka run` output in two sections:

1. **Self pipeline** — `sverka run --format json` executed against this
   repo during the Pages deploy. Always live data; ideally green, but a
   red pipeline must still render (the page must not fail the deploy).
2. **Examples** — `examples/*/` mini-projects with their own
   `sverka.config.ts`, each designed to produce a known state (all-green,
   planted check failures, SARIF findings + policy gate). Run for real at
   site-build time against the published `@sverka/cli` — honest data, not
   screenshots.

## Goals

- `website/scripts/gen-pipeline-data.ts` — runs the runs, writes
  `src/generated/pipelines.json` (gitignored). Never exits non-zero on a
  failed pipeline — failure IS the data. Only exits non-zero when no data
  could be produced at all.
- `website/src/pages/pipeline.astro` — static page: status badge, commit
  sha, duration, per-step chips (succeeded/failed/skipped), expandable
  stdout/stderr on failures.
- `examples/` — self-contained projects, each with `package.json`
  (`@sverka/cli` + `@sverka/workflow` devDeps) and its own lockfile.
- `deploy-website.yml` — root `bun install` + `bun run build` so the
  source CLI can run the self pipeline; examples use `bunx @sverka/cli`.
- Sidebar entry "Pipeline" added inside `sync-docs.ts` (generated file is
  rewritten each build — the link must be emitted there).

## Non-goals

- Pipeline DAG rendering (step list suffices for v1)
- Historical trends (each deploy shows the latest run only)
- Arena results on the site (separate product surface)
- Scheduled rebuilds for fresher status (workflow_dispatch stays manual)
