# Spec 14 — Website: sverka.dev

## Overview

The `website` package is the public-facing website at sverka.dev. It is a
minimalistic, fast, SEO-optimized site built with Astro. The site has three
page types: a home page (hero, features, quick start), a docs index (links
to documentation), and a getting started guide.

The design philosophy is restraint: clean typography, a monochrome palette,
no heavy graphics, no animations beyond subtle transitions. The site loads
fast on any connection and works without JavaScript for all content pages.

## Goals

1. Build a minimalistic marketing and documentation entry point at
   sverka.dev using Astro.
2. Home page with hero section, feature highlights, and quick start
   snippet.
3. Docs index page linking to user and agentic documentation.
4. Getting started page with step-by-step instructions using `bun` commands.
5. Clean typography system with a monochrome (black/white/grays) palette.
6. SEO optimized: meta tags, Open Graph tags, sitemap, robots.txt.
7. Fast load times: minimal CSS, no client-side JavaScript for content,
   static generation.
8. Responsive layout that works on mobile and desktop.
9. Accessible: semantic HTML, sufficient color contrast, keyboard
   navigable.

## Non-goals

- Building a full documentation site generator. Documentation content lives
  in the `engdocs` and `specs` trees; the website links to rendered
  versions.
- Interactive playground or in-browser Sverka execution.
- User accounts, authentication, or analytics dashboards.
- A blog or news section in v1.
- Heavy graphics, illustrations, or video content.
- Dark/light theme toggle in v1 (single light theme, high contrast).

## Interfaces

This package is primarily content and configuration, not a TypeScript
library. The public interface is the set of Astro pages and components.

### Page structure

```typescript
// src/pages/index.astro          — home page
// src/pages/docs.astro           — docs index
// src/pages/getting-started.astro — getting started guide
```

### Layout component interface

```typescript
/**
 * Base layout for all pages. Sets meta tags, Open Graph, and renders
 * the page shell (header, main, footer).
 */
export interface BaseLayoutProps {
  readonly title: string;
  readonly description: string;
  readonly canonicalUrl?: string;
  readonly ogImage?: string;
}
```

### Component inventory

```typescript
// src/components/Hero.astro        — hero section with title and tagline
// src/components/FeatureGrid.astro  — grid of feature cards
// src/components/QuickStart.astro   — code block with install commands
// src/components/DocLink.astro      — link card to a documentation section
// src/components/Header.astro       — site header with logo and nav
// src/components/Footer.astro       — site footer with links
```

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

### Home page content

```json
{
  "hero": {
    "title": "Sverka",
    "tagline": "Define checks once. Plan locally. Run anywhere.",
    "cta": "Get Started"
  },
  "features": [
    {
      "title": "Composable Workflows",
      "description": "Write verification workflows as TypeScript code."
    },
    {
      "title": "Local-First Runtime",
      "description": "Run full CI locally with Docker or Podman."
    },
    {
      "title": "Multi-Target Compiler",
      "description": "Compile to GitHub Actions, GitLab CI, and more."
    },
    {
      "title": "Normalized Findings",
      "description": "One findings model across all tools."
    }
  ],
  "quickStart": {
    "install": "bun add -g sverka",
    "plan": "sverka plan",
    "execute": "sverka execute"
  }
}
```

### Docs index links

```json
{
  "sections": [
    {
      "title": "User Documentation",
      "links": [
        { "label": "Getting Started", "href": "/getting-started" },
        { "label": "Workflow API Reference", "href": "/docs/workflow-api" },
        { "label": "CLI Reference", "href": "/docs/cli" },
        { "label": "Check Providers", "href": "/docs/checks" },
        { "label": "Compilation Targets", "href": "/docs/compilers" },
        { "label": "Findings and Policy", "href": "/docs/findings-policy" }
      ]
    },
    {
      "title": "Agentic Documentation",
      "links": [
        { "label": "Architecture", "href": "/docs/architecture" },
        { "label": "ADRs", "href": "/docs/adrs" },
        { "label": "Contributor Guide", "href": "/docs/contributing" },
        { "label": "Development Setup", "href": "/docs/dev-setup" }
      ]
    }
  ]
}
```

### Design tokens

```typescript
export const designTokens = {
  color: {
    background: "#ffffff",
    foreground: "#111111",
    muted: "#6b6b6b",
    surface: "#f5f5f5",
    border: "#e0e0e0",
    accent: "#111111",
  },
  font: {
    sans: "Inter, system-ui, sans-serif",
    mono: "JetBrains Mono, monospace",
  },
  spacing: {
    xs: "0.5rem",
    sm: "1rem",
    md: "2rem",
    lg: "4rem",
    xl: "8rem",
  },
  maxWidth: "48rem",
} as const;
```

## Error handling

The website is statically generated. Build-time errors are handled by
Astro's build process:

```typescript
export class WebsiteBuildError extends Error {
  constructor(
    message: string,
    readonly page: string,
    readonly code: WebsiteErrorCode,
  ) {
    super(message);
    this.name = "WebsiteBuildError";
  }
}

export type WebsiteErrorCode =
  | "MISSING_CONTENT"
  | "INVALID_FRONTMATTER"
  | "BROKEN_LINK"
  | "SEO_METADATA_MISSING";
```

- `MISSING_CONTENT`: a referenced content file does not exist. Build fails.
- `INVALID_FRONTMATTER`: a page's frontmatter is missing required fields.
  Build fails.
- `BROKEN_LINK`: an internal link points to a non-existent page. Build fails
  in strict mode, warns otherwise.
- `SEO_METADATA_MISSING`: a page is missing title or description. Build
  fails in strict mode.

Runtime errors are minimal since the site is static. The 404 page is
generated at `src/pages/404.astro`.

## Test plan

- Build test: `bun run build` succeeds and produces static output in
  `dist/`.
- Page tests: each page (`/`, `/docs`, `/getting-started`) renders without
  errors.
- SEO tests: each generated HTML file contains `<title>`, `<meta
  description>`, Open Graph tags, and canonical link.
- Sitemap test: `sitemap-index.xml` is generated and contains all pages.
- Link check: no broken internal links in generated output.
- Performance test: home page HTML is under 20 KB gzipped (excluding
  fonts). No render-blocking JavaScript.
- Accessibility test: pages pass axe-core checks for color contrast,
  heading order, and landmark roles.
- Snapshot tests for each page's HTML output to catch unintended changes.
- Tests run via `bun test`.
- No `any` types in any TypeScript used for configuration or content
  schemas.
