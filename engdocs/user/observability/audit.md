# Run reports and audit

> **Work in progress.** Run reports and `sverka audit` are specified
> (Spec 38) but not yet implemented. This page describes the planned
> interface.

Structured run reports: the engine collects per-step timings, cache
hits/misses, and agent token usage into a `RunReport` object, written to
`.sverka/runs/<runId>/report.json`. The `sverka audit` CLI command reads
the report and prints a human-readable summary with cost estimates for AI
agent steps.

No OTel dependency — the report JSON is the seam for future exporters.

## `sverka audit`

```bash
# Audit the most recent run
sverka audit

# Audit a specific run
sverka audit run-abc123

# JSON output for programmatic consumption
sverka audit --format json
```

## Report contents

```
Run: run-abc123
Plan: rp-ci-pipeline
Status: success
Duration: 45.2s

Steps:
  ci/lint      1.2s   cache: hit
  ci/test      8.4s   cache: miss
  ci/build    12.1s   cache: hit
  ai/review   18.3s   tokens: 12,400 in / 3,200 out
                       model: gpt-4o
                       estimated cost: $0.19

Aggregate:
  Total duration: 45.2s
  Cache hit rate: 66%
  AI token usage: 15,600 tokens
  Estimated AI cost: $0.19
```

## RunReport model

```ts
interface RunReport {
  runId: string;
  planId: string;
  status: RunStatus;
  startedAt: number;
  completedAt: number;
  steps: Array<{
    stepId: string;
    durationMs: number;
    cacheHit: boolean;
    agentUsage?: {
      model: string;
      tokensIn: number;
      tokensOut: number;
      estimatedCostUsd: number;
    };
  }>;
  aggregate: {
    totalDurationMs: number;
    cacheHitRate: number;
    totalTokensIn: number;
    totalTokensOut: number;
    totalEstimatedCostUsd: number;
  };
}
```

## Limitations (v1)

- **No OTel exporter** — follow-up bead (`@sverka/plugin-otel`).
- **No real-time streaming** — report is written after `run-completed`.
- **No persistent cost database** — historical trends are a follow-up.
- **Hardcoded model rate table** — no auto-fetch from provider APIs.
- **USD only** — no multi-currency.
