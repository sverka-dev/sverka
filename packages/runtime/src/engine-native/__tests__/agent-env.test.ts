// Spec 54 — AgentDriver env conventions: resolveAgentEngine,
// resolveAgentDrivers, expectedAgentKeyEnv, noAgentDriverError, and the
// fenced sverka-writes extraction contract.
import { describe, it, expect, beforeEach, afterEach } from "vitest";
import { mkdtemp, rm, readFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { createEngine } from "../engine.js";
import { createMockDriver } from "./helpers/mock-driver.js";
import type { AgentDriver } from "../agent-driver.js";
import {
  AGENT_ENV,
  expectedAgentKeyEnv,
  noAgentDriverError,
  parseAgentWrites,
  collectAgentWrites,
  resolveAgentEngine,
  resolveAgentDrivers,
  createAnthropicDriver,
  createOpenaiDriver,
} from "../agent-env.js";
import { AgentDriverError } from "../errors.js";
import type { RunPlan } from "@sverka/workflow";

describe("resolveAgentEngine", () => {
  it("prefers SVERKA_AGENT_ENGINE, falls back to SVERKA_AGENT_DRIVER, then stub", () => {
    expect(resolveAgentEngine({})).toBe("stub");
    expect(resolveAgentEngine({ [AGENT_ENV.driver]: "anthropic" })).toBe(
      "anthropic",
    );
    expect(
      resolveAgentEngine({
        [AGENT_ENV.driver]: "anthropic",
        [AGENT_ENV.engine]: "openai",
      }),
    ).toBe("openai");
  });
});

describe("expectedAgentKeyEnv (Spec 54 conventions)", () => {
  it("maps engines to their key env vars", () => {
    expect(expectedAgentKeyEnv("anthropic")).toBe("SVERKA_AGENT_ANTHROPIC_KEY");
    expect(expectedAgentKeyEnv("claude-sonnet-4-5")).toBe(
      "SVERKA_AGENT_ANTHROPIC_KEY",
    );
    expect(expectedAgentKeyEnv("openai")).toBe("SVERKA_AGENT_OPENAI_KEY");
    expect(expectedAgentKeyEnv("gpt-4o")).toBe("SVERKA_AGENT_OPENAI_KEY");
    expect(expectedAgentKeyEnv("o1")).toBe("SVERKA_AGENT_OPENAI_KEY");
    expect(expectedAgentKeyEnv("duo")).toBe("GITLAB_DUO_TOKEN");
    expect(expectedAgentKeyEnv("stub")).toBeUndefined();
    expect(expectedAgentKeyEnv("mystery")).toBeUndefined();
  });
});

describe("resolveAgentDrivers", () => {
  it("registers drivers only when the key env var is present", () => {
    expect(resolveAgentDrivers({})).toEqual([]);
    const withAnthropic = resolveAgentDrivers({
      [AGENT_ENV.anthropicKey]: "sk-ant-test",
    });
    expect(withAnthropic.map((d) => d.name)).toEqual(["anthropic"]);
    const withBoth = resolveAgentDrivers({
      [AGENT_ENV.anthropicKey]: "sk-ant-test",
      [AGENT_ENV.openaiKey]: "sk-oai-test",
    });
    expect(withBoth.map((d) => d.name)).toEqual(["anthropic", "openai"]);
  });

  it("SVERKA_AGENT_DRIVER=stub registers the stub driver", () => {
    const drivers = resolveAgentDrivers({ [AGENT_ENV.driver]: "stub" });
    expect(drivers.length).toBe(1);
    expect(drivers[0]!.canExecute("stub")).toBe(true);
    expect(drivers[0]!.canExecute("anthropic")).toBe(false);
  });

  it("bundled drivers match the engines they cover", () => {
    const anthropic = createAnthropicDriver("key");
    expect(anthropic.canExecute("anthropic")).toBe(true);
    expect(anthropic.canExecute("claude-opus-4")).toBe(true);
    expect(anthropic.canExecute("openai")).toBe(false);
    const openai = createOpenaiDriver("key");
    expect(openai.canExecute("openai")).toBe(true);
    expect(openai.canExecute("gpt-4o")).toBe(true);
    expect(openai.canExecute("anthropic")).toBe(false);
  });
});

describe("noAgentDriverError — names the expected env var", () => {
  it("names SVERKA_AGENT_ANTHROPIC_KEY for anthropic engines", () => {
    const err = noAgentDriverError("anthropic", "test");
    expect(err).toBeInstanceOf(AgentDriverError);
    expect(err.code).toBe("NO_AGENT_DRIVER");
    expect(err.message).toContain("SVERKA_AGENT_ANTHROPIC_KEY");
  });

  it("names GITLAB_DUO_TOKEN for duo", () => {
    const err = noAgentDriverError("duo", "test");
    expect(err.message).toContain("GITLAB_DUO_TOKEN");
    expect(err.message).toContain("NO_AGENT_DRIVER");
  });
});

describe("parseAgentWrites — fenced sverka-writes contract", () => {
  it("extracts writes from a fenced block containing a JSON array", () => {
    const text =
      "Here is my analysis.\n```sverka-writes\n" +
      '[{"kind":"comment","body":"looks good","iid":42}]\n```\nDone.';
    expect(parseAgentWrites(text)).toEqual([
      { kind: "comment", body: "looks good", iid: 42 },
    ]);
  });

  it("accepts an object with a writes array", () => {
    const text =
      "```sverka-writes\n" + '{"writes":[{"kind":"comment","body":"x"}]}\n```';
    expect(parseAgentWrites(text)).toEqual([{ kind: "comment", body: "x" }]);
  });

  it("returns [] when the model text has no writes block", () => {
    expect(parseAgentWrites("plain analysis, no block")).toEqual([]);
  });

  it("fails loudly on malformed JSON in a writes block", () => {
    const text = "```sverka-writes\n{not json}\n```";
    expect(() => parseAgentWrites(text)).toThrowError(/AGENT_EXECUTION_FAILED/);
  });

  it("fails on writes entries without a string kind", () => {
    const text = '```sverka-writes\n[{"body":"no kind"}]\n```';
    expect(() => parseAgentWrites(text)).toThrowError(/AGENT_EXECUTION_FAILED/);
  });
});

describe("collectAgentWrites", () => {
  it("prefers explicit result.writes over text extraction", () => {
    const result = {
      text: '```sverka-writes\n[{"kind":"push"}]\n```',
      finishReason: "stop" as const,
      writes: [{ kind: "comment", body: "from driver" }],
    };
    expect(collectAgentWrites(result)).toEqual([
      { kind: "comment", body: "from driver" },
    ]);
  });

  it("falls back to text extraction when writes is absent", () => {
    const result = {
      text: '```sverka-writes\n[{"kind":"comment","body":"t"}]\n```',
      finishReason: "stop" as const,
    };
    expect(collectAgentWrites(result)).toEqual([
      { kind: "comment", body: "t" },
    ]);
  });
});

describe("writes persistence — sverka-writes.json artifact", () => {
  let testDir: string;

  beforeEach(async () => {
    testDir = await mkdtemp(join(tmpdir(), "sverka-writes-"));
  });

  afterEach(async () => {
    await rm(testDir, { recursive: true, force: true });
  });

  function makePlan(): RunPlan {
    return {
      apiVersion: "sverka.dev/v1run",
      id: "rp-writes",
      graphId: "graph-writes",
      entry: { id: "ci/on-comment", trigger: { kind: "comment" } },
      inputs: {},
      steps: [
        {
          id: "ci/triage",
          runtime: {},
          operations: [
            {
              kind: "agent",
              engine: "stub",
              prompt: "Summarize",
            } as never,
          ],
          inputs: [],
          outputs: [],
          dependencies: [],
          permissions: { write: [{ kind: "comment", target: "issue" }] },
        },
      ],
      createdAt: "2026-08-13T00:00:00.000Z",
    };
  }

  async function runForRunId(driver: AgentDriver): Promise<string> {
    const engine = createEngine({
      drivers: [createMockDriver()],
      agentDrivers: [driver],
    });
    let runId = "";
    for await (const e of engine.run({
      plan: makePlan(),
      workspace: join(testDir, "ws"),
      artifactDir: join(testDir, "art"),
    })) {
      if (e.type === "run-completed") {
        runId = (e as unknown as { runId: string }).runId;
      }
    }
    return runId;
  }

  it("persists explicit result.writes to sverka-writes.json", async () => {
    const driver: AgentDriver = {
      name: "writes-driver",
      canExecute: () => true,
      async executeAgent() {
        return {
          text: "done",
          finishReason: "stop",
          writes: [{ kind: "comment", body: "hi", iid: 7 }],
        };
      },
    };
    const runId = await runForRunId(driver);
    const raw = await readFile(
      join(testDir, "art", runId, "ci/triage", "sverka-writes.json"),
      "utf-8",
    );
    expect(JSON.parse(raw)).toEqual({
      writes: [{ kind: "comment", body: "hi", iid: 7 }],
    });
  });

  it("extracts writes from a fenced block in model text", async () => {
    const driver: AgentDriver = {
      name: "fenced-driver",
      canExecute: () => true,
      async executeAgent() {
        return {
          text: 'analysis\n```sverka-writes\n[{"kind":"comment","body":"fenced"}]\n```',
          finishReason: "stop",
        };
      },
    };
    const runId = await runForRunId(driver);
    const raw = await readFile(
      join(testDir, "art", runId, "ci/triage", "sverka-writes.json"),
      "utf-8",
    );
    expect(JSON.parse(raw)).toEqual({
      writes: [{ kind: "comment", body: "fenced" }],
    });
  });

  it("writes an empty writes file when the agent declares none", async () => {
    const driver: AgentDriver = {
      name: "quiet-driver",
      canExecute: () => true,
      async executeAgent() {
        return { text: "no writes", finishReason: "stop" };
      },
    };
    const runId = await runForRunId(driver);
    const raw = await readFile(
      join(testDir, "art", runId, "ci/triage", "sverka-writes.json"),
      "utf-8",
    );
    expect(JSON.parse(raw)).toEqual({ writes: [] });
  });
});
