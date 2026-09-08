import { describe, it, expect } from "vitest";
import type {
  AgentAdapter,
  AgentSpawnConfig,
  AgentProcess,
  ModelConfig,
  PluginConfig,
  Task,
  ArenaConfig,
  RunResult,
  RunMetrics,
  TraceData,
  TraceStep,
  ToolCall,
  Observation,
  AggregateMetrics,
  ArenaResult,
} from "../src/index.js";

// Compile-time type checks — these assignments must type-check.
const _agentAdapter: AgentAdapter = {
  id: "devin",
  spawn: (_config: AgentSpawnConfig): AgentProcess => ({
    run: async (_prompt: string, _timeoutMs: number): Promise<RunResult> => {
      throw new Error("not implemented");
    },
    kill: () => {},
  }),
};

const _modelConfig: ModelConfig = {
  id: "glm-5-2",
  name: "GLM-5.2 High",
  envVar: "DEVIN_MODEL",
};

const _pluginConfig: PluginConfig = {
  id: "sverka",
  name: "Sverka",
  path: ".agents/skills/sverka",
  enabled: true,
  installPath: ".agents/skills/sverka/",
};

const _task: Task = {
  id: "fix-bug",
  name: "Fix a bug",
  prompt: "Fix the failing test",
  timeoutMs: 60_000,
  successCriteria: "all tests pass",
};

const _toolCall: ToolCall = {
  functionName: "shell",
  arguments: { command: "ls" },
  toolCallId: "call-1",
};

const _observation: Observation = {
  sourceCallId: "call-1",
  content: "file1.txt\nfile2.txt",
};

const _traceStep: TraceStep = {
  stepId: 0,
  timestamp: "2025-01-01T00:00:00Z",
  source: "agent",
  message: "Running ls",
  toolCalls: [_toolCall],
  observations: [_observation],
  isLlmCall: false,
};

const _traceData: TraceData = {
  sessionId: "session-1",
  model: "glm-5-2",
  steps: [_traceStep],
  finalMetrics: {
    totalPromptTokens: 100,
    totalCompletionTokens: 50,
    totalCachedTokens: 10,
    totalSteps: 1,
  },
};

const _runMetrics: RunMetrics = {
  inputTokens: 100,
  outputTokens: 50,
  thoughtTokens: 10,
  totalTokens: 160,
  toolCallCount: 1,
  llmCallCount: 1,
  executionTimeMs: 5000,
  stopReason: "end_turn",
};

const _runResult: RunResult = {
  taskId: "fix-bug",
  modelId: "glm-5-2",
  pluginIds: ["sverka"],
  metrics: _runMetrics,
  trace: _traceData,
  success: true,
};

const _aggregateMetrics: AggregateMetrics = {
  totalRuns: 1,
  successCount: 1,
  avgInputTokens: 100,
  avgOutputTokens: 50,
  avgTotalTokens: 160,
  avgToolCalls: 1,
  avgLlmCalls: 1,
  avgExecutionTimeMs: 5000,
};

const _arenaResult: ArenaResult = {
  timestamp: "2025-01-01T00:00:00Z",
  config: {
    models: ["glm-5-2"],
    plugins: ["sverka"],
    tasks: ["fix-bug"],
    repetitions: 1,
  },
  results: [_runResult],
  aggregates: [_aggregateMetrics],
};

describe("ArenaConfig", () => {
  it("can be constructed with all fields", () => {
    const config: ArenaConfig = {
      tasks: [_task],
      agent: _agentAdapter,
      models: [_modelConfig],
      plugins: [_pluginConfig],
      workspace: "/tmp/workspace",
      repetitions: 3,
      outputDir: "/tmp/output",
    };
    expect(config.tasks).toHaveLength(1);
    expect(config.agent.id).toBe("devin");
    expect(config.models[0]?.id).toBe("glm-5-2");
    expect(config.plugins[0]?.id).toBe("sverka");
    expect(config.workspace).toBe("/tmp/workspace");
    expect(config.repetitions).toBe(3);
    expect(config.outputDir).toBe("/tmp/output");
  });

  it("works with optional fields omitted", () => {
    const config: ArenaConfig = {
      tasks: [_task],
      agent: _agentAdapter,
      models: [_modelConfig],
      plugins: [_pluginConfig],
      outputDir: "/tmp/output",
    };
    expect(config.workspace).toBeUndefined();
    expect(config.repetitions).toBeUndefined();
  });
});

describe("RunResult", () => {
  it("has all required fields", () => {
    const result: RunResult = _runResult;
    expect(result.taskId).toBe("fix-bug");
    expect(result.modelId).toBe("glm-5-2");
    expect(result.pluginIds).toEqual(["sverka"]);
    expect(result.success).toBe(true);
    expect(result.error).toBeUndefined();
    expect(result.metrics).toBeDefined();
    expect(result.trace).toBeDefined();
  });

  it("includes error field when set", () => {
    const result: RunResult = {
      ..._runResult,
      success: false,
      error: "timeout",
    };
    expect(result.success).toBe(false);
    expect(result.error).toBe("timeout");
  });
});

describe("RunMetrics", () => {
  it("has all metric fields", () => {
    const metrics: RunMetrics = _runMetrics;
    expect(metrics.inputTokens).toBe(100);
    expect(metrics.outputTokens).toBe(50);
    expect(metrics.thoughtTokens).toBe(10);
    expect(metrics.totalTokens).toBe(160);
    expect(metrics.toolCallCount).toBe(1);
    expect(metrics.llmCallCount).toBe(1);
    expect(metrics.executionTimeMs).toBe(5000);
    expect(metrics.stopReason).toBe("end_turn");
  });
});

describe("TraceData", () => {
  it("has correct structure", () => {
    const trace: TraceData = _traceData;
    expect(trace.sessionId).toBe("session-1");
    expect(trace.model).toBe("glm-5-2");
    expect(trace.steps).toHaveLength(1);
    expect(trace.finalMetrics.totalPromptTokens).toBe(100);
    expect(trace.finalMetrics.totalCompletionTokens).toBe(50);
    expect(trace.finalMetrics.totalCachedTokens).toBe(10);
    expect(trace.finalMetrics.totalSteps).toBe(1);
  });

  it("trace step has correct source union", () => {
    const step: TraceStep = _traceStep;
    expect(["system", "agent", "user"]).toContain(step.source);
    expect(step.isLlmCall).toBe(false);
    expect(step.toolCalls).toHaveLength(1);
    expect(step.observations).toHaveLength(1);
  });
});

describe("ArenaResult", () => {
  it("has all fields", () => {
    const result: ArenaResult = _arenaResult;
    expect(result.timestamp).toBe("2025-01-01T00:00:00Z");
    expect(result.config.models).toEqual(["glm-5-2"]);
    expect(result.config.plugins).toEqual(["sverka"]);
    expect(result.config.tasks).toEqual(["fix-bug"]);
    expect(result.config.repetitions).toBe(1);
    expect(result.results).toHaveLength(1);
    expect(result.aggregates).toHaveLength(1);
  });
});
