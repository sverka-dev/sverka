// Tests for agent operation execution in the native engine. Spec 27 — items 5-10, 13.
import { describe, it, expect, beforeEach, afterEach } from "vitest";
import { mkdtemp, rm, readFile, readdir } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { createEngine } from "../engine.js";
import { createStubAgentDriver, type AgentDriver, type AgentResult } from "../agent-driver.js";
import { AgentDriverError, type AgentDriverErrorCode } from "../errors.js";
import { createMockDriver } from "./helpers/mock-driver.js";
import type { RunPlan, StepDefinition } from "@sverka/workflow";

function makeAgentPlan(
  stepOverrides: Partial<StepDefinition> = {},
  agentOpOverrides: Record<string, unknown> = {},
): RunPlan {
  const step: StepDefinition = {
    id: "ci/agent",
    runtime: {},
    operations: [
      {
        kind: "agent",
        engine: "default",
        prompt: "Summarize the changes",
        ...agentOpOverrides,
      } as StepDefinition["operations"][number],
    ],
    inputs: [],
    outputs: [],
    dependencies: [],
    ...stepOverrides,
  };
  return {
    apiVersion: "sverka.dev/v1run",
    id: "rp-agent",
    graphId: "graph-agent",
    entry: { id: "ci/on-push", trigger: { kind: "push" } },
    inputs: {},
    steps: [step],
    createdAt: "2026-08-13T00:00:00.000Z",
  };
}

async function runEngine(
  config: { drivers?: readonly unknown[]; agentDrivers?: readonly AgentDriver[] },
  plan: RunPlan,
  testDir: string,
): Promise<{ events: { type: string; stepId?: string; error?: string; message?: string; severity?: string }[]; status: string }> {
  const engine = createEngine({
    drivers: (config.drivers ?? [createMockDriver()]) as never,
    ...(config.agentDrivers ? { agentDrivers: config.agentDrivers } : {}),
  });
  const events: { type: string; stepId?: string; error?: string; message?: string; severity?: string }[] = [];
  for await (const event of engine.run({
    plan,
    workspace: join(testDir, "ws"),
    artifactDir: join(testDir, "art"),
  })) {
    events.push(event as never);
  }
  const completed = events.find((e) => e.type === "run-completed") as unknown as { status: string };
  return { events, status: completed?.status ?? "unknown" };
}

describe("AgentDriver — exports (item 13)", () => {
  it("createStubAgentDriver, AgentDriver, AgentResult, AgentDriverError are exported", () => {
    const stub = createStubAgentDriver();
    expect(typeof stub.canExecute).toBe("function");
    expect(typeof stub.executeAgent).toBe("function");
    expect(stub.canExecute("default")).toBe(true);
    expect(stub.canExecute("claude")).toBe(true);
  });

  it("AgentDriverError has code AGENT_EXECUTION_FAILED", () => {
    const err = new AgentDriverError("boom", "AGENT_EXECUTION_FAILED");
    expect(err.code).toBe("AGENT_EXECUTION_FAILED");
    expect(err.message).toBe("boom");
    expect(err.name).toBe("AgentDriverError");
  });
});

describe("Agent step — stub driver lifecycle + artifact (items 5, 10)", () => {
  let testDir: string;

  beforeEach(async () => {
    testDir = await mkdtemp(join(tmpdir(), "sverka-agent-"));
  });

  afterEach(async () => {
    await rm(testDir, { recursive: true, force: true });
  });

  it("runs an agent step with the stub driver and emits standard lifecycle events", async () => {
    const { events, status } = await runEngine(
      { agentDrivers: [createStubAgentDriver()] },
      makeAgentPlan(),
      testDir,
    );
    expect(status).toBe("success");
    const types = events.map((e) => e.type);
    expect(types).toContain("step-pending");
    expect(types).toContain("step-ready");
    expect(types).toContain("step-started");
    expect(types).toContain("step-succeeded");
    const succeeded = events.find((e) => e.type === "step-succeeded");
    expect(succeeded?.stepId).toBe("ci/agent");
  });

  it("writes the agent result artifact to <artifactDir>/<stepId>/agent-result.json", async () => {
    const { status } = await runEngine(
      { agentDrivers: [createStubAgentDriver()] },
      makeAgentPlan(),
      testDir,
    );
    expect(status).toBe("success");
    const artifactPath = join(testDir, "art", "ci/agent", "agent-result.json");
    const content = JSON.parse(await readFile(artifactPath, "utf-8")) as AgentResult;
    expect(content.text).toBe("[stub agent response]");
    expect(content.finishReason).toBe("stop");
  });
});

