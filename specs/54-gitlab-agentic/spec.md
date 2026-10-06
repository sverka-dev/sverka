# Spec 54 — GitLab Agentic Workflows

**Status:** Proposed
**Source:** direction program sv-44n5 (strategy review, 2026-10)
**Package:** `@sverka/workflow` (trigger model), `@sverka/compiler` (gitlab lowering), `@sverka/runtime` (agent driver conventions), `engdocs/user/` (positioning)
**Bead:** sv-44n5.2
**Depends on:** sv-wthn.2.2 (AgentStep — shipped), sv-wthn.2.4 (safe-outputs — shipped), sv-wthn.2.5 (network-allowlist — shipped)
**Related:** architecture spec §13 (triggers/entries), Spec 25 (safe-outputs), Spec 26 (network-allowlist), Spec 27 (AgentStep), Spec 28 (mcp-server), Spec 37 (markdown authoring), Spec 09 (gitlab target)

## Overview

gh-aw (GitHub Agentic Workflows) proved the product shape: markdown
+ frontmatter workflows, an agent job that is read-only and
sandboxed by default, and validated writes applied through a
separate safe-output job. It is **structurally locked to GitHub**
— it compiles to GitHub Actions YAML and rides Actions compute.
GitLab has no equivalent. That is the wedge.

Every primitive gh-aw needs already exists in Sverka:

| gh-aw primitive            | Sverka equivalent                        |
| -------------------------- | ---------------------------------------- |
| agent job (engine+prompt)  | `AgentStep` (Spec 27)                    |
| read-only default          | step permissions, write denied by default (Spec 25) |
| safe-outputs apply job     | `permissions.write` lowering — **this spec defines the GitLab apply pattern** |
| AWF network firewall       | `runtime.network.allowed` (Spec 26)      |
| markdown+frontmatter files | `.sverka.md` authoring (Spec 37)         |
| triggers: issues/comments  | `Trigger` union — **gains `comment` + `issue` kinds here** |

This spec adds the GitLab-side composition: event triggers gh-aw
users expect, the GitLab safe-apply pattern, agent-driver config
conventions, and the docs positioning "agentic workflows for
GitLab".

The same model also compiles to GitHub (gh-aw parity is a
consequence, not the pitch).

## Goals

- `Trigger` union gains two repository-event kinds:

  ```ts
  export interface Comment {
    readonly kind: "comment";
    /** e.g. "@sverka" — only fire when a note contains the mention. */
    readonly mention?: string;
    readonly on?: "mergeRequest" | "issue" | "commit";
  }
  export interface Issue {
    readonly kind: "issue";
    readonly action?: "opened" | "reopened" | "labeled";
    readonly labels?: readonly string[];
  }
  ```

- GitLab lowering:
  - `comment`/`issue`/`schedule`/`push`/`changeRequest` entries →
    `rules:` conditions on `CI_PIPELINE_SOURCE` +
    `CI_PIPELINE_TRIGGER_*` / `CI_MERGE_REQUEST_*` variables.
  - `schedule` entries → documented mapping to GitLab pipeline
    schedules (CI/CD → Schedules; emitted YAML carries a
    `sverka:schedule` comment block the docs reference).
  - `comment` triggers lower to `rules:if: '$CI_PIPELINE_SOURCE ==
    "trigger" || $CI_PIPELINE_SOURCE == "web"'` plus a
    `sverka:webhook` contract (see "Comment/event delivery").
- **GitLab safe-apply pattern**: a step declaring
  `permissions.write` lowers to a separate `apply` job in a
  protected stage that receives a scoped token variable
  (`SVERKA_APPLY_TOKEN`, protected+masked CI/CD variable) and
  re-executes only the declared write operations from a validated
  artifact produced by the agent job. The agent job itself remains
  read-only (`GITLAB_TOKEN`/`CI_JOB_TOKEN` with read scope only).
- Agent driver conventions: `AgentStep.engine` resolved against
  env vars — `SVERKA_AGENT_ANTHROPIC_KEY`, `SVERKA_AGENT_OPENAI_KEY`,
  `GITLAB_DUO_TOKEN` (optional, Duo where available). The compiled
  workflow maps secrets to masked variables; local runs read the
  same env vars.
- `sverka synth --target gitlab` on a `.sverka.md` agentic
  workflow produces a `.gitlab-ci.yml` a GitLab user can commit
  and run without sverka installed on the runner (bootstrap job
  installs sverka — same emulated pattern as Spec 27).
- Docs: `engdocs/user/gitlab/agentic.md` + a minimal example repo
  layout (`.sverka/*.md` + `.gitlab-ci.yml` + schedules setup).

## Non-goals

- A hosted webhook receiver. Comment/issue events reach GitLab
  pipelines through the platform's own mechanisms (pipeline
  triggers API, schedules, webhooks→trigger-token) — documented
  wiring, not a sverka-operated service.
- GitHub-side agentic *marketing* — the same YAML compiles there;
  positioning effort goes to the GitLab gap.
- GitLab Duo API integration beyond passing a token to a driver
  that declares `canExecute("duo")`. Driver packages are
  follow-ups (Spec 27 non-goal remains).
- Free-form webhook ingestion (arbitrary event payloads) —
  follow-up; v1 covers the enumerated event kinds.
- Re-implementing gh-aw's curated tool list verbatim — tools come
  from MCP providers (Spec 23), not a hardcoded allowlist.

