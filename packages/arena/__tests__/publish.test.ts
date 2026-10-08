import { describe, it, expect, afterAll } from "vitest";
import {
  existsSync,
  mkdtempSync,
  readFileSync,
  rmSync,
  writeFileSync,
} from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";

import { ArenaError } from "../src/config.js";
import { createFileRegistry, promptHash } from "../src/registry.js";
import { explodeResult, publishFile } from "../src/publish.js";
import type { ArenaResult, RunResult } from "../src/types.js";

const dir = mkdtempSync(join(tmpdir(), "arena-pub-"));
afterAll(() => rmSync(dir, { recursive: true, force: true }));

const PROMPT_T1 = "Fix the lint errors.";
const PROMPT_T2 = "Make the tests pass.";

function run(over: Partial<RunResult> = {}): RunResult {
  return {
    taskId: "t1",
    modelId: "m1",
    pluginIds: [],
    metrics: {
      inputTokens: 80,
      outputTokens: 40,
      thoughtTokens: 0,
      totalTokens: 120,
      toolCallCount: 3,
      llmCallCount: 2,
      executionTimeMs: 900,
      stopReason: "done",
    },
    trace: {
      sessionId: "s",
      model: "m1",
      steps: [],
      finalMetrics: {
        totalPromptTokens: 0,
        totalCompletionTokens: 0,
        totalCachedTokens: 0,
        totalSteps: 0,
      },
    },
    output: "out",
    success: true,
    checkResults: [],
    verdicts: [],
    ...over,
  };
}

function matrix(runs: RunResult[]): ArenaResult {
  return {
    timestamp: "2026-10-02T00:00:00.000Z",
    config: {
      models: ["m1", "m2"],
      plugins: [],
      tasks: ["t1", "t2"],
      repetitions: 1,
    },
    results: runs,
    aggregates: [],
    analysis: [
      { taskId: "t1", taskName: "T1", prompt: PROMPT_T1, comparisons: [] },
      { taskId: "t2", taskName: "T2", prompt: PROMPT_T2, comparisons: [] },
    ],
  };
}

/** A run trace with one step — enough for hasTrace / a stored payload. */
function traceData(sessionId: string): RunResult["trace"] {
  return {
    sessionId,
    model: "m1",
    steps: [
      {
        stepId: 1,
        timestamp: "2026-10-02T00:00:00.000Z",
        source: "agent",
        message: "m",
        isLlmCall: false,
      },
    ],
    finalMetrics: {
      totalPromptTokens: 0,
      totalCompletionTokens: 0,
      totalCachedTokens: 0,
      totalSteps: 1,
    },
  };
}

const CTX = {
  pack: "node-ci",
  agent: "devin",
  sverkaVersion: "0.9.0",
  runId: (_cell: { model: string; plugins: string[] }, i: number) =>
    `run-cell-${i}`,
};

