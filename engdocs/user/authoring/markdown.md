# Markdown authoring

> **Work in progress.** Markdown authoring is specified (Spec 37) but not
> yet implemented. This page describes the planned interface.

A fourth authoring surface: `.sverka.md` files with YAML frontmatter
(triggers, pipeline metadata) + Markdown step lists. `sverka` auto-
discovers `.sverka.md` files and compiles them to Definition Graphs via
the existing Construct API.

## When to use Markdown

- **Simple pipelines** — lint, test, build, deploy without TypeScript
  ceremony.
- **Documentation-adjacent configs** — pipelines that read like a README.
- **Quick prototypes** — get started without setting up a full project.

For complex features (matrix, conditions, expressions, agent steps, saga,
safe-outputs), use the `extends` escape hatch to mix Markdown with full
TypeScript.

## File format

```markdown
---
pipeline: ci
triggers:
  - kind: push
extends: ./sverka.config.ts
inputs:
  nodeVersion:
    type: string
    default: "24"
---

## lint

- command: npm run lint

## build

- command: npm run build
- depends_on: lint
- outputs:
    dist:
      type: artifact
      path: ./dist

## deploy

- command: kubectl apply -f deploy.yaml
- depends_on: build
- image: google/cloud-sdk:512.0.0
- timeout: 300000
```

## Frontmatter fields

| Field | Type | Description |
|-------|------|-------------|
| `pipeline` | `string` | Pipeline ID (required) |
| `triggers` | `Array<{ kind: string; branches?: string[]; schedule?: string }>` | Trigger objects with `kind`: `push`, `changeRequest`, `manual`, `schedule` plus optional `branches`, `schedule`, etc. |
| `extends` | `string` | Path to a `.ts` config file (escape hatch) |
| `inputs` | `Record<string, InputSpec>` | Pipeline inputs with type and default |

## Step syntax

Each `## step-id` heading defines a step. Supported fields:

| Field | Description |
|-------|-------------|
| `command` | Shell command (required) |
| `depends_on` | Step ID or list of IDs |
| `image` | Container image for this step |
| `timeout` | Timeout in milliseconds |
| `outputs` | Output declarations (artifact or scalar) |

## CLI auto-discovery

`sverka validate` finds `.sverka.md` files when no `sverka.config.ts`
exists. One pipeline per file.

## `extends` escape hatch

```yaml
extends: ./sverka.config.ts
```

The Markdown pipeline merges into the TypeScript Project. Use this when
you need features not available in Markdown (matrix, conditions, agent
steps, saga, safe-outputs, network allowlist).
