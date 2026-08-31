# v1 Wave 2 Plan — AgentStep

**Spec:** 27-agent-step
**Bead:** sv-wthn.2.2
**Packages:** `@sverka/workflow` (model: `AgentOperation`, `AgentStep`), `@sverka/sdk` (`agent` tagged template), `@sverka/runtime` (engine: `AgentDriver`, stub driver)
**Date:** 2026-08-31
**Base branch:** `v1-w2-mcp-ai` (stacks on Wave 1)

## Scope

Add `AgentStep` (AI agent as step type). New `OperationDefinition` kind
`"agent"`. SDK `agent` tagged template. Engine `AgentDriver` interface +
stub driver. Agent steps are non-cacheable; result saved as artifact.

## Package dependency

```text
@sverka/sdk  →  @sverka/workflow  (AgentStep, AgentStepProps, AgentToolRef)
@sverka/runtime (engine-native)  →  @sverka/workflow  (AgentOperation in OperationDefinition)
```

No new external deps. The stub driver needs no AI SDK. Real driver packages
(`@sverka/agent-openai` etc.) are follow-ups.

## Files

| File | Action |
|---|---|
| `packages/workflow/src/cdk/model.ts` | **Edit** — add `AgentToolRef`, `AgentOperation` interfaces. |
| `packages/workflow/src/cdk/constructs.ts` | **Edit** — add `AgentStepProps`, `AgentStep` class (extends `Step`). |
| `packages/workflow/src/cdk/index.ts` | **Edit** — export `AgentToolRef`, `AgentOperation`, `AgentStepProps`, `AgentStep`. |
| `packages/workflow/src/core/graph.ts` | **Edit** — add `AgentOperation` to `OperationDefinition` union; re-export types. |
| `packages/workflow/src/core/synthesize.ts` | **Edit** — `AgentStep` → `StepDefinition` with `agent` operation. |
| `packages/sdk/src/agent.ts` | **New** — `agent` tagged template + `AgentStepBuilder`. |
| `packages/sdk/src/index.ts` | **Edit** — export `agent`, `AgentStepBuilder`. |
| `packages/runtime/src/engine-native/types.ts` | **Edit** — add `AgentDriver`, `AgentExecuteRequest`, `AgentResult`, `AgentUsage` interfaces; add `agentDrivers?` to `EngineConfig`. |
| `packages/runtime/src/engine-native/agent-driver.ts` | **New** — `createStubAgentDriver`. |
| `packages/runtime/src/engine-native/step-executor.ts` | **Edit** — handle `op.kind === "agent"`: select driver, execute, save artifact, skip cache. |
| `packages/runtime/src/engine-native/errors.ts` | **Edit** — add `AgentDriverError` (`AGENT_EXECUTION_FAILED`). |
| `packages/runtime/src/engine-native/index.ts` | **Edit** — export `AgentDriver`, `AgentExecuteRequest`, `AgentResult`, `AgentUsage`, `createStubAgentDriver`, `AgentDriverError`. |
| `packages/compiler/src/github/capabilities.ts` | **Edit** — add `agent.step: emulated`. |
| `packages/compiler/src/gitlab/capabilities.ts` | **Edit** — add `agent.step: emulated`. |
| `packages/workflow/src/cdk/__tests__/agent-step.test.ts` | **New** — model/synthesize tests (items 1–4, 11). |
| `packages/sdk/src/__tests__/agent.test.ts` | **New** — SDK builder tests (items 2–4, 12). |
| `packages/runtime/src/engine-native/__tests__/agent.test.ts` | **New** — engine execution tests (items 5–10, 13). |

## TDD steps

1. Add `AgentToolRef` + `AgentOperation` to cdk/model.ts + export. Add
   `AgentOperation` to `OperationDefinition` union in graph.ts. Write model
   test item 11 (export assertion).
2. Add `AgentStepProps` + `AgentStep` class to constructs.ts. Wire
   `synthesize` to produce `agent` operation. Write item 1 (synthesize
   produces agent operation).
3. Write `agent.ts` SDK tagged template + `AgentStepBuilder`. Write items
   2–4 (builder: default engine, tools, engine/model). Export from sdk
   index (item 12).
4. Add `AgentDriver` / `AgentExecuteRequest` / `AgentResult` / `AgentUsage`
   to engine-native types.ts + `agentDrivers?` to `EngineConfig`.
5. Write `agent-driver.ts` — `createStubAgentDriver`. Write engine test
   item 5 (stub driver: lifecycle events, result saved as artifact).
6. Extend `step-executor.ts`: handle `op.kind === "agent"`. Write item 6
   (no driver → step-failed, NO_AGENT_DRIVER).
7. Write item 7 (agent step with cache → cache skipped).
8. Write item 8 (driver throws → AgentDriverError, step fails). Add
   `AgentDriverError` to errors.ts.
9. Write item 9 (unknown tool → warn diagnostic, agent runs).
10. Write item 10 (artifact saved at correct path with text/finishReason/
    usage).
11. Export new types from engine-native index (item 13).
12. Add `agent.step: emulated` to github/gitlab capability manifests
    (item 14).
13. Run gates: `bun run test`, `bun run typecheck`, `bun run lint`,
    `bun run build`. All green.

## Commit hygiene

Stage ONLY `packages/workflow/src/**` (model, constructs, graph, synthesize,
tests) + `packages/sdk/src/agent.ts` + `packages/sdk/src/index.ts` +
`packages/sdk/src/__tests__/agent.test.ts` + `packages/runtime/src/engine-native/**`
(types, agent-driver, step-executor, errors, index, tests) +
`packages/compiler/src/{github,gitlab}/capabilities.ts` +
`specs/27-agent-step/spec.md` + this plan + `bun.lock` (if deps change —
none expected). EXCLUDE city.toml, agents/, .devin/, .gc/, .beads/,
formulas/, engdocs/adr/.