describe("explodeResult", () => {
  it("emits one v1 doc per (model, plugin-set) cell", () => {
    const result = matrix([
      run({ taskId: "t1", modelId: "m1" }),
      run({ taskId: "t2", modelId: "m1" }),
      run({ taskId: "t1", modelId: "m2", pluginIds: ["sverka"] }),
      run({ taskId: "t1", modelId: "m2", pluginIds: [] }),
    ]);
    const docs = explodeResult(result, CTX);
    expect(docs.length).toBe(3);
    const m1 = docs.find((d) => d.model === "m1")!;
    expect(m1.tasks.map((t) => t.task).sort()).toEqual(["t1", "t2"]);
    const plug = docs.find((d) => d.model === "m2" && d.plugins.length === 1)!;
    expect(plug.plugins).toEqual(["sverka"]);
    expect(docs.every((d) => d.schema === "arena.result/v1")).toBe(true);
    expect(docs.every((d) => d.pack === "node-ci" && d.agent === "devin")).toBe(
      true,
    );
  });

  it("never merges cells via key concatenation collisions", () => {
    // model "m" + plugin "ab" vs model "ma" + plugin "b" — the old
    // concat key produced "mab" for both and merged them into one cell.
    const docs = explodeResult(
      matrix([
        run({ taskId: "t1", modelId: "m", pluginIds: ["ab"] }),
        run({ taskId: "t1", modelId: "ma", pluginIds: ["b"] }),
      ]),
      CTX,
    );
    expect(docs.length).toBe(2);
  });

  it("maps score from success+checkResults and hashes the prompt", () => {
    const result = matrix([
      run({
        taskId: "t1",
        success: false,
        checkResults: [
          { checkId: "c1", passed: false, output: "", exitCode: 1 },
          { checkId: "c2", passed: true, output: "", exitCode: 0 },
          { checkId: "c3", passed: false, output: "", exitCode: 2 },
        ],
      }),
    ]);
    const [doc] = explodeResult(result, CTX);
    const t = doc!.tasks[0]!;
    expect(t.promptHash).toBe(promptHash(PROMPT_T1));
    expect(t.score).toEqual({ passed: false, findings: 2 });
    expect(t.metrics).toMatchObject({
      tokens: 120,
      toolCalls: 3,
      durationMs: 900,
      stopReason: "done",
    });
  });

  it("sets traceRef only when the run has trace steps", () => {
    const withTrace = matrix([
      run({
        taskId: "t1",
        trace: {
          sessionId: "s",
          model: "m1",
          steps: [
            {
              stepId: 1,
              timestamp: "2026-10-02T00:00:00.000Z",
              source: "agent",
              message: "hi",
              isLlmCall: false,
            },
          ],
          finalMetrics: {
            totalPromptTokens: 0,
            totalCompletionTokens: 0,
            totalCachedTokens: 0,
            totalSteps: 1,
          },
        },
      }),
    ]);
    const [doc] = explodeResult(withTrace, CTX);
    expect(doc!.tasks[0]!.traceRef).toBe(
      `traces/${doc!.runId}/t1.0.trace.jsonl`,
    );
    const noTrace = matrix([run({ taskId: "t1" })]);
    expect(explodeResult(noTrace, CTX)[0]!.tasks[0]!.traceRef).toBeUndefined();
  });

  it("gives repeated runs of one task distinct traceRefs", () => {
    // repetitions > 1 put several runs of the same taskId in one cell —
    // the run index keeps each repetition's trace under its own file.
    const [doc] = explodeResult(
      matrix([
        run({ taskId: "t1", trace: traceData("rep-0") }),
        run({ taskId: "t1", trace: traceData("rep-1") }),
      ]),
      CTX,
    );
    expect(doc!.tasks.map((t) => t.traceRef)).toEqual([
      `traces/${doc!.runId}/t1.0.trace.jsonl`,
      `traces/${doc!.runId}/t1.1.trace.jsonl`,
    ]);
  });

  it("throws SCHEMA_INVALID (not TypeError) when analysis[] is absent", () => {
    // Hand-shaped matrix files may omit results.analysis entirely.
    const result = matrix([run({ taskId: "t1" })]) as unknown as {
      analysis?: unknown;
    };
    delete result.analysis;
    try {
      explodeResult(result as ArenaResult, CTX);
      expect.unreachable();
    } catch (e) {
      expect(e).toBeInstanceOf(ArenaError);
      expect((e as ArenaError).code).toBe("SCHEMA_INVALID");
    }
  });

  it("throws SCHEMA_INVALID when a prompt cannot be resolved", () => {
    const result = matrix([run({ taskId: "t-unknown" })]);
    expect(() => explodeResult(result, CTX)).toThrowError(ArenaError);
    try {
      explodeResult(result, CTX);
    } catch (e) {
      expect((e as ArenaError).code).toBe("SCHEMA_INVALID");
      expect((e as ArenaError).message).toContain("t-unknown");
    }
  });
});

