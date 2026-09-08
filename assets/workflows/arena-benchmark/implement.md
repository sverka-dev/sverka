# Arena Implementation — Builder Instructions

You are implementing **@sverka/arena** — an abstract agent benchmark framework.

## Context

- **Plan**: `.agents/plans/arena-framework.md`
- **Spec**: `specs/42-arena/spec.md` (created by architect)
- **Epic**: `sv-kzig` in beads
- **Branch**: `feat/arena-{{phase_name}}`

## What to build

The arena package at `packages/arena/` with:

### Core types (`src/types.ts`)

- `AgentAdapter` — pluggable agent interface (devin, claude, codex)
- `ModelConfig` — model id, name, env var
- `PluginConfig` — plugin/skill id, path, enabled flag, install path
- `Task` — id, prompt, timeout, success criteria
- `ArenaConfig` — tasks, agent, models, plugins, workspace, repetitions, outputDir
- `RunResult` — taskId, modelId, pluginIds, metrics, trace, success
- `RunMetrics` — tokens, toolCallCount, llmCallCount, executionTimeMs
- `TraceData` — sessionId, model, steps, finalMetrics
- `TraceStep` — stepId, timestamp, source, message, toolCalls, observations, isLlmCall

### Devin adapter (`src/adapters/devin.ts`)

- Spawns `devin acp --model <model>` as subprocess
- Installs plugins (skills) into workspace `.agents/skills/<id>/`
- Runs ACP session, collects events
- Returns `RunResult` with full trace

### Matrix runner (`src/runner.ts`)

- Executes full matrix: task × model × plugin combo × repetitions
- Plugin combinations derived from `plugins[]` (on/off for each)
- Sequential execution (one agent at a time)
- Writes results to outputDir

### Trace collector (`src/collector.ts`)

- Collects ACP session events during run
- After run, reads Devin transcript from `~/.local/share/devin/cli/transcripts/<session-id>.json`
- Transforms to `TraceData` format
- Counts LLM calls (each agent step = 1 LLM inference)

### CLI (`bin.ts`)

- `arena run --config arena.config.ts` — runs benchmark from config file
- `arena run --task <id> --model <id> --plugin <id>` — run specific cell

## Rules

- **TDD**: Write failing tests first, implement until passing
- **No `any`**: Use `unknown` and narrow
- **Public API**: Export from `src/index.ts`
- **ESM**: Use `.js` extensions in imports
- **Strict TypeScript**: All types explicit
- **Bun**: Use Bun as runtime and test runner
- **Minimal diff**: Don't rewrite existing benchmark package — create new arena package

## Quality gates

```bash
bun run test          # all tests pass
bun run typecheck     # no type errors
bun run lint          # no lint errors
bun run build         # builds successfully
```

## Report

When done, report to mayor via mail:
- Test counts (passing/total)
- Gate status (test/typecheck/lint/build)
- Files created/modified
- Any issues or blockers
