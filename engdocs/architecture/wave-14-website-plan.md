# Wave 14 — Website Implementation Plan

## Context

The website already exists as a functional Astro scaffold at `website/`. It
has 3 pages (index, docs, getting-started), a Base layout with SEO meta
tags, and a global CSS with a dark monochrome theme. `astro build` succeeds
(3 pages, ~950ms).

This wave fills the gaps: sitemap, 404 page, robots.txt, canonical URLs,
and fixes code examples to match the actual implemented API.

The website is a **standalone project** — NOT part of the bun workspace or
nx monorepo. It has its own `package.json` and `bun.lock`. Gates are
`astro check` and `astro build`.

## Spec amendments (14 cuts)

| Cut | Reason |
|-----|--------|
| `WebsiteBuildError` + `WebsiteErrorCode` | Static site, Astro handles build errors natively |
| `designTokens` TS export | CSS custom properties in global.css are the tokens |
| JSON data models | Inline content in .astro files for 3 pages |
| `BaseLayoutProps` interface | Astro's native frontmatter Props pattern |
| Component inventory (6 components) | Each would have 1 consumer — premature abstraction |
| `ogImage` prop | No OG image asset exists |
| axe-core tests | Gold-plating for v1 |
| Snapshot tests | Gold-plating for v1 |
| Performance budget (20KB) | Gold-plating for v1 |
| "Tests run via `bun test`" | Use `astro check` + `astro build` instead |
| Inter + JetBrains Mono fonts | System fonts are faster, already implemented |
| "single light theme" | Existing dark theme is functional, high-contrast |
| Docs links to non-existent pages | Link to GitHub instead, text descriptions for unbuilt guides |
| `build.inlineStylesheets` config | Already the Astro default behavior |

## Steps (TDD-adjacent: verify after each change)

### Step 1: Install dependencies

```bash
cd "$(git rev-parse --show-toplevel)/website"
bun add @astrojs/sitemap
bun add -d @astrojs/check typescript
```

### Step 2: Add sitemap integration

Update `astro.config.mjs`:

```javascript
import { defineConfig } from "astro/config";
import sitemap from "@astrojs/sitemap";

export default defineConfig({
  site: "https://sverka.dev",
  output: "static",
  integrations: [sitemap()],
  compressHTML: true,
  build: {
    inlineStylesheets: "auto",
  },
});
```

Verify: `bun run build` produces `dist/sitemap-index.xml`.

### Step 3: Add canonical URLs to Base.astro

Add `<link rel="canonical" href={Astro.url.href} />` to the `<head>` in
`src/layouts/Base.astro`. Astro provides `Astro.url` which resolves to the
full canonical URL based on the `site` config.

Verify: each generated HTML file has a `<link rel="canonical">` tag.

### Step 4: Add 404 page

Create `src/pages/404.astro`:

```astro
---
import Base from "../layouts/Base.astro";
---
<Base title="Not Found — Sverka">
  <main>
    <h1>404</h1>
    <p>Page not found.</p>
    <p><a href="/">Return home</a></p>
  </main>
</Base>
```

Verify: `bun run build` produces `dist/404.html`.

### Step 5: Add robots.txt

Create `public/robots.txt`:

```
User-agent: *
Allow: /

Sitemap: https://sverka.dev/sitemap-index.xml
```

Verify: `dist/robots.txt` exists after build.

### Step 6: Fix code examples to match actual API

The existing pages reference APIs that **do not exist**. The code examples
show a callback-based `pipeline("name", async ({ run, parallel }) => ...)`
pattern and import `build, lint, test, securityScan` from `@sverka/checks`.
Neither exists. Fix all 3 pages.

**Actual API** (verified from source):

```typescript
// sverka.config.ts — created by `sverka init`
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

**Actual CLI commands** (from `packages/cli/src/main.ts`):
- `sverka init` — create sverka.config.ts
- `sverka inspect` — discover and display project context
- `sverka plan` — synthesize a plan without executing
- `sverka execute` (alias: `sverka run`) — execute the workflow
- `sverka validate` — validate sverka.config.ts
- `sverka baseline create|update|show|clear` — baseline management
- `sverka doctor` — check installation
- NO `compile` command (compilers are library packages, not CLI commands)

**What to fix in each page:**

- **index.astro workflow example**: Replace the callback-based example with
  the actual `defineWorkflow + pipeline + task + run` pattern above.
- **index.astro quick start**: Replace `sverka compile --target github` with
  actual commands: `sverka plan`, `sverka execute`, `sverka validate`.
- **getting-started.astro**: Fix install command (`bun add -g @sverka/cli`
  → verify package name in `packages/cli/package.json`). Fix compile
  section — remove it or replace with `sverka plan` + `sverka execute`.
  Fix workflow example to match actual API.
- **docs.astro**: Fix the example code to match actual API.

**Package name check:**
```bash
grep '"name"' packages/cli/package.json
```

### Step 7: Verify gates

```bash
cd "$(git rev-parse --show-toplevel)/website"
bun run check    # astro check — TypeScript validation
bun run build    # astro build — static generation
```

Verify dist/ contains:
- `index.html`
- `docs/index.html`
- `getting-started/index.html`
- `404.html`
- `sitemap-index.xml`
- `robots.txt`
- `favicon.svg`

Verify each HTML file has: `<title>`, `<meta name="description">`, OG tags,
`<link rel="canonical">`.

Verify no `any` types in .astro frontmatter or config:
```bash
grep -rn ': any' src/ astro.config.mjs
```

## Commit hygiene

Stage ONLY:
- `website/` (all changes within the website directory)
- `specs/14-website/spec.md`
- `engdocs/architecture/wave-14-website-plan.md`

EXCLUDE: `city.toml`, `agents/`, `.devin/`, `.gc`, `.beads/`, `.evidence/`,
`.opencode/`, `formulas/`

Note: `website/bun.lock` and `website/node_modules/` — stage `bun.lock` but
NOT `node_modules/`. Check `.gitignore` covers `node_modules/`.
