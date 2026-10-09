# Markdown authoring

A fourth authoring surface: `.sverka.md` files with YAML frontmatter
(triggers, pipeline metadata) + Markdown step lists. `sverka` auto-
discovers `.sverka/*.md` files when no `sverka.config.ts` exists and
compiles them to Definition Graphs via the existing Construct API — the
produced graph is identical, not approximate.

## When to use Markdown

- **Simple pipelines** — lint, test, build, deploy without TypeScript
  ceremony.
- **Documentation-adjacent configs** — pipelines that read like a README.
- **gh-aw-style agentic workflows** — frontmatter `on:` triggers match
  the GitHub Agentic Workflows authoring shape; the agent step itself
  delegates to `extends` (see below).
- **Quick prototypes** — get started without setting up a full project.

For complex features (matrix, conditions, expressions, agent steps, saga,
safe-outputs, network allowlist), use the `extends` escape hatch to mix
Markdown with full TypeScript.

## File format

```markdown
---
pipeline: ci
on:
  push: {}
  comment: { mention: "@sverka", on: mergeRequest }
inputs:
  nodeVersion:
    type: string
    default: "24"
---

## lint

- command: npm run lint

## build

- command: npm run build
- dependsOn: [lint]
- outputs:
  dist:
  type: artifact
  path: ./dist

## deploy

- command: kubectl apply -f deploy.yaml
- dependsOn: [build]
- image: google/cloud-sdk:512.0.0
- timeout: 300000
```

Every `## step` heading defines a shell step. Entry roots cover all
declared steps — each trigger fires the whole pipeline (gh-aw
semantics; dependency reachability still prunes unneeded producers).

## Frontmatter fields

| Field      | Type                                       | Description                                                            |
| ---------- | ------------------------------------------ | ---------------------------------------------------------------------- |
| `pipeline` | `string`                                   | Pipeline ID (required)                                                 |
| `triggers` | `Array<{ kind: string; ... }>`             | Trigger objects — takes precedence over `on:` when both are present    |
| `on`       | `string \| string[] \| Record<kind, opts>` | gh-aw-style shorthand for `triggers`                                   |
| `extends`  | `string`                                   | Path to a config module (escape hatch — resolves relative to the file) |
| `inputs`   | `Record<string, Input>`                    | Pipeline inputs with type and default                                  |

### Trigger kinds

| `kind`          | Options                                                         |
| --------------- | --------------------------------------------------------------- |
| `push`          | `branches`, `tags`, `paths` filters                             |
| `changeRequest` | `branches`, `tags`, `paths` filters                             |
| `manual`        | `branches`, `tags`, `paths` filters                             |
| `schedule`      | `cron` (required), `timezone`                                   |
| `comment`       | `mention` (e.g. `"@sverka"`), `on: mergeRequest\|issue\|commit` |
| `issue`         | `action: opened\|reopened\|labeled`, `labels: string[]`         |

`on:` accepts a bare kind (`on: push`), a list (`on: [push, manual]`),
or a kind→options map as shown above. `comment` and `issue` map to the
`comment()`/`issue()` trigger builders — on GitLab they ride the
[webhook → pipeline-trigger contract](../gitlab/webhook-setup.md).

> **Trust boundary:** a `comment` trigger lets anyone who can post a
> note feed text into the agent prompt. On GitHub, `issue_comment`
> pipelines run in the base-repository context — on private repos,
> restrict who can comment (or gate further on
> `github.event.comment.author_association`) before exposing an agent
> job to untrusted comment authors. The generated agent job carries no
> `GITHUB_TOKEN` and checks out with `persist-credentials: false`, so no
> token reaches the untrusted prompt — writes flow only through the
> validated `__apply` channel.

## Step syntax

Each `## step-id` heading defines a step. Supported fields:

| Field       | Description                               |
| ----------- | ----------------------------------------- |
| `command`   | Shell command (required)                  |
| `dependsOn` | List of step IDs (`depends_on` also read) |
| `image`     | Container image for this step             |
| `timeout`   | Timeout in milliseconds                   |
| `outputs`   | Output declarations (artifact or scalar)  |

Indented blocks under a bullet are parsed as YAML (used by `outputs`).
Non-bullet prose inside a step section is ignored — document freely.

## CLI auto-discovery

When a root has no `sverka.config.{ts,mts,js,mjs}`, the CLI falls back
to the first `.sverka/*.md` file (sorted). `sverka validate`, `plan`,
`run`, and `synth`/`compile` all consume it like a TS config. One
markdown pipeline per file; multiple files are a follow-up.

## `extends` escape hatch

```yaml
extends: ./agent.mjs
```

`extends` imports a module exporting a `Project` (or a `Pipeline`, whose
implicit `Project` is used) and adds the markdown pipeline alongside the
module's own pipelines. Use it when you need features Markdown doesn't
cover — agent steps, safe-outputs, matrices, conditions, sagas, network
allowlist. See
[`examples/gitlab-agentic`](https://github.com/sverka-dev/sverka/tree/main/examples/gitlab-agentic)
for an agentic workflow authored this way.
