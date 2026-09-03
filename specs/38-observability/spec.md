# Spec 38 — Cost/Token Observability

**Status:** Active
**Source:** specs/architecture-spec.md §22 (Native Engine), §30 (CLI), RunEvent (Spec 21)
**Package:** `@sverka/runtime` (report sub-module); `@sverka/cli` (audit command)
**Capability:** N/A (observability, not a target/engine)
**Related:** ADR-017, Spec 21 (RunEvent), Spec 27 (AgentStep)

## Overview

Structured run reports: the engine collects per-step timings, cache
hits/misses, and agent token usage into a `RunReport` object, written
to `.sverka/runs/<runId>/report.json`. A new `sverka audit` CLI command
reads the report and prints a human-readable summary with cost
estimates for AI agent steps. No OTel dependency — the report JSON is
the seam for future exporters.

## Goals

- `RunReport` type: run metadata + per-step entries + aggregate stats.
- Engine collects report during `run()`: listens to RunEvents, builds
  report, writes to `report.json` after `run-completed`.
- `sverka audit [runId]` CLI command: reads report.json, prints summary.
- Agent cost estimation: tokens × model rate → estimated USD.
- JSON output mode (`--format json`) for programmatic consumption.
- No new external dependencies (no OTel, no dollar library).

## Non-goals

- OTel exporter — follow-up bead (`@sverka/plugin-otel`).
- Real-time streaming cost dashboard — follow-up.
- Persistent cost database / historical trends — follow-up.
- Cost estimation for non-agent steps (shell steps have no token cost).
- Model rate auto-fetch from provider APIs — hardcoded rate table.
- Multi-currency — USD only.

## Interfaces

```ts
interface RunReport {
  readonly runId: string;
  readonly planId: string;
  readonly status: RunStatus;
  readonly startedAt: number;
  readonly completedAt: number;
  readonly durationMs: number;
  readonly steps: readonly StepReport[];
  readonly summary: RunSummary;
}

interface StepReport {
  readonly stepId: string;
  readonly status: "succeeded" | "failed" | "skipped" | "cancelled" | "cache-hit";
  readonly durationMs: number;
  readonly cacheHit?: boolean;
  readonly cacheKey?: string;
  readonly retries?: number;
  readonly agent?: AgentReport;
}

interface AgentReport {
  readonly engine: string;
  readonly model?: string;
  readonly inputTokens?: number;
  readonly outputTokens?: number;
  readonly totalTokens?: number;
  readonly estimatedCostUsd?: number;
}

interface RunSummary {
  readonly totalSteps: number;
  readonly succeeded: number;
  readonly failed: number;
  readonly skipped: number;
  readonly cacheHits: number;
  readonly cacheMisses: number;
  readonly totalDurationMs: number;
  readonly totalTokens?: number;
  readonly estimatedCostUsd?: number;
}
```

Exported from `@sverka/runtime`. CLI: `sverka audit [runId] [--format json|human]`.

## Data models

### Report collection

The engine's `run()` method already emits RunEvents. A report collector
subscribes to the event stream and builds the report:

| Event | Report action |
|---|---|
| `run-started` | Record `startedAt`, `runId`, `planId` |
| `step-started` | Record step start time |
| `step-succeeded` | Record duration, status=succeeded |
| `step-failed` | Record duration, status=failed, error |
| `step-skipped` | Record status=skipped |
| `step-cancelled` | Record status=cancelled |
| `step-cache-hit` | Record cacheHit=true, cacheKey, status=cache-hit |
| `step-retry` | Increment retries counter |
| `run-completed` | Record `completedAt`, status, write report.json |

Agent reports are populated from `AgentResult.usage` (already in the
agent driver interface, Spec 27).

### Cost estimation

Hardcoded rate table (per 1M tokens):

| Model | Input $/1M | Output $/1M |
|---|---|---|
| claude-sonnet-4-5 | 3.00 | 15.00 |
| claude-opus-4 | 15.00 | 75.00 |
| gpt-4o | 2.50 | 10.00 |
| gpt-4-turbo | 10.00 | 30.00 |
| gemini-2-pro | 1.25 | 5.00 |
| default | 5.00 | 15.00 |

`estimatedCostUsd = (inputTokens/1M * inputRate) + (outputTokens/1M * outputRate)`.

### `sverka audit` output (human format)

```
Run: abc-123 (plan: plan-def)
Status: success | Duration: 45.2s | Cost: $0.0234

Steps:
  build      succeeded   12.3s   cache: miss
  test       succeeded    8.1s   cache: hit (key: abc123)
  lint       succeeded    2.4s
  review     succeeded   22.4s   agent: claude-sonnet-4-5
                                  tokens: 12450 in / 3200 out
                                  cost: $0.0234

Summary:
  4 steps (3 succeeded, 0 failed, 1 cache hit)
  Total tokens: 15650 | Estimated cost: $0.0234
```

## Error handling

No new error class. Report collection is best-effort — failures emit a
`diagnostic` event (warn severity) but do not fail the run. `sverka
audit` returns exit code 2 if no report found for the given runId.

## Test plan

1. Single-step run → report with 1 step entry, correct duration.
2. Multi-step run → report with all steps in execution order.
3. Cache hit → step report has `cacheHit: true`, `cacheKey` set.
4. Cache miss → step report has `cacheHit: false`.
5. Retry → step report has `retries: 2`.
6. Failed step → status=failed in report.
7. Skipped step → status=skipped in report.
8. Agent step → agent report with tokens + model + estimated cost.
9. Cost estimation: known tokens + model → correct USD value.
10. Unknown model → default rate applied.
11. Run summary: correct aggregate counts.
12. Report written to `.sverka/runs/<runId>/report.json`.
13. `sverka audit <runId>` reads report + prints human format.
14. `sverka audit <runId> --format json` prints JSON.
15. `sverka audit` (no runId) → reads most recent report.
16. `sverka audit <bad-id>` → exit code 2, error message.
17. Public API: `RunReport` + types exported from `@sverka/runtime`.
