# GitLab webhook → pipeline trigger setup

GitLab cannot start a pipeline "on a comment" natively. `comment` and
`issue` triggers therefore ride a documented contract: a GitLab webhook
calls the pipeline-trigger endpoint, which starts a pipeline whose
`rules:` match on the variables the call supplies. Sverka defines the
variable names and the rules mapping; the wiring is yours.

```text
GitLab webhook (note events / issue events)
  → project CI/CD trigger token
  → POST /projects/:id/trigger/pipeline
      variables:
        SVERKA_EVENT=comment|issue
        COMMENT_BODY=...
        SVERKA_COMMENT_ON=merge_request|issue|commit
        MR_IID=...  ISSUE_IID=...
        SVERKA_ISSUE_ACTION=opened|reopened|labeled
        SVERKA_ISSUE_LABELS=<comma-joined label titles>
  → pipeline where each event entry's rules match $SVERKA_EVENT
    plus the declared filters
```

## Contract variables

| Variable              | Set when                 | Consumed by                                                                                 |
| --------------------- | ------------------------ | ------------------------------------------------------------------------------------------- |
| `SVERKA_EVENT`        | always                   | `comment`/`issue` rules (`== "comment"` / `== "issue"`)                                     |
| `COMMENT_BODY`        | comment events           | `$COMMENT_BODY =~ /<mention>/` rule + `event.comment.body` context ref in prompts           |
| `SVERKA_COMMENT_ON`   | comment events           | `comment({ on })` rule — `mergeRequest`→`merge_request`, `issue`→`issue`, `commit`→`commit` |
| `SVERKA_ISSUE_ACTION` | issue events             | `issue({ action })` rule                                                                    |
| `SVERKA_ISSUE_LABELS` | issue events             | `issue({ labels })` — comma-joined titles matched per label regex                           |
| `MR_IID`              | comment on MR            | `sverka apply` posts to `/merge_requests/:iid/notes`; `event.mr.iid` ref                    |
| `ISSUE_IID`           | issue / comment on issue | `sverka apply` posts to `/issues/:iid/notes`; `event.issue.iid` ref                         |
| `ISSUE_TITLE`         | issue events             | `event.issue.title` context ref in prompts                                                  |
| `COMMENT_AUTHOR`      | comment events           | `event.comment.author` context ref in prompts                                               |

The rules only fire when `CI_PIPELINE_SOURCE` is `trigger` or `web`, so
ordinary pushes never collide with event-driven pipelines. `SVERKA_EVENT`
is the discriminator — set it on every trigger call, even when you only
wire one event kind.

## Wiring it up

1. **Create a trigger token.** Project → Settings → CI/CD →
   _Pipeline trigger tokens_ → add a token (e.g. description
   `sverka-agentic`). Keep the token — the webhook uses it as `token=`.

2. **Create the webhook.** Project → Settings → Webhooks:
   - URL: the **forwarder's** endpoint — not the GitLab trigger URL
     directly. GitLab webhooks cannot POST the `variables[...]` map
     natively, so the webhook must hit a small forwarder (a Cloud
     Function, a tiny GitLab webhook integration, or the repository's
     own automation) that reads the note/issue payload and calls
     `POST /api/v4/projects/<id>/trigger/pipeline` with `ref=main`,
     `token=<trigger-token>`, and the `variables[...]` form fields
     documented above.
   - Enable **Comments** (note events) and/or **Issues** events as the
     workflow needs.
   - Keep the trigger token in the forwarder, not in the webhook URL —
     a URL in the webhook config is visible to anyone with project
     settings access. A future `sverka gitlab-hooks` helper may
     automate this; the YAML contract stands alone.

3. **Comment filtering.** Forward `SVERKA_COMMENT_ON` as the webhook's
   note object type (`MergeRequest`→`merge_request`, `Issue`→`issue`,
   `Commit`→`commit`) and `COMMENT_BODY` as the note text. Mention
   filtering is then enforced twice: the emitted `rules:` regex, and
   `sverka agent` re-checking `SVERKA_MENTION` inside the job.

## Schedules

`schedule(cron)` entries guard on
`CI_PIPELINE_SCHEDULE_DESCRIPTION == "<entry name>"`. In
CI/CD → Schedules, create a schedule whose **description exactly equals
the entry name** (the `# sverka:schedule:` annotation in the emitted
YAML restates it). `CI_SCHEDULE_NAME` does not exist as a predefined
variable — the description is the link. Without a matching schedule the
rules simply never match; that is by design — GitLab owns schedule
existence.

## The apply token

Jobs suffixed `__apply` run in the `sverka-apply` stage and declare
`environment: sverka-apply`. Create a masked CI/CD variable
`SVERKA_APPLY_TOKEN` (a project/group access token with `api` write
scope, or a PAT) **scoped to the `sverka-apply` environment**
(Settings → CI/CD → Variables → _environment scope_). Environment
scoping — not just "protected" flags — is what guarantees the
read-only agent job never sees a write-capable token, even on a
protected ref.

`SVERKA_AGENT_ANTHROPIC_KEY` / `SVERKA_AGENT_OPENAI_KEY` /
`GITLAB_DUO_TOKEN` are ordinary masked variables — the agent job needs
exactly the one matching `SVERKA_AGENT_ENGINE`, and a missing key fails
with `NO_AGENT_DRIVER` naming the env var.