describe("Agent step — missing driver (item 6)", () => {
  let testDir: string;

  beforeEach(async () => {
    testDir = await mkdtemp(join(tmpdir(), "sverka-agent-"));
  });

  afterEach(async () => {
    await rm(testDir, { recursive: true, force: true });
  });

  it("fails the step with NO_AGENT_DRIVER when no driver canExecute the engine", async () => {
    // Use a driver that only handles "default" and "claude", not "unknown-engine".
    const selectiveDriver: AgentDriver = {
      name: "selective",
      canExecute: (engine: string) => engine === "default" || engine === "claude",
      executeAgent: async () => ({ text: "", finishReason: "stop" }),
    };
    const { events, status } = await runEngine(
      { agentDrivers: [selectiveDriver] },
      makeAgentPlan({}, { engine: "unknown-engine" }),
      testDir,
    );
    expect(status).toBe("failure");
    const failed = events.find((e) => e.type === "step-failed");
    expect(failed?.stepId).toBe("ci/agent");
    expect(failed?.error).toContain("NO_AGENT_DRIVER");
  });
});

describe("Agent step — cache skipped (item 7)", () => {
  let testDir: string;

  beforeEach(async () => {
    testDir = await mkdtemp(join(tmpdir(), "sverka-agent-"));
  });

  afterEach(async () => {
    await rm(testDir, { recursive: true, force: true });
  });

  it("does not emit step-cache-hit even when a cache spec is present", async () => {
    const plan = makeAgentPlan({
      cache: {
        key: "agent-cache-key",
        paths: ["out"],
        policy: "pull-push",
      },
    });
    // Build a fake cache store that always reports a hit on restore.
    const fakeCache = {
      async restore() { return { key: "agent-cache-key", restoredKeys: [] }; },
      async store() { return; },
    };
    const engine = createEngine({
      drivers: [createMockDriver()],
      agentDrivers: [createStubAgentDriver()],
      cache: fakeCache as never,
    });
    const events: { type: string; stepId?: string }[] = [];
    for await (const event of engine.run({
      plan,
      workspace: join(testDir, "ws"),
      artifactDir: join(testDir, "art"),
    })) {
      events.push(event as never);
    }
    const types = events.map((e) => e.type);
    expect(types).not.toContain("step-cache-hit");
    // Step should still execute via the agent driver.
    expect(types).toContain("step-started");
    expect(types).toContain("step-succeeded");
  });
});

describe("Agent step — driver exception wrapping (item 8)", () => {
  let testDir: string;

  beforeEach(async () => {
    testDir = await mkdtemp(join(tmpdir(), "sverka-agent-"));
  });

  afterEach(async () => {
    await rm(testDir, { recursive: true, force: true });
  });

  it("wraps a thrown driver error and fails the step with AGENT_EXECUTION_FAILED", async () => {
    const throwingDriver: AgentDriver = {
      name: "throwing",
      canExecute: () => true,
      executeAgent: async () => { throw new Error("network down"); },
    };
    const { events, status } = await runEngine(
      { agentDrivers: [throwingDriver] },
      makeAgentPlan(),
      testDir,
    );
    expect(status).toBe("failure");
    const failed = events.find((e) => e.type === "step-failed");
    expect(failed?.stepId).toBe("ci/agent");
    expect(failed?.error).toContain("AGENT_EXECUTION_FAILED");
    expect(failed?.error).toContain("network down");
  });
});

describe("Agent step — unknown tool warning (item 9)", () => {
  let testDir: string;

  beforeEach(async () => {
    testDir = await mkdtemp(join(tmpdir(), "sverka-agent-"));
  });

  afterEach(async () => {
    await rm(testDir, { recursive: true, force: true });
  });

  it("emits a warn diagnostic for an unknown tool but still succeeds", async () => {
    const plan = makeAgentPlan({}, {
      tools: [{ plugin: "missing", tool: "no-such-tool" }],
    });
    const { events, status } = await runEngine(
      { agentDrivers: [createStubAgentDriver()] },
      plan,
      testDir,
    );
    expect(status).toBe("success");
    const diag = events.find(
      (e) => e.type === "diagnostic" && e.severity === "warn" && e.message?.includes("no-such-tool"),
    );
    expect(diag).toBeDefined();
    const succeeded = events.find((e) => e.type === "step-succeeded");
    expect(succeeded?.stepId).toBe("ci/agent");
  });
});

describe("Agent step — finishReason error fails the step", () => {
  let testDir: string;

  beforeEach(async () => {
    testDir = await mkdtemp(join(tmpdir(), "sverka-agent-"));
  });

  afterEach(async () => {
    await rm(testDir, { recursive: true, force: true });
  });

  it("finishReason 'error' fails the step", async () => {
    const errorDriver: AgentDriver = {
      name: "error-driver",
      canExecute: () => true,
      executeAgent: async () => ({
        text: "",
        finishReason: "error",
      }),
    };
    const { events, status } = await runEngine(
      { agentDrivers: [errorDriver] },
      makeAgentPlan(),
      testDir,
    );
    expect(status).toBe("failure");
    const failed = events.find((e) => e.type === "step-failed");
    expect(failed?.stepId).toBe("ci/agent");
  });
});
