# Spec 14 — Website: sverka.dev

## Overview

The `website/` directory is the public-facing website at sverka.dev. It is a
minimalistic, fast, SEO-optimized static site built with Astro. Three pages:
home (hero, features, quick start), docs index (links to documentation), and
getting started guide.

Design philosophy: restraint. Monochrome dark palette, system fonts, no heavy
graphics, no client-side JavaScript. Static generation. Fast on any connection.

This is a standalone Astro project — NOT part of the bun workspace or nx
monorepo. It has its own `package.json` and `bun.lock`. Gates are `astro check`
and `astro build`, not vitest/tsc/eslint.

## Goals

1. Minimalistic marketing and documentation entry point at sverka.dev.
2. Home page: hero, feature highlights, quick start snippet.
3. Docs index: links to GitHub-hosted documentation (engdocs, specs, ADRs).
4. Getting started page: step-by-step `bun` commands.
5. Monochrome dark palette, system fonts, high contrast.
6. SEO: meta tags, Open Graph tags, canonical URLs, sitemap, robots.txt.
7. Static generation, no client-side JavaScript.
8. Responsive layout (mobile + desktop).
9. Accessible: semantic HTML, sufficient color contrast.

## Non-goals

- Full documentation site generator. Docs live in `engdocs/` and `specs/`;
  the website links to GitHub.
- Interactive playground or in-browser Sverka execution.
- User accounts, authentication, analytics.
- Blog, news section, heavy graphics, video.
- Theme toggle (single dark theme).
- Component extraction. Content is inline in 3 pages + 1 layout. No
  `src/components/` directory — each component would have exactly one
  consumer, which is premature abstraction for a 3-page site.
- TypeScript library exports. This is content and configuration, not a
  package. No `src/index.ts`, no custom error classes, no design token
  exports. CSS custom properties in `global.css` are the design tokens.
- Web fonts (Inter, JetBrains Mono). System fonts are faster and simpler.
- axe-core, snapshot tests, performance budgets. Gold-plating for v1.

## Interfaces

### Page structure

```
src/pages/index.astro           — home page
src/pages/docs.astro            — docs index
src/pages/getting-started.astro — getting started guide
src/pages/404.astro             — not found page
src/layouts/Base.astro          — base layout (meta tags, shell)
src/styles/global.css           — design tokens (CSS custom properties)
public/robots.txt               — robots
public/favicon.svg              — favicon
astro.config.mjs                — Astro config with sitemap integration
```

### Base layout

The `Base.astro` layout uses Astro's native frontmatter `Props` pattern:

```astro
---
interface Props {
  title?: string;
  description?: string;
}
---
```

No custom interface export. Astro handles this natively.

### Astro configuration

```typescript
// astro.config.mjs
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

## Data models

No JSON data models. Content is inline in `.astro` files. The docs index
links to GitHub URLs for engineering documentation (engdocs/, specs/, ADRs/)
and uses text descriptions (not broken links) for guides that don't have
dedicated pages yet.

## Error handling

No custom error classes. Astro's build process handles build-time errors
natively. The 404 page at `src/pages/404.astro` handles not-found routes.

## Test plan

1. `astro check` passes (TypeScript validation for .astro files).
2. `astro build` succeeds and produces static output in `dist/`.
3. `dist/` contains: `index.html`, `docs/index.html`,
   `getting-started/index.html`, `404.html`, `sitemap-index.xml`,
   `robots.txt`, `favicon.svg`.
4. Each generated HTML file contains `<title>`, `<meta name="description">`,
   Open Graph tags, and `<link rel="canonical">`.
5. `sitemap-index.xml` contains all page URLs.
6. No broken internal links in generated output.
7. No `any` types in any TypeScript used in `.astro` frontmatter or config.
