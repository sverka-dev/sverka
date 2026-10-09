# Agentic workflows for GitLab

gh-aw (GitHub Agentic Workflows) proved the shape: a markdown-authored
workflow, a sandboxed read-only agent job, and validated writes applied
through a separate apply job. It is structurally locked to GitHub — it
compiles to Actions YAML and rides Actions compute. GitLab has no
equivalent. **Sverka fills that gap**: the same Definition Graph compiles
to `.gitlab-ci.yml` natively, so an agentic workflow is a pipeline like
any other.

| gh-aw primitive            | Sverka equivalent                                               |
| -------------------------- | --------------------------------------------------------------- |
| agent job (engine+prompt)  | `AgentStep`                                                     |
| read-only default          | step `permissions` — writes denied unless declared              |
| safe-outputs apply job     | `permissions.write` → `<step>__apply` job (protected stage)     |
| AWF network firewall       | `runtime.network.allowed`                                       |
| markdown+frontmatter files | `.sverka/*.md` authoring                                        |
| triggers: issues/comments  | `comment()` / `issue()` triggers + the webhook→trigger contract |

The same model compiles to GitHub too — parity is a consequence, not
the pitch.

## Authoring

Two surfaces produce the identical graph.

**Construct API** (`sverka.config.ts`):

```ts
import {
  Project,
  Pipeline,
  AgentStep,
  Entry,
  comment,
  issue,
} from "@sverka/workflow";

const project = new Project("triage-bot");
const pipeline = new Pipeline(project, "agents");

new AgentStep(pipeline, "triage", {
  engine: "anthropic",
  model: "claude-sonnet-4-5",
  prompt: "Triage this MR note and draft a reply: ${event.comment.body}",
  inputs: [{ kind: "context", namespace: "event", field: "comment.body" }],
  permissions: {
    write: [{ kind: "comment", target: "merge_request" }],
  },
});

new Entry(pipeline, "on-mr-note", {
  trigger: comment({ mention: "@sverka", on: "mergeRequest" }),
  roots: ["triage"],
});

export default project;
```

**Markdown** (`.sverka/triage.md`) — gh-aw-style `on:` shorthand; agent
steps themselves delegate to `extends:` since the markdown subset is
shell-steps only:

```markdown
---
pipeline: agents
extends: ./agent.mjs
on:
  comment: { mention: "@sverka", on: mergeRequest }
  issue: { action: opened, labels: [agent] }
---
```

`extends` merges the markdown pipeline into the project exported by the
referenced module — put the `AgentStep` there.

## Triggers

| Builder                     | GitLab lowering                                                                                                                                                                                                 |
| --------------------------- | --------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| `comment({ mention, on })`  | `rules:if` on `$CI_PIPELINE_SOURCE == "trigger" \|\| "web"` + `$SVERKA_EVENT == "comment"`; `on` adds `$SVERKA_COMMENT_ON == "merge_request"\|"issue"\|"commit"`; `mention` adds `$COMMENT_BODY =~ /<mention>/` |
| `issue({ action, labels })` | `$SVERKA_EVENT == "issue"` + `$SVERKA_ISSUE_ACTION == "<action>"` + a `$SVERKA_ISSUE_LABELS =~ /(^,)<label>(,)$`-style regex per label (pipe-escaped)                                                           |
| `schedule(cron)`            | `$CI_PIPELINE_SOURCE == "schedule"` + `$CI_PIPELINE_SCHEDULE_DESCRIPTION == "<entry name>"` — the **schedule description** you set in CI/CD → Schedules is the link                                             |

Comment and issue triggers are marked `emulated` in the capability
manifest: GitLab cannot run a pipeline "on a comment" natively, so
delivery rides the [webhook → pipeline-trigger contract](./webhook-setup.md).
Schedule existence is owned by GitLab — the rules simply never match
without a schedule whose description equals the entry name.

## The agent job

An `AgentStep` lowers to a job that runs `npx sverka@<version> agent`,
configured entirely through environment:

```text
SVERKA_AGENT_ENGINE   # "anthropic" | "openai" | "duo" | "stub"
SVERKA_AGENT_MODEL    # e.g. "claude-sonnet-4-5"
SVERKA_AGENT_PROMPT   # prompt with context refs translated to $VARS
SVERKA_AGENT_ANTHROPIC_KEY / SVERKA_AGENT_OPENAI_KEY / GITLAB_DUO_TOKEN
GITLAB_TOKEN          # read-scoped, agent job only
SVERKA_MENTION        # declared mention — re-checked in-job (defense in depth)
```

The job is read-only and produces `agent-result.json` +
`sverka-writes.json` artifacts. A missing key fails with
`NO_AGENT_DRIVER` naming the expected env var.

## The `__apply` job (safe outputs)

A step declaring `permissions.write` emits exactly one
`<step>__apply` job in a protected `sverka-apply` stage that runs
`sverka apply --provider gitlab`:

- **Input:** `sverka-writes.json` from the agent job, validated against
  the step's `WriteDeclaration[]` (passed as `SVERKA_WRITE_DECLARATIONS`).
  Undeclared or unsupported write kinds fail loudly — the apply job
  never guesses.
- **Token:** the job declares `environment: sverka-apply`.
  `SVERKA_APPLY_TOKEN` is a masked CI/CD variable **scoped to that
  environment**, so the agent job — even on a protected ref — never
  receives a write-capable token. Ref-scoped "protected" variables are
  not enough; environment scoping is what isolates the token per job.
- **Channel:** the artifact is the _only_ path between agent and apply.

## Generate

```sh
sverka synth --target gitlab --output .gitlab-ci.yml
```

The emitted YAML starts with `# sverka:` annotation comments
restating the webhook variables, schedule descriptions, and
`SVERKA_APPLY_TOKEN` scoping — the contract a GitLab operator must wire.
See [webhook-setup.md](./webhook-setup.md) and the
[`examples/gitlab-agentic`](https://github.com/sverka-dev/sverka/tree/main/examples/gitlab-agentic)
example repo.
