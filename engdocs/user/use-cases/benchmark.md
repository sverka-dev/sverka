# Benchmark harness

`@sverka/benchmark` (Spec 41) is the two-agent comparison harness: it runs
the same task twice — once with a **raw-shell** agent and once with a
**sverka** agent (CLI + skill in the workspace) — over `devin acp`,
collects tokens / tool calls / wall time / stop reason, and emits JSON.
It answers one question: does delegating to `sverka` cost the agent less
than driving checks by hand?

For the full benchmark framework — plugin matrices, task packs,
registries, leaderboards — see [Arena](./arena.md) (`@sverka/arena`,
Spec 42). The benchmark harness is the original A/B measurement; arena is
the generalization.

## Running it

```bash
# via the package binary — writes benchmark-<timestamp>.json
sverka-benchmark [outputDir]

# model comes from the environment
DEVIN_MODEL=<model> sverka-benchmark ./results
```

The harness spawns `devin acp --model <model>` per task × agent, talks
JSON-RPC over stdio (`@agentclientprotocol/sdk`), and tallies
`tool_call` session updates plus the `PromptResponse.usage` block.
`DEVIN_PERMISSION_MODE` auto-approves tools in both cells. Both agents
run in the real Sverka checkout — no temp copy — so the only difference
is that the sverka cell gets the `sverka` skill ensured at
`.agents/skills/sverka/SKILL.md`.

## Programmatic use

```ts
import {
  runBenchmark,
  writeReport,
  BENCHMARK_TASKS,
  DEFAULT_AGENTS,
} from "@sverka/benchmark";

const result = await runBenchmark({
  tasks: [...BENCHMARK_TASKS],
  agents: [...DEFAULT_AGENTS],
  model: "swe-2-high",
});

// writeReport takes a file path — the parent directory must exist.
await writeReport(result, "benchmark-result.json");
```

`BenchmarkConfig` also accepts `outputDir`, but the current
implementation does not read it — trace/report locations are chosen by
the caller (`writeReport`, `writeTraceData`).

`BENCHMARK_TASKS` ships 5 scenarios ordered simple → complex —
`run-checks`, `discover`, `create-config`, `compile-github`,
`multi-step` — each a prompt plus a timeout. `DEFAULT_AGENTS` is the
`raw-shell`/`sverka` pair; pass your own `Task[]`/`AgentConfig[]` to
measure something else.

## Result shape

```ts
interface BenchmarkResult {
  timestamp: string;
  model: string;
  results: RunResult[]; // one per task × agent
  summary: {
    "raw-shell": AggregateMetrics;
    sverka: AggregateMetrics;
  };
}
```

`RunMetrics` carries `inputTokens` / `outputTokens` / `thoughtTokens` /
`totalTokens` / `toolCallCount` / `executionTimeMs` / `stopReason`; a run
counts as `success` when `stopReason === "end_turn"`.
`extractMetrics(promptResult, toolCallCount, startTime)` and
`aggregateMetrics(results, agentType)` are exported for custom reporting.

## Transcripts → traces

The `collector` module turns raw ACP transcripts into the trace format
the website renders:

```ts
import { buildTraceData, writeTraceData } from "@sverka/benchmark";

// buildTraceData reads both agents' transcripts by session ID from
// ~/.local/share/devin/cli/transcripts (transcriptDir() — pass `dir`
// to override) and returns the combined TraceData.
const trace = buildTraceData(
  taskId,
  prompt,
  rawShellSessionId,
  sverkaSessionId,
);

// Writes <outputDir>/<taskId>/trace.json — outputDir is a directory.
await writeTraceData(trace, "traces");
```

`readTranscript`, `transformTranscript` (per-agent `TraceAgentData`),
`transformStep`, `countLlmCalls`, and `transcriptDir` are the pieces if
you need per-step control.

## The dashboard

`sverka.dev/benchmark` is a fully static page (Spec 42 dashboard,
`website/public/benchmark/index.html`) that loads a `BenchmarkResult`
JSON and renders the left/right comparison — one row per task, raw-shell
on the left, sverka on the right, with a delta column (green when sverka
uses fewer tokens/tools/time). It loads `arena-results.json` by
default; `?data=arena-sample.json` selects the committed sample — those
two files are the only values the parameter accepts (anything else
falls back to the default), so it renders committed results, not an
arbitrary local file.

The same directory also serves the arena artifacts (`board.html`,
`arena-results.json`, `traces/`) produced by `sverka-arena board` — see
[Arena](./arena.md#the-registry).

## API summary

| Export                                                                                       | Kind                              |
| -------------------------------------------------------------------------------------------- | --------------------------------- |
| `runBenchmark`, `writeReport`                                                                | Run + persist a `BenchmarkResult` |
| `extractMetrics`, `aggregateMetrics`                                                         | Metrics helpers                   |
| `BENCHMARK_TASKS`, `DEFAULT_AGENTS`                                                          | Built-in scenarios + agent pair   |
| `readTranscript`, `transformTranscript`, `buildTraceData`, `writeTraceData`, `transcriptDir` | ACP transcript → trace pipeline   |
| `transformStep`, `countLlmCalls`                                                             | Per-step trace helpers            |

Types: `Task`, `AgentConfig`, `RunMetrics`, `RunResult`,
`AggregateMetrics`, `BenchmarkResult`, `BenchmarkConfig`, `Transcript`,
`TranscriptStep`, `TranscriptMetrics`, `TraceData`, `TraceStep`,
`TraceAgentData`.

## See also

- [Arena](./arena.md) — the generalized framework (Spec 42)
- [First plan](../getting-started/first-plan.md) — what the sverka agent
  runs inside the benchmark
