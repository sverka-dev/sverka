# Hosted execution: the bootstrap job

`sverka compile` lowers each step to a provider-native job — one box per
step in the GitHub Actions or GitLab UI, `needs:` edges between them.
The alternative (architecture spec §28) is a **bootstrap job**: one CI
job that installs the CLI and runs the whole pipeline through the Sverka
engine with `sverka run`. No code changes, no extra flags — the engine
executes the same Run Plan it would locally, on the provider's machine.

## GitHub Actions

```yaml
# .github/workflows/ci.yml
name: ci
on:
  push: {}
  pull_request: {}
permissions: {}
jobs:
  sverka:
    runs-on: ubuntu-latest
    permissions:
      contents: read
    steps:
      - name: Checkout
        uses: actions/checkout@<sha> # v4
        with:
          persist-credentials: false
      - name: Setup Bun
        uses: oven-sh/setup-bun@<sha> # v2
      - name: Install dependencies
        run: bun install --frozen-lockfile --ignore-scripts
      - name: Run checks
        run: bunx sverka run # add --entry <pipeline>/<entry> to pick an entry
      - name: Upload report
        if: always()
        uses: actions/upload-artifact@<sha> # v7
        with:
          name: sverka-report
          path: .sverka/runs/
```

`sverka run` writes `.sverka/runs/<runId>/report.json` (the
`sverka.run/v1` payload) and `report.html` — upload the runs directory to
keep them. The step's exit code maps to the job verdict: `0` green, `1`
policy gate failed, `2` usage error, `3` runtime error.

## GitLab CI

```yaml
# .gitlab-ci.yml
sverka:
  image: oven/bun:latest
  script:
    - bun install --frozen-lockfile --ignore-scripts
    - bunx sverka run
  artifacts:
    when: always
    paths:
      - .sverka/runs/
```

## Bootstrap job vs. compiled workflow

|                          | `sverka compile` (per-step jobs)                | Bootstrap job (`sverka run`)                                                   |
| ------------------------ | ----------------------------------------------- | ------------------------------------------------------------------------------ |
| Provider UI              | One job per step, `needs:` graph, per-step logs | One job; step breakdown lives in the Sverka report                             |
| Parallelism              | Provider fleet (jobs on separate machines)      | One machine's cores (`sverka run --jobs`)                                      |
| Step retries             | Provider re-runs the whole job                  | Engine-level retry policy (Spec 20)                                            |
| Artifacts between steps  | `upload-artifact`/`download-artifact`           | In-job artifact store — no network hop                                         |
| Step caching across runs | Wire `actions/cache` yourself                   | Engine cache; shared across machines needs the remote cache (Spec 55, planned) |
| Suspend/resume           | n/a                                             | Not available — `Engine.resume()` is not yet implemented                       |
| Agent steps (Spec 27)    | Lowered/emulated per target capabilities        | Run in-job via configured agent drivers                                        |

Choose the bootstrap job when you want Sverka's engine semantics —
policy gate, findings collection, retry, saga compensations — verbatim
inside CI, and a single job box is enough. Choose per-step compilation
when the provider's job graph and UI granularity matter more.

## Dogfooding

This repository runs exactly this mode: the `self-run` job in
`.github/workflows/sverka.yml` (generated from `sverka.config.ts`) is a
single job that executes `sverka run --entry ci/self-demo` — the engine
schedules and runs the demo pipeline inside one GitHub Actions job and
uploads the HTML report as an artifact.

## What comes next

The bootstrap job is the first stage of the hosted-engine path
(Spec 57, decision record ADR-018):

- **Now** — bootstrap job (this page). Works today.
- **Next** — a self-hosted `sverka worker` polling a run queue on the
  remote hub (Spec 55). The queue contract (`RunQueue`, `QueuedRun`,
  `WorkerCapabilities`) is already pinned as interfaces in
  `@sverka/runtime`; the worker ships only when hub adoption justifies
  it.
- **Later** — managed workers (Sverka-operated compute), gated on the
  Spec 55 adoption threshold (≥ 10 external projects on self-hosted
  hubs), explicit requests, and per-tenant sandbox hardening.

Not planned: compiling pipelines into foreign engine runtimes
(Temporal, Dagger, Inngest, Drone). Those targets were built and removed
— hosted execution means the Sverka engine running remotely, not
translating graphs into someone else's runtime.
