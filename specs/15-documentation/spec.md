# Spec 15 — Documentation: User and Agentic Docs

## Overview

The `documentation` package defines the structure, content, and tooling for
Sverka's documentation. Documentation is split into two audiences:

1. **User docs** — for developers using Sverka to define, plan, and run
   verification workflows. Covers getting started, the workflow API, CLI
   reference, check providers, compilation targets, and findings/policy.
2. **Agentic docs** — for agents and contributors building and maintaining
   Sverka. Covers architecture, ADRs, contributor guide, and development
   setup.

Sverka follows a **document-first** approach: engineering docs in `engdocs/`
are written before code, and specs in `specs/` are written before
implementation. This package defines how those docs are organized, rendered,
and surfaced to both humans and agents.

## Goals

1. Define a clear documentation taxonomy separating user docs from agentic
   docs.
2. User docs: getting started, workflow API reference, CLI reference, check
   providers, compilation targets, findings and policy.
3. Agentic docs: architecture, ADRs, contributor guide, development setup.
4. Document-first approach: docs precede code; specs precede
   implementation; ADRs precede architectural changes.
5. All documentation is versioned alongside code in the repository.
6. Documentation is renderable to HTML for the website and readable as raw
   markdown for agents.
7. Cross-references between specs, ADRs, and user docs are validated.
8. CLI reference is auto-generated from the CLI package's command
   definitions to avoid drift.
9. Workflow API reference is auto-generated from TypeScript type
   definitions.

## Non-goals

- Building a custom documentation site generator. The website package
  handles rendering; this package defines content and structure.
- Hosting documentation externally. All docs live in the repository.
- Supporting multiple human languages in v1.
- Video tutorials or interactive learning content.
- API reference for every internal module. Only public API surfaces are
  documented in user docs.

## Interfaces

```typescript
/**
 * A documentation section in the taxonomy.
 */
export interface DocSection {
  readonly id: string;
  readonly title: string;
  readonly audience: "user" | "agentic";
  readonly description: string;
  readonly pages: readonly DocPage[];
}

export interface DocPage {
  readonly slug: string;
  readonly title: string;
  readonly path: string;
  readonly audience: "user" | "agentic";
  readonly lastUpdated: string;
  readonly source: "markdown" | "generated";
}

/**
 * The full documentation taxonomy.
 */
export interface DocTaxonomy {
  readonly sections: readonly DocSection[];
  /** Look up a page by slug. */
  get(slug: string): DocPage | undefined;
  /** List all pages for an audience. */
  listByAudience(audience: "user" | "agentic"): readonly DocPage[];
}

/** Build the taxonomy from the repository file tree. */
export function buildDocTaxonomy(repoRoot: string): DocTaxonomy;
```

### User documentation structure

