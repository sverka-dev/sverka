import { describe, it, expect } from "vitest";
import { mkdtempSync, writeFileSync, rmSync, readFileSync } from "node:fs";
import { join } from "node:path";
import { tmpdir } from "node:os";
import {
  readTranscript,
  transformStep,
  countLlmCalls,
  transformTranscript,
  buildTraceData,
  writeTraceData,
} from "../src/collector.js";
import type { Transcript, TranscriptStep } from "../src/collector.js";

/** Create a temp transcript file for testing. */
function makeTempTranscript(transcript: Transcript): string {
  const dir = mkdtempSync(join(tmpdir(), "sverka-test-"));
  writeFileSync(join(dir, `${transcript.session_id}.json`), JSON.stringify(transcript));
  return dir;
}

/** Build a minimal transcript for testing. */
function makeTranscript(
  sessionId: string,
  steps: Partial<TranscriptStep>[],
): Transcript {
  return {
    session_id: sessionId,
    schema_version: "1",
    agent: { name: "devin", version: "1.0", model_name: "GLM-5.2 High" },
    final_metrics: {
      total_prompt_tokens: 1000,
      total_completion_tokens: 200,
      total_cached_tokens: 500,
      total_steps: steps.length,
    },
    steps: steps.map((s, i) => ({
      step_id: s.step_id ?? i,
      source: s.source ?? "agent",
      message: s.message ?? "",
      timestamp: s.timestamp ?? `2026-09-04T09:00:0${i}Z`,
      extra: s.extra,
    })),
  };
}

describe("readTranscript", () => {
  it("reads a transcript JSON file by session ID", () => {
    const t = makeTranscript("test-read", [{ source: "agent", message: "hello" }]);
    const dir = makeTempTranscript(t);
    const result = readTranscript("test-read", dir);
    expect(result.session_id).toBe("test-read");
    expect(result.steps).toHaveLength(1);
    expect(result.steps[0].message).toBe("hello");
    rmSync(dir, { recursive: true });
  });

  it("throws when transcript file does not exist", () => {
    expect(() => readTranscript("nonexistent", "/tmp")).toThrow();
  });
});

describe("transformStep", () => {
  it("marks agent steps with inference operation as LLM calls", () => {
    const step: TranscriptStep = {
      step_id: 1,
      source: "agent",
      message: "thinking...",
      timestamp: "2026-09-04T09:00:00Z",
      extra: { generation_model: "glm-5-2", telemetry: { source: "assistant", operation: "inference" } },
    };
    const result = transformStep(step);
    expect(result.isLlmCall).toBe(true);
    expect(result.source).toBe("agent");
    expect(result.message).toBe("thinking...");
  });

  it("marks system steps as non-LLM calls", () => {
    const step: TranscriptStep = {
      step_id: 0,
      source: "system",
      message: "system prompt",
      timestamp: "2026-09-04T09:00:00Z",
      extra: { telemetry: { source: "system", operation: "unknown" } },
    };
    const result = transformStep(step);
    expect(result.isLlmCall).toBe(false);
  });

  it("marks agent steps without inference operation as non-LLM calls", () => {
    const step: TranscriptStep = {
      step_id: 2,
      source: "agent",
      message: "",
      timestamp: "2026-09-04T09:00:01Z",
      extra: { telemetry: { source: "assistant", operation: "content" } },
    };
    const result = transformStep(step);
    expect(result.isLlmCall).toBe(false);
  });

  it("handles steps without extra field", () => {
    const step: TranscriptStep = {
      step_id: 3,
      source: "user",
      message: "do something",
      timestamp: "2026-09-04T09:00:02Z",
    };
    const result = transformStep(step);
    expect(result.isLlmCall).toBe(false);
    expect(result.message).toBe("do something");
  });
});

describe("countLlmCalls", () => {
  it("counts only agent steps with inference operation", () => {
    const t = makeTranscript("test-count", [
      { source: "system", extra: { telemetry: { operation: "unknown" } } },
      { source: "agent", extra: { telemetry: { operation: "inference" } } },
      { source: "agent", extra: { telemetry: { operation: "inference" } } },
      { source: "agent", extra: { telemetry: { operation: "content" } } },
      { source: "agent", extra: { telemetry: { operation: "inference" } } },
    ]);
    expect(countLlmCalls(t)).toBe(3);
  });

  it("returns 0 when no agent inference steps", () => {
    const t = makeTranscript("test-zero", [
      { source: "system" },
      { source: "user" },
    ]);
    expect(countLlmCalls(t)).toBe(0);
  });
});

describe("transformTranscript", () => {
  it("transforms a full transcript to trace agent data", () => {
    const t = makeTranscript("test-transform", [
      { source: "system", extra: { telemetry: { operation: "unknown" } } },
      { source: "agent", message: "step 1", extra: { telemetry: { operation: "inference" } } },
      { source: "agent", message: "step 2", extra: { telemetry: { operation: "inference" } } },
    ]);
    const result = transformTranscript(t, "raw-shell");
    expect(result.sessionId).toBe("test-transform");
    expect(result.model).toBe("GLM-5.2 High");
    expect(result.llmCallCount).toBe(2);
    expect(result.steps).toHaveLength(3);
    expect(result.steps[1].isLlmCall).toBe(true);
    expect(result.finalMetrics.totalPromptTokens).toBe(1000);
    expect(result.finalMetrics.totalSteps).toBe(3);
  });
});

describe("buildTraceData", () => {
  it("builds combined trace data from two transcripts", () => {
    const rawT = makeTranscript("raw-session", [
      { source: "agent", extra: { telemetry: { operation: "inference" } } },
      { source: "agent", extra: { telemetry: { operation: "inference" } } },
    ]);
    const sverkaT = makeTranscript("sverka-session", [
      { source: "agent", extra: { telemetry: { operation: "inference" } } },
    ]);

    const rawDir = makeTempTranscript(rawT);
    const sverkaDir = makeTempTranscript(sverkaT);
    // Both in same dir for buildTraceData
    writeFileSync(join(rawDir, "sverka-session.json"), JSON.stringify(sverkaT));

    const trace = buildTraceData("run-checks", "Run checks", "raw-session", "sverka-session", rawDir);
    expect(trace.taskId).toBe("run-checks");
    expect(trace.prompt).toBe("Run checks");
    expect(trace.agents["raw-shell"]?.llmCallCount).toBe(2);
    expect(trace.agents.sverka?.llmCallCount).toBe(1);
    rmSync(rawDir, { recursive: true });
  });
});

describe("writeTraceData", () => {
  it("writes trace JSON to the correct directory structure", async () => {
    const trace = {
      taskId: "test-task",
      prompt: "test prompt",
      agents: {
        "raw-shell": {
          sessionId: "raw",
          model: "GLM-5.2 High",
          finalMetrics: { totalPromptTokens: 100, totalCompletionTokens: 10, totalCachedTokens: 50, totalSteps: 5 },
          llmCallCount: 3,
          steps: [],
        },
      },
    };
    const outDir = mkdtempSync(join(tmpdir(), "sverka-trace-out-"));
    const path = await writeTraceData(trace, outDir);
    expect(path).toBe(join(outDir, "test-task", "trace.json"));

    const written = JSON.parse(readFileSync(path, "utf-8"));
    expect(written.taskId).toBe("test-task");
    rmSync(outDir, { recursive: true });
  });
});
