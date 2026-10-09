# examples/gitlab-agentic

Minimal "gh-aw for GitLab" example: a read-only agent job triggered by
merge-request notes and issue events, with comments applied through a
separate protected `__apply` job — plus a scheduled shell job.

```text
.sverka/
  agentic.md     # discovery entry point (extends ./agent.mjs)
  agent.mjs      # the agentic pipeline (AgentStep + triggers + permissions.write)
.gitlab-ci.yml   # generated: `sverka synth --target gitlab`
scripts/
  digest.sh      # weekly-digest job command
```

> The agentic features (`comment`/`issue` triggers, `AgentStep`,
> `sverka agent` / `sverka apply`) require the sverka release containing
> Spec 54 (0.2.19+). `package.json` pins the intended minimum.

## One-time GitLab setup

1. **Pipeline trigger token** — Settings → CI/CD → _Pipeline trigger
   tokens_ → create `sverka-agentic`.
2. **Webhook** — Settings → Webhooks → note/issue events → a forwarder
   that calls `POST /projects/:id/trigger/pipeline` with the contract
   variables (`SVERKA_EVENT`, `COMMENT_BODY`, `SVERKA_COMMENT_ON`,
   `MR_IID`, `ISSUE_IID`, `SVERKA_ISSUE_ACTION`, `SVERKA_ISSUE_LABELS`).
   Full contract:
   [engdocs/user/gitlab/webhook-setup.md](../../engdocs/user/gitlab/webhook-setup.md).
3. **Schedule** — CI/CD → Schedules → cron `0 9 * * 1`, description
   `on-weekly-digest` (must equal the entry name — see the
   `# sverka:schedule:` annotation at the top of `.gitlab-ci.yml`).
4. **Variables** — Settings → CI/CD → Variables:
   - `SVERKA_AGENT_ANTHROPIC_KEY` — masked, scoped to the `sverka-agent`
     environment that agent jobs declare (see the `# sverka:agent:`
     annotation), so unrelated jobs never receive the key.
   - `SVERKA_APPLY_TOKEN` — masked, **environment scope `sverka-apply`**.
     Environment scoping (not just "protected") is what keeps the
     write-capable token out of the read-only agent job.

## Regenerate the pipeline

```sh
sverka synth --target gitlab --output .gitlab-ci.yml
```

The agent jobs run `npx sverka@<version> agent`; the `__apply` jobs run
`npx sverka@<version> apply --provider gitlab`, validating
`sverka-writes.json` against the step's declared `permissions.write`
before posting — undeclared writes fail loudly.
