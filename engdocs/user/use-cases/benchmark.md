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
`DEVIN_PERMISSION_MODE` auto-approves tools in both cells; the sverka
cell additionally gets `@sverka/cli` in `node_modules` and the `sverka`
skill under `.agents/skills/`.

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
  outputDir: ".benchmark",
});

await writeReport(result, ".benchmark/result.json");
```

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
import {
  readTranscript,
  transformTranscript,
  writeTraceData,
} from "@sverka/benchmark";

const transcript = await readTranscript(transcriptDir(runId));
const trace = transformTranscript(transcript); // TraceData steps + metrics
await writeTraceData(trace, `traces/${runId}.json`);
```

`transformStep`, `countLlmCalls`, and `buildTraceData` are the pieces if
you need per-step control.

## The dashboard

`sverka.dev/benchmark` is a fully static page (Spec 42 dashboard,
`website/public/benchmark/index.html`) that loads a `BenchmarkResult`
JSON and renders the left/right comparison — one row per task, raw-shell
on the left, sverka on the right, with a delta column (green when sverka
uses fewer tokens/tools/time). It reads the committed
`sample-result.json` by default and accepts `?data=<url>` for any other
result file — point it at the JSON `sverka-benchmark` just wrote.

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
