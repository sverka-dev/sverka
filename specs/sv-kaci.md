<!-- cspell:ignore kaci -->

# sv-kaci — migrate @agentclientprotocol/sdk to 2.x

## Problem

`@agentclientprotocol/sdk` 2.x removed per-turn usage reporting from the
stable v1 surface:

- `PromptResponse` is now `{ stopReason, _meta? }` — no `usage` field.
- The `Usage` type (`inputTokens` / `outputTokens` / `thoughtTokens` /
  `totalTokens`) is gone from the stable entrypoint.
- Token reporting moved to `session_update` notifications of kind
  `usage_update`: `{ used, size, cost?: { amount, currency } }` —
  **context-window occupancy + cumulative session cost**, not a per-turn
  token breakdown.

Arena and benchmark are pinned to `^1.9.0` for this reason; everything
else in the app API we use (`client()`, `methods`, `ndJsonStream`,
`buildSession`/`withSession`, `ActiveSessionMessage`, permission
requests) is unchanged in 2.x.

## Design

### New token source

`runAcpSession` collects `usage_update` notifications during the collect
loop (last update wins — it is a point-in-time context measure). The
return type changes:

```ts
interface AcpSessionResult {
  response: PromptResponse;
  /** Last `usage_update` seen during the turn; undefined if the agent
   *  never reported one. */
  usage: UsageUpdate | undefined;
}
```

`runAcpSession(...): Promise<AcpSessionResult>`; both in-repo callers
(`adapters/devin.ts`, `benchmark/src/arena.ts`) are updated.

### RunMetrics mapping

`RunMetrics` keeps its existing fields and gains the context-window
numbers losslessly:

```ts
contextTokensUsed?: number;  // usage_update.used
contextWindowSize?: number;  // usage_update.size
costAmount?: number;         // usage_update.cost.amount
costCurrency?: string;       // ISO 4217
```

Token-field population:

- **Devin adapter** — the session-DB transcript already carries true
  per-call token accounting (`final_metrics.total_prompt_tokens` /
  `total_completion_tokens`); it now feeds `inputTokens` /
  `outputTokens` (strictly better than the removed per-turn `usage`).
  `thoughtTokens` is 0 (the transcript does not separate thinking
  tokens). `totalTokens` = prompt + completion when a transcript exists,
  else `usage_update.used`, else 0.
- **Benchmark** (no transcript) — `inputTokens`/`outputTokens`/
  `thoughtTokens` are 0; `totalTokens` falls back to
  `usage_update.used` — context occupancy at turn end is the only
  token number ACP 2.x provides (documented approximation).

`extractUsageTokens(usage)` keeps its name; parameter type changes
`Usage` → `UsageUpdate`, returning the token/context fields spread into
`RunMetrics` (conditional spreads — `exactOptionalPropertyTypes` is on).

### arena.result/v1

`taskResultSchema.metrics` gains optional `contextUsed`, `contextSize`,
`costAmount`, `costCurrency`; `toTaskResult` maps them from
`RunMetrics`. The schema literal stays `arena.result/v1`: additive
optional fields are backward compatible in both directions (old readers
strip unknown keys; old documents still validate). `tokens` keeps
publishing `RunMetrics.totalTokens`.

## Plan

- [ ] bump `@agentclientprotocol/sdk` to `^2.0.1` in
      `packages/arena` + `packages/benchmark`, `bun install`
- [ ] `acp.ts`: collect `usage_update`, return `AcpSessionResult`
- [ ] `types.ts`: extend `RunMetrics` (context/cost fields)
- [ ] `devin.ts`: `extractUsageTokens` → `UsageUpdate`; `buildMetrics`
      takes usage + transcript metrics
- [ ] `benchmark/src/arena.ts` + `types.ts`: same mapping
- [ ] `registry.ts` + `publish.ts`: extend v1 metrics schema
- [ ] update tests; run arena + benchmark test/typecheck/lint/build