```typescript
export const USER_DOC_SECTIONS: readonly DocSection[] = [
  {
    id: "getting-started",
    title: "Getting Started",
    audience: "user",
    description: "Install Sverka and run your first verification plan.",
    pages: [
      {
        slug: "getting-started/install",
        title: "Installation",
        path: "engdocs/user/getting-started/install.md",
        audience: "user",
        lastUpdated: "",
        source: "markdown",
      },
      {
        slug: "getting-started/first-plan",
        title: "Your First Plan",
        path: "engdocs/user/getting-started/first-plan.md",
        audience: "user",
        lastUpdated: "",
        source: "markdown",
      },
    ],
  },
  {
    id: "workflow-api",
    title: "Workflow API Reference",
    audience: "user",
    description: "TypeScript API for composing verification workflows.",
    pages: [
      {
        slug: "workflow-api/overview",
        title: "API Overview",
        path: "engdocs/user/workflow-api/overview.md",
        audience: "user",
        lastUpdated: "",
        source: "markdown",
      },
      {
        slug: "workflow-api/operations",
        title: "Operations",
        path: "engdocs/user/workflow-api/operations.md",
        audience: "user",
        lastUpdated: "",
        source: "generated",
      },
    ],
  },
  {
    id: "cli",
    title: "CLI Reference",
    audience: "user",
    description: "Command-line interface commands and flags.",
    pages: [
      {
        slug: "cli/overview",
        title: "CLI Overview",
        path: "engdocs/user/cli/overview.md",
        audience: "user",
        lastUpdated: "",
        source: "generated",
      },
    ],
  },
  {
    id: "checks",
    title: "Check Providers",
    audience: "user",
    description: "Built-in and plugin check providers.",
    pages: [
      {
        slug: "checks/builtin",
        title: "Built-in Providers",
        path: "engdocs/user/checks/builtin.md",
        audience: "user",
        lastUpdated: "",
        source: "markdown",
      },
      {
        slug: "checks/plugins",
        title: "Plugin Descriptors",
        path: "engdocs/user/checks/plugins.md",
        audience: "user",
        lastUpdated: "",
        source: "markdown",
      },
    ],
  },
  {
    id: "compilers",
    title: "Compilation Targets",
    audience: "user",
    description: "Compiling plans to GitHub Actions and GitLab CI.",
    pages: [
      {
        slug: "compilers/github",
        title: "GitHub Actions",
        path: "engdocs/user/compilers/github.md",
        audience: "user",
        lastUpdated: "",
        source: "markdown",
      },
      {
        slug: "compilers/gitlab",
        title: "GitLab CI",
        path: "engdocs/user/compilers/gitlab.md",
        audience: "user",
        lastUpdated: "",
        source: "markdown",
      },
    ],
  },
  {
    id: "findings-policy",
    title: "Findings and Policy",
    audience: "user",
    description: "Normalized findings, baselines, and policy evaluation.",
    pages: [
      {
        slug: "findings/normalization",
        title: "Findings Normalization",
        path: "engdocs/user/findings/normalization.md",
        audience: "user",
        lastUpdated: "",
        source: "markdown",
      },
      {
        slug: "policy/evaluation",
        title: "Policy Evaluation",
        path: "engdocs/user/policy/evaluation.md",
        audience: "user",
        lastUpdated: "",
        source: "markdown",
      },
    ],
  },
];
```

### Agentic documentation structure

```typescript
export const AGENTIC_DOC_SECTIONS: readonly DocSection[] = [
  {
    id: "architecture",
    title: "Architecture",
    audience: "agentic",
    description: "System architecture and package relationships.",
    pages: [
      {
        slug: "architecture/overview",
        title: "Architecture Overview",
        path: "engdocs/architecture/overview.md",
        audience: "agentic",
        lastUpdated: "",
        source: "markdown",
      },
      {
        slug: "architecture/packages",
        title: "Package Map",
        path: "engdocs/architecture/packages.md",
        audience: "agentic",
        lastUpdated: "",
        source: "markdown",
      },
    ],
  },
  {
    id: "adrs",
    title: "Architecture Decision Records",
    audience: "agentic",
    description: "Decisions that shape the system.",
    pages: [
      {
        slug: "adrs/0001-canonical-plan-ir",
        title: "ADR-0001: Canonical Plan IR",
        path: "engdocs/adr/0001-canonical-plan-ir.md",
        audience: "agentic",
        lastUpdated: "",
        source: "markdown",
      },
    ],
  },
  {
    id: "contributing",
    title: "Contributor Guide",
    audience: "agentic",
    description: "How to contribute to Sverka.",
    pages: [
      {
        slug: "contributing/guide",
        title: "Contributing Guide",
        path: "engdocs/contributing/guide.md",
        audience: "agentic",
        lastUpdated: "",
        source: "markdown",
      },
      {
        slug: "contributing/waves",
        title: "Wave Workflow",
        path: "engdocs/contributing/waves.md",
        audience: "agentic",
        lastUpdated: "",
        source: "markdown",
      },
    ],
  },
  {
    id: "dev-setup",
    title: "Development Setup",
    audience: "agentic",
    description: "Setting up a local development environment.",
    pages: [
      {
        slug: "dev-setup/environment",
        title: "Environment Setup",
        path: "engdocs/contributing/dev-setup.md",
        audience: "agentic",
        lastUpdated: "",
        source: "markdown",
      },
    ],
  },
];
```

