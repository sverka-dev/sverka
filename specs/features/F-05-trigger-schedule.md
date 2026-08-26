# Feature: Schedule trigger

**ID:** F-05
**Category:** triggers
**Milestone:** M1
**Status:** Proposed
**Parent epic:** sv-4wh9

## Summary

The schedule trigger starts a pipeline on a time-based cron schedule. GitHub Actions supports this natively in YAML via `on: schedule`. GitLab requires API/UI configuration — there is no YAML keyword for scheduled pipelines. This divergence means Sverka needs a connector for GitLab or must document the limitation.

## Provider matrix

| Aspect | GitHub Actions | GitLab CI | Sverka (proposed) |
|--------|---------------|-----------|-------------------|
| Construct | `on: schedule` | (none in YAML) | `trigger.schedule` |
| Semantics | Runs on cron schedule from YAML | Configured via API/UI, not YAML | Pipeline starts on cron schedule |
| Value type | array of `{ cron, timezone }` | n/a | `{ cron, timezone? }` |
| Limitations | POSIX cron, min 5 min interval | no YAML keyword — API only | GitLab requires connector or manual setup |
| Provider gap | — | no YAML-native scheduling | connector needed for GitLab |

## GitHub Actions

```yaml
on:
  schedule:
    - cron: "0 2 * * *"
      timezone: "America/New_York"
    - cron: "0 0 * * 0"
```

Uses POSIX cron syntax. `timezone` is optional (IANA timezone string). Minimum interval is 5 minutes. Scheduled workflows run on the default branch.

## GitLab CI

GitLab scheduled pipelines are configured via the UI or API (`POST /projects/:id/pipeline_schedules`), not in `.gitlab-ci.yml`. The pipeline itself uses `rules:if: $CI_PIPELINE_SOURCE == "schedule"` to detect scheduled runs.

```yaml
build:
  rules:
    - if: $CI_PIPELINE_SOURCE == "schedule"
  script:
    - echo "scheduled run"
```

## Sverka proposal

### Portable model

`Entry` node with `trigger: { kind: "schedule", cron: string, timezone?: string }`. Multiple schedules are multiple Entry nodes.

### Authoring API

```ts
// SDK
triggers: [trigger.schedule({ cron: "0 2 * * *", timezone: "America/New_York" })],

// Construct
new Entry(pipeline, { trigger: { kind: "schedule", cron: "0 2 * * *" } });
```

### Lowering

- **GitHub target:** `trigger.schedule` → `on: schedule:` with `cron` and `timezone`.
- **GitLab target:** `trigger.schedule` → `rules: if: $CI_PIPELINE_SOURCE == "schedule"` (detects scheduled runs). The actual schedule must be created via the GitLab API or project settings — emit a diagnostic at `warning` level: "Schedule trigger requires GitLab API configuration. Create scheduled pipelines in Project Settings → CI/CD → Schedules or via the GitLab API."
- **Native engine:** not applicable (no scheduler). Could use `node-cron` or similar for local scheduled runs.

### Capability manifest

```ts
"trigger.schedule": "native",       // GitHub
"trigger.schedule": "partial",      // GitLab (detection only, no YAML creation)
```

### Portability & divergence

This is the starkest provider divergence in the trigger space. GitHub is YAML-native; GitLab requires out-of-band API configuration. Sverka's approach:
1. Lower to GitHub `on: schedule` natively.
2. On GitLab, lower to `rules:if` for detection + emit a warning diagnostic instructing the user to create schedules via GitLab project settings or API.
3. Document the limitation clearly.

## Non-goals

- GitLab API-based schedule creation in the compiler (that's a connector concern).
- Complex scheduling patterns (windows, exclusions, holidays).

## Dependencies

- **Depends on:** none.
- **Blocks:** none.

## Open questions

- Should Sverka provide a `sverka sync` command that creates GitLab schedules via API?
- Should the native engine support cron scheduling for local testing?
- Should `timezone` be validated against the IANA timezone database?

## References

- GitHub: https://docs.github.com/en/actions/using-workflows/workflow-syntax-for-github-actions#onschedule
- GitLab: https://docs.gitlab.com/ee/ci/pipelines/schedules.html
- Architecture spec: §25, §32 (deferred)
