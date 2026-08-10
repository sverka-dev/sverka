import { describe, it, expect } from "vitest";
import { pipeline, run, task, workflow, validatePlan } from "../index.js";
import { PlanRuntime } from "../internal/plan-runtime.js";
import { convertToPlan } from "../convert.js";

async function makeOperations(...ops: Parameters<typeof workflow>): Promise<readonly import("../index.js").OperationSpec[]> {
  const wf = workflow(...ops);
  const runtime = new PlanRuntime();
  const result = await wf.plan(runtime);
  return result.operations;
}

describe("convertToPlan", () => {
  it("produces a valid Plan that passes validatePlan", async () => {
    const operations = await makeOperations("test", pipeline(task("op1", run({ command: "true" }))));
    const plan = convertToPlan(operations, { name: "test", executor: "host" });
    const validation = validatePlan(plan);
    expect(validation.valid).toBe(true);
    expect(validation.errors).toHaveLength(0);
  });

  it("fills defaults: timeoutSeconds=300, resources={cpu:'1',memory:'512Mi'}, dependsOn=[]", async () => {
    const operations = await makeOperations("test", pipeline(task("op1", run({ command: "true" }))));
    const plan = convertToPlan(operations, { name: "test", executor: "host" });
    const op = plan.operations[0]!;
    expect(op.timeoutSeconds).toBe(300);
    expect(op.resources.cpu).toBe("1");
    expect(op.resources.memory).toBe("512Mi");
    expect(op.dependsOn).toEqual([]);
  });

  it("executor.type defaults to 'host'", async () => {
    const operations = await makeOperations("test", pipeline(task("op1", run({ command: "true" }))));
    const plan = convertToPlan(operations, { name: "test", executor: "host" });
    expect(plan.operations[0]!.executor.type).toBe("host");
  });

  it("executor.type is 'docker' when option is docker", async () => {
    const operations = await makeOperations("test", pipeline(task("op1", run({ command: "echo" }))));
    const plan = convertToPlan(operations, { name: "test", executor: "docker" });
    expect(plan.operations[0]!.executor.type).toBe("docker");
  });

  it("copies image and imageDigest from spec", async () => {
    const operations = await makeOperations(
      "test",
      pipeline(task("op1", run({ command: "echo", image: "node:24", imageDigest: "sha256:" + "a".repeat(64) }))),
    );
    const plan = convertToPlan(operations, { name: "test", executor: "docker" });
    expect(plan.operations[0]!.executor.image).toBe("node:24");
    expect(plan.operations[0]!.executor.imageDigest).toBe("sha256:" + "a".repeat(64));
  });

  it("retry defaults to {maxAttempts:1, backoffSeconds:0, retryOn:['failure','timeout']}", async () => {
    const operations = await makeOperations("test", pipeline(task("op1", run({ command: "true" }))));
    const plan = convertToPlan(operations, { name: "test", executor: "host" });
    const retry = plan.operations[0]!.retry;
    expect(retry.maxAttempts).toBe(1);
    expect(retry.backoffSeconds).toBe(0);
    expect(retry.retryOn).toEqual(["failure", "timeout"]);
  });

  it("network defaults to 'deny'", async () => {
    const operations = await makeOperations("test", pipeline(task("op1", run({ command: "true" }))));
    const plan = convertToPlan(operations, { name: "test", executor: "host" });
    expect(plan.operations[0]!.network).toBe("deny");
  });

  it("continueOnError defaults to false", async () => {
    const operations = await makeOperations("test", pipeline(task("op1", run({ command: "true" }))));
    const plan = convertToPlan(operations, { name: "test", executor: "host" });
    expect(plan.operations[0]!.continueOnError).toBe(false);
  });

  it("artifacts default to [] with retain=false", async () => {
    const operations = await makeOperations(
      "test",
      pipeline(task("op1", run({ command: "true", artifacts: [{ path: "dist" }] }))),
    );
    const plan = convertToPlan(operations, { name: "test", executor: "host" });
    expect(plan.operations[0]!.artifacts).toHaveLength(1);
    expect(plan.operations[0]!.artifacts[0]!.retain).toBe(false);
  });

  it("computePlanId is deterministic (same input → same id)", async () => {
    const operations = await makeOperations("test", pipeline(task("op1", run({ command: "true" }))));
    const plan1 = convertToPlan(operations, { name: "test", executor: "host" });
    const plan2 = convertToPlan(operations, { name: "test", executor: "host" });
    // createdAt differs but id is computed without createdAt.
    expect(plan1.id).toBe(plan2.id);
    expect(plan1.id).toMatch(/^plan-[0-9a-f]{64}$/);
  });

  it("sets apiVersion to sverka.dev/v1", async () => {
    const operations = await makeOperations("test", pipeline(task("op1", run({ command: "true" }))));
    const plan = convertToPlan(operations, { name: "test", executor: "host" });
    expect(plan.apiVersion).toBe("sverka.dev/v1");
  });

  it("sets metadata with sverkaVersion and generatedBy", async () => {
    const operations = await makeOperations("test", pipeline(task("op1", run({ command: "true" }))));
    const plan = convertToPlan(operations, { name: "test", executor: "host" });
    expect(plan.metadata.sverkaVersion).toBe("0.1.0");
    expect(plan.metadata.generatedBy).toBe("manual");
  });

  it("sourceContextHash is empty string when no context", async () => {
    const operations = await makeOperations("test", pipeline(task("op1", run({ command: "true" }))));
    const plan = convertToPlan(operations, { name: "test", executor: "host" });
    expect(plan.sourceContextHash).toBe("");
  });

  it("preserves dependsOn from multi-op pipeline", async () => {
    const operations = await makeOperations(
      "test",
      pipeline(
        task("op1", run({ command: "true" })),
        task("op2", run({ command: "true" })),
      ),
    );
    const plan = convertToPlan(operations, { name: "test", executor: "host" });
    expect(plan.operations).toHaveLength(2);
    // op2 depends on op1 (pipeline order).
    const op2 = plan.operations.find((o) => o.name === "op2");
    expect(op2).toBeDefined();
    expect(op2!.dependsOn.length).toBeGreaterThan(0);
  });

  it("passes tags from OperationSpec to PlanOperation", async () => {
    const operations = await makeOperations(
      "test",
      pipeline(task("op1", run({ command: "true", tags: ["critical", "security"] }))),
    );
    const plan = convertToPlan(operations, { name: "test", executor: "host" });
    expect(plan.operations[0]!.tags).toEqual(["critical", "security"]);
  });

  it("omits tags when OperationSpec has no tags", async () => {
    const operations = await makeOperations(
      "test",
      pipeline(task("op1", run({ command: "true" }))),
    );
    const plan = convertToPlan(operations, { name: "test", executor: "host" });
    expect(plan.operations[0]!.tags).toBeUndefined();
  });
});
