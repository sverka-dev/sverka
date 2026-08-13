import { describe, it, expect } from "vitest";
import { Scheduler } from "../scheduler.js";
import type { SchedulerConfig } from "../scheduler.js";
import { SchedulerError } from "../errors.js";
import {
  MockExecutor,
  op,
  planFromOps,
  successResult,
  validOperation,
} from "./helpers/fixtures.js";

function baseConfig(executors: readonly MockExecutor[], overrides: Partial<SchedulerConfig> = {}): SchedulerConfig {
  return {
    executors,
    maxConcurrent: 4,
    workspace: "/ws",
    artifactDir: "/art",
    cacheDir: "/cache",
    credentials: {},
    resume: false,
    ...overrides,
  };
}

describe("Scheduler — resource limits", () => {
  it("two ops requesting 4 CPU on a 4-CPU pool run sequentially", async () => {
    let running = 0;
    let maxRunning = 0;
    const exec = new MockExecutor({
      result: async (req) => {
        running++;
        maxRunning = Math.max(maxRunning, running);
        await new Promise((r) => setTimeout(r, 10));
        running--;
        return successResult(req.operation.id);
      },
    });
    const opA = validOperation({ id: "a", name: "a", resources: { cpu: "4", memory: "512Mi" } });
    const opB = validOperation({ id: "b", name: "b", resources: { cpu: "4", memory: "512Mi" } });
    const plan = planFromOps([opA, opB]);
    await new Scheduler(
      baseConfig([exec], { maxConcurrent: 4, totalCpu: 4, totalMemory: "2Gi" }),
    ).execute(plan);
    expect(maxRunning).toBe(1);
  });

  it("two ops requesting 2 CPU on a 4-CPU pool run concurrently", async () => {
    let running = 0;
    let maxRunning = 0;
    const exec = new MockExecutor({
      result: async (req) => {
        running++;
        maxRunning = Math.max(maxRunning, running);
        await new Promise((r) => setTimeout(r, 10));
        running--;
        return successResult(req.operation.id);
      },
    });
    const opA = validOperation({ id: "a", name: "a", resources: { cpu: "2", memory: "512Mi" } });
    const opB = validOperation({ id: "b", name: "b", resources: { cpu: "2", memory: "512Mi" } });
    const plan = planFromOps([opA, opB]);
    await new Scheduler(
      baseConfig([exec], { maxConcurrent: 4, totalCpu: 4, totalMemory: "2Gi" }),
    ).execute(plan);
    expect(maxRunning).toBe(2);
  });

  it("an op requesting more CPU than totalCpu raises INSUFFICIENT_RESOURCES", async () => {
    const exec = new MockExecutor();
    const opA = validOperation({ id: "a", name: "a", resources: { cpu: "8", memory: "512Mi" } });
    const plan = planFromOps([opA]);
    await expect(
      new Scheduler(
        baseConfig([exec], { totalCpu: 4, totalMemory: "2Gi" }),
      ).execute(plan),
    ).rejects.toMatchObject({
      code: "SCHEDULER_ERROR",
      context: expect.objectContaining({ code: "INSUFFICIENT_RESOURCES" }),
    });
  });

  it("totalCpu alone (no totalMemory) still enforces CPU limits", async () => {
    let running = 0;
    let maxRunning = 0;
    const exec = new MockExecutor({
      result: async (req) => {
        running++;
        maxRunning = Math.max(maxRunning, running);
        await new Promise((r) => setTimeout(r, 10));
        running--;
        return successResult(req.operation.id);
      },
    });
    const opA = validOperation({ id: "a", name: "a", resources: { cpu: "4", memory: "512Mi" } });
    const opB = validOperation({ id: "b", name: "b", resources: { cpu: "4", memory: "512Mi" } });
    const plan = planFromOps([opA, opB]);
    await new Scheduler(
      baseConfig([exec], { maxConcurrent: 4, totalCpu: 4 }),
    ).execute(plan);
    expect(maxRunning).toBe(1);
  });

  it("totalMemory alone (no totalCpu) still enforces memory limits", async () => {
    let running = 0;
    let maxRunning = 0;
    const exec = new MockExecutor({
      result: async (req) => {
        running++;
        maxRunning = Math.max(maxRunning, running);
        await new Promise((r) => setTimeout(r, 10));
        running--;
        return successResult(req.operation.id);
      },
    });
    const opA = validOperation({ id: "a", name: "a", resources: { cpu: "1", memory: "2Gi" } });
    const opB = validOperation({ id: "b", name: "b", resources: { cpu: "1", memory: "2Gi" } });
    const plan = planFromOps([opA, opB]);
    await new Scheduler(
      baseConfig([exec], { maxConcurrent: 4, totalMemory: "2Gi" }),
    ).execute(plan);
    expect(maxRunning).toBe(1);
  });
});
