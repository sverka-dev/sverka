# Spec 37 — Markdown Authoring

**Status:** Active
**Source:** specs/architecture-spec.md §9 (Authoring Surfaces), §13 (Triggers), §14 (Runtime), §15 (Operations)
**Package:** `@sverka/sdk` (markdown sub-module)
**Capability:** N/A (authoring surface, not a target/engine)
**Related:** ADR-017, Spec 03 (SDK authoring), Spec 01 (constructs)

## Overview

A fourth authoring surface: `.sverka.md` files with YAML frontmatter
(triggers, pipeline metadata) + Markdown step lists. `sverka` auto-
discovers `.sverka.md` files and compiles them to Definition Graphs via
the existing Construct API. Covers a deliberate subset — triggers,
shell steps, dependencies, runtime image. An `extends` escape hatch
mixes Markdown with full TypeScript for complex cases.

## Goals

- `parseMarkdown(source: string, filePath?: string): Project` — parse a
  Markdown source string into a `Project` construct.
- `loadMarkdownFile(path: string): Promise<Project>` — read + parse.
- Frontmatter fields: `pipeline` (id), `triggers` (array), `extends`
  (path to .ts config), `inputs` (record).
- Step syntax: `## step-id` headings with ` - command: ...` and
  optional `depends_on:`, `image:`, `timeout:`, `outputs:`.
- CLI auto-discovery: `sverka validate` finds `.sverka.md` files when
  no `sverka.config.ts` exists.
- `extends: ./sverka.config.ts` — Markdown pipeline merges into the
  TypeScript Project (escape hatch for advanced features).

## Non-goals

- Matrix, conditions, expressions in Markdown — use `extends` + TS.
- Agent steps, saga, safe-outputs in Markdown — use `extends` + TS.
- Multiple pipelines per Markdown file — one pipeline per file.
- Markdown validation/linting beyond structural parsing.
- Round-trip (Graph → Markdown) — write-only surface.
- Hot reload / file watching.

## Interfaces

```ts
interface MarkdownFrontmatter {
  readonly pipeline: string;
  readonly triggers?: readonly MarkdownTrigger[];
  readonly extends?: string;
  readonly inputs?: Readonly<Record<string, Input>>;
}

interface MarkdownTrigger {
  readonly kind: "push" | "changeRequest" | "manual" | "schedule";
  readonly branches?: readonly string[];
  readonly tags?: readonly string[];
  readonly paths?: readonly string[];
  readonly cron?: string;  // schedule only
}

interface MarkdownStep {
  readonly id: string;
  readonly command: string;
  readonly dependsOn?: readonly string[];
  readonly image?: string;
  readonly timeout?: number;  // ms
  readonly outputs?: Readonly<Record<string, OutputDeclaration>>;
}

function parseMarkdown(source: string, filePath?: string): Project;
function loadMarkdownFile(path: string): Promise<Project>;
```

Exported from `@sverka/sdk`.

## Data models

### Markdown file format

```markdown
---
pipeline: ci
triggers:
  - kind: push
    branches: [main]
  - kind: manual
inputs:
  nodeVersion:
    type: string
    default: "22"
---

## build

 - command: bun run build
 - image: oven/bun:latest
 - outputs:
     dist:
       type: artifact
       path: ./dist

## test

 - command: bun test
 - dependsOn: [build]
```

### Parsing pipeline

1. Extract YAML frontmatter (between `---` delimiters).
2. Parse frontmatter with `yaml` library (already a dep).
3. Parse step sections: `## <id>` heading → step block.
4. Each step block: parse ` - key: value` lines into `MarkdownStep`.
5. Build `Project` + `Pipeline` + `ShellStep` + `Entry` constructs.
6. If `extends` set: load the TS config, merge Markdown pipeline into
   that Project (Markdown pipeline appended to existing Project).

## Error handling

`MarkdownParseError` with `override readonly cause: unknown`. Codes:
- `INVALID_FRONTMATTER` — YAML parse error or missing `pipeline` field.
- `INVALID_STEP` — step block missing `command` or has invalid syntax.
- `INVALID_TRIGGER` — unknown trigger kind or missing required field.
- `EXTENDS_NOT_FOUND` — `extends` path does not resolve to a file.

## Test plan

1. Minimal file (1 step, 1 trigger) → valid Project with 1 pipeline.
2. Multi-step file with dependencies → correct DAG.
3. All 4 trigger kinds parsed correctly.
4. `extends` merges Markdown pipeline into TS Project.
5. `extends` path not found → `EXTENDS_NOT_FOUND` error.
6. Missing `pipeline` in frontmatter → `INVALID_FRONTMATTER` error.
7. Step missing `command` → `INVALID_STEP` error.
8. Unknown trigger kind → `INVALID_TRIGGER` error.
9. Outputs parsed (artifact + scalar).
10. Timeout parsed correctly.
11. Image parsed → runtime.container with image.
12. No frontmatter → `INVALID_FRONTMATTER` error.
13. Empty step list → valid Project with empty pipeline (no error).
14. `loadMarkdownFile` reads + parses from disk.
15. Determinism: same source → identical Project (synthesize → compare
    graphs).
16. Public API: `parseMarkdown` + `loadMarkdownFile` + types exported.