## Comment/event delivery

GitLab cannot run a pipeline "on a comment" natively; the standard
wiring is:

```text
GitLab webhook (note events)
  → project CI/CD trigger token
  → POST /projects/:id/trigger/pipeline  (variables: SVERKA_EVENT=comment,
      COMMENT_BODY=..., MR_IID=..., ISSUE_IID=...)
  → pipeline with rules matching $SVERKA_EVENT
```

Sverka defines the **contract** (variable names + rules mapping)
and ships `engdocs/user/gitlab/webhook-setup.md`. A future
`sverka gitlab-hooks` helper MAY automate the webhook creation via
the GitLab API; the YAML contract stands alone.

## Interfaces

### Model (`@sverka/workflow`)

```ts
export type Trigger = Push | ChangeRequest | Manual | Schedule | Comment | Issue;

export function comment(opts?: {
  mention?: string;
  on?: "mergeRequest" | "issue" | "commit";
}): Comment;

export function issue(opts?: {
  action?: "opened" | "reopened" | "labeled";
  labels?: readonly string[];
}): Issue;
```

### GitLab lowering (`@sverka/compiler`)

- `comment` → job-level `rules:if` on `SVERKA_EVENT` +
  `CI_PIPELINE_SOURCE` in (`trigger`,`web`), plus a
  `sverka:mention:` annotation comment consumed by the agent's
  prompt template (`{{ event.comment.body }}` context ref —
  `event` namespace already exists, architecture spec §12 /
  feature F-35).
- `issue` → same `SVERKA_EVENT` mechanism with
  `SVERKA_EVENT=issue`.
- `schedule` → `rules:if: '$CI_PIPELINE_SOURCE == "schedule" &&
   $CI_SCHEDULE_NAME == "<entry>"'` (schedule name is created
  manually per docs; rules must not silently assume it exists).
- `permissions.write` step → emits an additional job
  `<step>__apply` in stage `sverka-apply` (after the agent stage):
  - input: `sverka-writes.json` artifact emitted by the agent job
    (validated against the step's `WriteDeclaration[]`);
  - environment: `SVERKA_APPLY_TOKEN` masked+protected;
  - the agent job artifact is the *only* channel — the agent job
    gets no token at all.

### Agent job env conventions

```text
SVERKA_AGENT_DRIVER   # e.g. "anthropic" | "openai" | "duo" | "stub"
SVERKA_AGENT_MODEL    # e.g. "claude-sonnet-4-5"
SVERKA_AGENT_ANTHROPIC_KEY / SVERKA_AGENT_OPENAI_KEY / GITLAB_DUO_TOKEN
GITLAB_TOKEN          # read-scoped, present in agent job only
SVERKA_APPLY_TOKEN    # write-scoped, present in __apply job only
```

## Error handling

- `comment`/`issue` entry compiled for a target with no event
  delivery contract → capability diagnostic `emulated`, not a
  silent drop (architecture spec §24 capability model).
- `permissions.write` on a step with no `WriteDeclaration` →
  `SynthesisError` (already covered by Spec 25 validation).
- `__apply` job with missing/invalid `sverka-writes.json` → fails
  the job loudly; it never guesses writes.
- Missing agent key env var at runtime → `NO_AGENT_DRIVER`
  (Spec 27 semantics) naming the expected env var.
- `schedule` entry without matching GitLab schedule name → the
  rules simply never match; docs must state this is by design
  (GitLab owns schedule existence).

## Test plan

1. `comment({ mention: "@sverka", on: "mergeRequest" })` entry
   lowers to GitLab `rules:` containing `SVERKA_EVENT == "comment"`.
2. `issue({ action: "opened" })` lowers to `SVERKA_EVENT == "issue"`
   rule.
3. `schedule("0 9 * * 1")` entry lowers to `CI_PIPELINE_SOURCE ==
   "schedule"` + `CI_SCHEDULE_NAME` guard, with the entry name.
4. Step with `permissions.write` emits exactly one `<step>__apply`
   job in stage `sverka-apply`; agent job env contains no
   `SVERKA_APPLY_TOKEN`.
5. `sverka-writes.json` validation: artifact declaring a write
   kind not in `WriteDeclaration[]` → apply job fails (fixture
   test on the apply runner).
6. `agent.step` + `comment` capability matrix updated: GitLab
   `emulated` (via sverka execute), documented.
7. `.sverka.md` file with `on: comment` frontmatter synthesizes
   the same graph as the equivalent Construct API (Spec 37 parity).
8. Docs example repo: `sverka synth --target gitlab` output is
   a valid `.gitlab-ci.yml` (yaml parse + `gitlab-ci-local` dry
   run or lint API).
9. `comment()`/`issue()` builders + `Comment`/`Issue` types
   exported from `@sverka/workflow`.
10. Missing `SVERKA_AGENT_*_KEY` → step fails with
    `NO_AGENT_DRIVER` naming the env var.

## Positioning note (why this is the wedge)

gh-aw's moat is GitHub distribution, not the concept. GitLab's
~30% of the CI market has schedules, webhooks, trigger tokens,
protected variables — everything the pattern needs — and no
agentic-workflow product. Sverka's provider-neutral graph means
the same `.sverka.md` file runs locally, on GitHub, and on
GitLab; gh-aw cannot say that by construction.
