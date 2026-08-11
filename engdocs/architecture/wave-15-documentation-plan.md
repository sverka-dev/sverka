# Wave 15 — Documentation: Implementation Plan

## Branch

`wave-15-documentation` (off `wave-14-website` @ e62ebbc)

## Approach

Markdown only. No package, no TypeScript, no build, no tests to run. The
builder writes 9 content pages + 1 index, updates 2 existing files, then
the reviewer verifies accuracy via grep cross-reference.

## Steps

### Step 1: Scaffold the directory tree

```
mkdir -p engdocs/user/{getting-started,workflow-api,cli,checks,compilers,findings,policy}
```

### Step 2: Write `engdocs/user/README.md`

Index page listing all 9 user doc pages with one-line descriptions and
links. Follow the style of `engdocs/README.md`.

### Step 3: Write getting-started pages

- `getting-started/install.md` — prerequisites (Node 24+, Bun), `bun
  install`, `bunx sverka init`. Link to first-plan.
- `getting-started/first-plan.md` — complete working example:
  ```ts
  import { defineWorkflow, pipeline, task, run } from "@sverka/sdk";
  export default defineWorkflow({
    name: "verify",
    workflow: pipeline(
      task("lint", run({ command: "bun", args: ["run", "lint"] })),
      task("typecheck", run({ command: "bun", args: ["run", "typecheck"] })),
      task("test", run({ command: "bun", args: ["run", "test"] })),
    ),
  });
  ```
  Then `bunx sverka plan` and `bunx sverka execute`.

### Step 4: Write `workflow-api/overview.md`

Document the 7 composables exported from `@sverka/sdk`:
`pipeline`, `run`, `parallel`, `when`, `matrix`, `task`, `defineWorkflow`.
One signature + one example each. Cross-reference against
`packages/core/src/` for actual signatures.

### Step 5: Write `cli/overview.md`

Document the 7 commands and their flags. Source of truth:
`packages/cli/src/main.ts`. Include exit code table. Note `execute` alias
`run`. Note `baseline` subcommands: create, update, show, clear.

### Step 6: Write `checks/builtin.md`

6 check IDs: `typecheck`, `lint`, `test`, `clippy`, `vet`, `fmt-check`.
Per-PM resolution (bun/npm/yarn/pnpm for Node). `createBuiltinResolver()`
and `extractFindings()` from `@sverka/sdk`. Source:
`packages/checks/src/resolver.ts`.

### Step 7: Write compiler pages

- `compilers/github.md` — `compileGithubWorkflow(plan, config?)` from
  `@sverka/compiler-github`. Show YAML output example. Source:
  `packages/compiler-github/src/compile.ts`.
- `compilers/gitlab.md` — `compileGitlabCi(plan, config?)` from
  `@sverka/compiler-gitlab`. Show YAML output example. Source:
  `packages/compiler-gitlab/src/compile.ts`.

### Step 8: Write findings and policy pages

- `findings/normalization.md` — `normalizeSarif`, `computeFingerprint`,
  baseline CRUD, `filterOnlyNew`. Source: `packages/findings/src/`.
- `policy/evaluation.md` — `evaluatePolicy`, `DEFAULT_POLICY`,
  `createPolicy`, `FailOnRule`, `Verdict`. Source: `packages/policy/src/`.

### Step 9: Update `engdocs/README.md`

Add "User docs" section after the existing structure section, linking to
`user/README.md` and listing the 7 sections.

### Step 10: Update `website/src/pages/docs.astro`

Replace the placeholder list items (Workflow API, CLI Reference, etc.)
with links to the actual GitHub paths under `engdocs/user/`.

## Verification (reviewer)

1. `find engdocs/user -name '*.md'` — 10 files exist (README + 9 pages).
2. Link check: extract all `](...)` links from user docs, verify each
   internal path exists.
3. Code example accuracy: grep every function/type name used in code
   blocks against `packages/sdk/src/index.ts` and relevant package
   `src/index.ts` files.
4. CLI accuracy: every command/flag in `cli/overview.md` exists in
  `packages/cli/src/main.ts`.
5. Completeness: every runtime function exported from `@sverka/sdk` is
   mentioned in at least one user doc page.
6. No malformed markdown (unclosed code fences).

## Commit hygiene

Stage ONLY:
- `engdocs/user/**` (all new files)
- `engdocs/README.md` (modified)
- `website/src/pages/docs.astro` (modified)
- `specs/15-documentation/spec.md` (trimmed)
- `engdocs/architecture/wave-15-documentation-plan.md` (this plan)

EXCLUDE: `city.toml`, `agents/`, `.devin/`, `.gc/`, `.beads/`, `.evidence/`,
`.opencode/`, `formulas/`.