describe("publishFile", () => {
  it("explodes a matrix file into one doc per cell, with traces", async () => {
    const reg = createFileRegistry(join(dir, "pub-matrix"));
    const file = join(dir, "matrix.json");
    writeFileSync(
      file,
      JSON.stringify(
        matrix([
          run({
            taskId: "t1",
            modelId: "m1",
            trace: {
              sessionId: "s",
              model: "m1",
              steps: [
                {
                  stepId: 1,
                  timestamp: "x",
                  source: "agent",
                  message: "m",
                  isLlmCall: false,
                },
              ],
              finalMetrics: {
                totalPromptTokens: 0,
                totalCompletionTokens: 0,
                totalCachedTokens: 0,
                totalSteps: 1,
              },
            },
          }),
          run({ taskId: "t1", modelId: "m2" }),
        ]),
      ),
    );
    const paths = await publishFile(file, reg, CTX);
    expect(paths.sort()).toEqual([
      "results/node-ci/devin/2026-10-02/run-cell-0.json",
      "results/node-ci/devin/2026-10-02/run-cell-1.json",
    ]);
    // Trace payload written for the traced run only.
    expect(
      existsSync(join(dir, "pub-matrix/traces/run-cell-0/t1.0.trace.jsonl")),
    ).toBe(true);
    const listed = await reg.list();
    expect(listed.length).toBe(2);
  });

  it("writes each repetition's trace to its own file", async () => {
    const reg = createFileRegistry(join(dir, "pub-reps"));
    const file = join(dir, "reps.json");
    writeFileSync(
      file,
      JSON.stringify(
        matrix([
          run({ taskId: "t1", trace: traceData("rep-0") }),
          run({ taskId: "t1", trace: traceData("rep-1") }),
        ]),
      ),
    );
    await publishFile(file, reg, CTX);
    const readTrace = (name: string) =>
      JSON.parse(
        readFileSync(join(dir, `pub-reps/traces/run-cell-0/${name}`), "utf8"),
      ) as { sessionId: string };
    expect(readTrace("t1.0.trace.jsonl").sessionId).toBe("rep-0");
    expect(readTrace("t1.1.trace.jsonl").sessionId).toBe("rep-1");
    const stored = JSON.parse(
      readFileSync(
        join(dir, "pub-reps/results/node-ci/devin/2026-10-02/run-cell-0.json"),
        "utf8",
      ),
    ) as { tasks: { traceRef?: string }[] };
    expect(stored.tasks.map((t) => t.traceRef)).toEqual([
      "traces/run-cell-0/t1.0.trace.jsonl",
      "traces/run-cell-0/t1.1.trace.jsonl",
    ]);
  });

  it("keeps traces for task ids whose file stems collide", async () => {
    // 'a/b' and 'a-b' both stem to 'a-b' — the run index separates them.
    const reg = createFileRegistry(join(dir, "pub-stem"));
    const file = join(dir, "stems.json");
    const m = matrix([
      run({ taskId: "a/b", trace: traceData("slash") }),
      run({ taskId: "a-b", trace: traceData("dash") }),
    ]);
    m.analysis.push(
      {
        taskId: "a/b",
        taskName: "ab",
        prompt: "p-slash",
        comparisons: [],
      },
      { taskId: "a-b", taskName: "ab2", prompt: "p-dash", comparisons: [] },
    );
    writeFileSync(file, JSON.stringify(m));
    await publishFile(file, reg, CTX);
    const readTrace = (name: string) =>
      JSON.parse(
        readFileSync(join(dir, `pub-stem/traces/run-cell-0/${name}`), "utf8"),
      ) as { sessionId: string };
    expect(readTrace("a-b.0.trace.jsonl").sessionId).toBe("slash");
    expect(readTrace("a-b.1.trace.jsonl").sessionId).toBe("dash");
  });

  it("publishes a matrix file without analysis[] when prompts cover it", async () => {
    const reg = createFileRegistry(join(dir, "pub-no-analysis"));
    const file = join(dir, "no-analysis.json");
    const m = matrix([run({ taskId: "t9" })]) as unknown as Record<
      string,
      unknown
    >;
    delete m["analysis"];
    writeFileSync(file, JSON.stringify(m));
    const paths = await publishFile(file, reg, {
      ...CTX,
      prompts: { t9: "hand-supplied prompt" },
    });
    expect(paths).toEqual(["results/node-ci/devin/2026-10-02/run-cell-0.json"]);
    const stored = JSON.parse(
      readFileSync(join(dir, "pub-no-analysis", paths[0]!), "utf8"),
    ) as { tasks: { promptHash: string }[] };
    expect(stored.tasks[0]!.promptHash).toBe(
      promptHash("hand-supplied prompt"),
    );
  });

  it("rejects a matrix file whose task prompts cannot be resolved", async () => {
    const reg = createFileRegistry(join(dir, "pub-no-prompt"));
    const file = join(dir, "no-prompt.json");
    const m = matrix([run({ taskId: "t9" })]) as unknown as Record<
      string,
      unknown
    >;
    delete m["analysis"];
    writeFileSync(file, JSON.stringify(m));
    try {
      await publishFile(file, reg, CTX);
      expect.unreachable();
    } catch (e) {
      expect(e).toBeInstanceOf(ArenaError);
      expect((e as ArenaError).code).toBe("SCHEMA_INVALID");
      expect((e as ArenaError).message).toContain("t9");
    }
  });

  it("publishes an already-shaped v1 doc verbatim (and arrays)", async () => {
    const reg = createFileRegistry(join(dir, "pub-v1"));
    const doc = {
      schema: "arena.result/v1",
      runId: "run-v1",
      pack: "p",
      agent: "a",
      model: "m",
      plugins: [],
      sverkaVersion: "1.0.0",
      startedAt: "2026-10-01T00:00:00.000Z",
      tasks: [],
    };
    const file = join(dir, "v1.json");
    writeFileSync(file, JSON.stringify([doc]));
    const paths = await publishFile(file, reg, CTX);
    expect(paths).toEqual(["results/p/a/2026-10-01/run-v1.json"]);
    const stored = JSON.parse(
      readFileSync(join(dir, "pub-v1", paths[0]!), "utf8"),
    );
    expect(stored.runId).toBe("run-v1");
  });

  it("rejects a file that is neither v1 nor matrix", async () => {
    const reg = createFileRegistry(join(dir, "pub-bad"));
    const file = join(dir, "bad.json");
    writeFileSync(file, JSON.stringify({ hello: "world" }));
    try {
      await publishFile(file, reg, CTX);
      expect.unreachable();
    } catch (e) {
      expect(e).toBeInstanceOf(ArenaError);
      expect((e as ArenaError).code).toBe("SCHEMA_INVALID");
    }
  });

  it("rejects unparseable files", async () => {
    const reg = createFileRegistry(join(dir, "pub-json"));
    const file = join(dir, "broken.json");
    writeFileSync(file, "{not json");
    try {
      await publishFile(file, reg, CTX);
      expect.unreachable();
    } catch (e) {
      expect((e as ArenaError).code).toBe("SCHEMA_INVALID");
    }
  });
});