### Document-first workflow

```typescript
/**
 * Validates that documentation exists before implementation.
 * Called by the contributor guide and CI checks.
 */
export interface DocFirstValidator {
  /**
   * For a given package and feature, verify that a spec exists in specs/
   * and an ADR exists (if architectural) before code is merged.
   */
  validate(target: ValidationTarget): ValidationResult;
}

export interface ValidationTarget {
  readonly package: string;
  readonly feature: string;
  readonly requiresAdr: boolean;
}

export interface ValidationResult {
  readonly valid: boolean;
  readonly missing: readonly string[];
  readonly messages: readonly string[];
}
```

## Data models

### Repository documentation layout

```
engdocs/
  user/
    getting-started/
      install.md
      first-plan.md
    workflow-api/
      overview.md
      operations.md        # generated from TypeScript types
    cli/
      overview.md          # generated from CLI command definitions
    checks/
      builtin.md
      plugins.md
    compilers/
      github.md
      gitlab.md
    findings/
      normalization.md
    policy/
      evaluation.md
  architecture/
    overview.md
    packages.md
  adr/
    0001-canonical-plan-ir.md
    0002-thin-wrapper-compiler.md
    ...
  contributing/
    guide.md
    waves.md
    dev-setup.md
specs/
  00-overview/spec.md
  ...
  15-documentation/spec.md
```

### ADR format

```markdown
# ADR-NNNN: Title

## Status
Proposed | Accepted | Deprecated | Superseded by ADR-XXXX

## Context
(Why this decision is needed)

## Decision
(What was decided)

## Consequences
(Positive and negative impacts)

## Alternatives Considered
(What else was on the table)
```

### Generated documentation sources

| Doc page                  | Source package         | Generator                |
|--------------------------|------------------------|--------------------------|
| CLI reference             | `packages/cli`         | Extracted from command defs |
| Workflow API operations   | `packages/core`        | Extracted from TypeScript types |
| Check provider list       | `packages/checks`      | Extracted from provider metadata |

Generated docs are produced by a build script (`bun run docs:generate`)
and committed to the repository so they are readable by agents without
running a generator.

## Error handling

```typescript
export class DocumentationError extends Error {
  constructor(
    message: string,
    readonly code: DocumentationErrorCode,
    readonly path?: string,
  ) {
    super(message);
    this.name = "DocumentationError";
  }
}

export type DocumentationErrorCode =
  | "MISSING_SPEC"
  | "MISSING_ADR"
  | "BROKEN_CROSS_REFERENCE"
  | "GENERATED_DOC_STALE"
  | "INVALID_ADR_FORMAT"
  | "MISSING_DOC_PAGE";
```

- `MISSING_SPEC`: a package feature has code but no corresponding spec.
  Fails the doc-first validator.
- `MISSING_ADR`: an architectural change has no ADR. Fails the validator
  when `requiresAdr` is true.
- `BROKEN_CROSS_REFERENCE`: a doc links to another doc or spec that does not
  exist. Fails the link checker.
- `GENERATED_DOC_STALE`: a generated doc does not match its source. Fails
  the docs generation check.
- `INVALID_ADR_FORMAT`: an ADR is missing required sections. Fails the ADR
  linter.
- `MISSING_DOC_PAGE`: the taxonomy references a page that does not exist on
  disk. Fails the taxonomy builder.

## Test plan

- Unit tests for `buildDocTaxonomy()` using a fixture repository tree.
- Unit tests for `DocTaxonomy.get()` and `DocTaxonomy.listByAudience()`.
- Unit tests for `DocFirstValidator` verifying it detects missing specs and
  ADRs.
- Unit tests for ADR format validation: valid ADR passes, missing sections
  fail.
- Link checker test: all cross-references in docs resolve to existing files.
- Generated doc freshness test: running `bun run docs:generate` produces
  output identical to committed generated docs.
- Snapshot tests for the taxonomy structure.
- Tests run via `bun test`.
- No `any` types; all test fixtures use typed objects.
