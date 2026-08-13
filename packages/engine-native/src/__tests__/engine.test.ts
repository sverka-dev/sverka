import { describe, it, expect, beforeEach, afterEach } from "vitest";
import { mkdtemp, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { createEngine } from "../engine.js";
import { createMockDriver, createOutputWritingMockDriver } from "./helpers/mock-driver.js";
import { makeSingleStepPlan, makeDependencyPlan, makeFailingPlan } from "./helpers/fixtures.js";

describe("createEngine", () => {
  it("returns an Engine with run() and cancel()", () => {
    const engine = createEngine({ drivers: [createMockDriver()] });
    expect(typeof engine.run).toBe("function");
    expect(typeof engine.cancel).toBe("function");
  });
});

describe("Engine.run", () => {
  let testDir: string;

  beforeEach(async () => {
    testDir = await mkdtemp(join(tmpdir(), "sverka-eng-"));
  });

  afterEach(async () => {
    await rm(testDir, { recursive: true, force: true });
  });

  it("runs a single-step plan and emits correct events", async () => {
    const engine = createEngine({ drivers: [createMockDriver()] });
    const events: unknown[] = [];
    for await (const event of engine.run({
      plan: makeSingleStepPlan("echo hello"),
      workspace: join(testDir, "ws"),
      artifactDir: join(testDir, "art"),
    })) {
      events.push(event);
    }
    const types = events.map((e) => (e as { type: string }).type);
    expect(types).toContain("run-started");
    expect(types).toContain("step-started");
    expect(types).toContain("step-succeeded");
    expect(types).toContain("run-completed");
    const completed = events.find((e) => (e as { type: string }).type === "run-completed") as unknown as unknown as { status: string };
    expect(completed.status).toBe("success");
  });

  it("runs multi-step plan with dependencies in topological order", async () => {
    const engine = createEngine({ drivers: [createOutputWritingMockDriver()] });
    const events: { type: string; stepId?: string }[] = [];
    for await (const event of engine.run({
      plan: makeDependencyPlan(),
      workspace: join(testDir, "ws"),
      artifactDir: join(testDir, "art"),
    })) {
      events.push(event as { type: string; stepId?: string });
    }
    const started = events.filter((e) => e.type === "step-started").map((e) => e.stepId);
    // build must start before test, test before deploy.
    expect(started.indexOf("ci/build")).toBeLessThan(started.indexOf("ci/test"));
    expect(started.indexOf("ci/test")).toBeLessThan(started.indexOf("ci/deploy"));
    const completed = events.find((e) => e.type === "run-completed") as unknown as { status: string };
    expect(completed.status).toBe("success");
  });

  it("propagates step failure to dependents", async () => {
    const engine = createEngine({ drivers: [createMockDriver()] });
    const events: { type: string; stepId?: string }[] = [];
    for await (const event of engine.run({
      plan: makeFailingPlan(),
      workspace: join(testDir, "ws"),
      artifactDir: join(testDir, "art"),
    })) {
      events.push(event as { type: string; stepId?: string });
    }
    // build should fail, test should be cancelled.
    const failed = events.filter((e) => e.type === "step-failed").map((e) => e.stepId);
    const cancelled = events.filter((e) => e.type === "step-cancelled").map((e) => e.stepId);
    expect(failed).toContain("ci/build");
    expect(cancelled).toContain("ci/test");
    const completed = events.find((e) => e.type === "run-completed") as unknown as { status: string };
    expect(completed.status).toBe("failure");
  });

  it("supports cancellation", async () => {
    const slowDriver = createMockDriver({ delayMs: 500 });
    const engine = createEngine({ drivers: [slowDriver] });
    const events: { type: string; stepId?: string }[] = [];
    const iter = engine.run({
      plan: makeSingleStepPlan("sleep 10"),
      workspace: join(testDir, "ws"),
      artifactDir: join(testDir, "art"),
    });
    const collectPromise = (async () => {
      for await (const event of iter) {
        events.push(event as { type: string; stepId?: string });
      }
    })();
    // Cancel after a short delay.
    setTimeout(() => engine.cancel(), 50);
    await collectPromise;
    const completed = events.find((e) => e.type === "run-completed") as unknown as { status: string };
    expect(completed.status).toBe("cancelled");
  });

  it("selects first matching driver", async () => {
    const driver1 = createMockDriver({ name: "d1", canExecuteFn: () => false });
    const driver2 = createMockDriver({ name: "d2", canExecuteFn: () => true });
    const engine = createEngine({ drivers: [driver1, driver2] });
    const events: { type: string }[] = [];
    for await (const event of engine.run({
      plan: makeSingleStepPlan(),
      workspace: join(testDir, "ws"),
      artifactDir: join(testDir, "art"),
    })) {
      events.push(event as { type: string });
    }
    const completed = events.find((e) => e.type === "run-completed") as unknown as { status: string };
    expect(completed.status).toBe("success");
  });

  it("fails step when no driver matches", async () => {
    const driver = createMockDriver({ canExecuteFn: () => false });
    const engine = createEngine({ drivers: [driver] });
    const events: { type: string; stepId?: string; error?: string }[] = [];
    for await (const event of engine.run({
      plan: makeSingleStepPlan(),
      workspace: join(testDir, "ws"),
      artifactDir: join(testDir, "art"),
    })) {
      events.push(event as { type: string; stepId?: string; error?: string });
    }
    const failed = events.find((e) => e.type === "step-failed");
    expect(failed).toBeDefined();
    expect(failed!.error).toContain("no runtime driver");
  });
});
