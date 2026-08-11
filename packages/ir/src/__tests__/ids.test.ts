import { describe, it, expect } from "vitest";
import { createHash } from "node:crypto";
import { computePlanId, computeOperationId } from "../ids.js";
import { canonicalStringify } from "../internal/canonical.js";
import type { Plan } from "../plan.js";

/** A minimal plan body (no id/createdAt) for id computation. */
function planBody(overrides: Partial<Omit<Plan, "id" | "createdAt">> = {}) {
  return {
    apiVersion: "sverka.dev/v1" as const,
    name: "ci",
    sourceContextHash: "abc123",
    operations: [
      {
        id: "op-a",
        kind: "run" as const,
        name: "build",
        dependsOn: [],
        executor: { type: "host" as const },
        resources: { cpu: "1", memory: "512Mi" },
        network: "deny" as const,
        credentials: [],
        artifacts: [],
        retry: { maxAttempts: 1, backoffSeconds: 0, retryOn: ["failure"] as readonly ("failure" | "timeout")[] },
        timeoutSeconds: 60,
        continueOnError: false,
      },
    ],
    metadata: { sverkaVersion: "0.0.0", generatedBy: "planner" as const },
    ...overrides,
  };
}

describe("computePlanId", () => {
  it("is prefixed with plan-", () => {
    const id = computePlanId(planBody());
    expect(id.startsWith("plan-")).toBe(true);
  });

  it("is plan- + 64 hex chars (sha256)", () => {
    const id = computePlanId(planBody());
    const hex = id.slice("plan-".length);
    expect(hex.length).toBe(64);
    expect(hex).toMatch(/^[0-9a-f]{64}$/);
  });

  it("is deterministic: same body → same id", () => {
    expect(computePlanId(planBody())).toBe(computePlanId(planBody()));
  });

  it("is independent of key insertion order in the body", () => {
    // Build two bodies with the same content but different key order by
    // constructing via spread in different orders.
    const a = planBody();
    const b: typeof a = {
      metadata: a.metadata,
      operations: a.operations,
      sourceContextHash: a.sourceContextHash,
      name: a.name,
      apiVersion: a.apiVersion,
    };
    expect(computePlanId(a)).toBe(computePlanId(b));
  });

  it("changes when an operation changes", () => {
    const a = planBody();
    const b = planBody({
      operations: [
        { ...a.operations[0]!, name: "test" },
      ],
    });
    expect(computePlanId(a)).not.toBe(computePlanId(b));
  });

  it("changes when sourceContextHash changes", () => {
    const a = planBody();
    const b = planBody({ sourceContextHash: "different" });
    expect(computePlanId(a)).not.toBe(computePlanId(b));
  });

  it("ignores id and createdAt even when present in the input", () => {
    // A complete Plan with id and createdAt should produce the same id as
    // the stripped body, because computePlanId strips them at runtime.
    const body = planBody();
    const idFromBody = computePlanId(body);
    const completePlan: Plan = {
      ...body,
      id: idFromBody,
      createdAt: "2026-01-01T00:00:00.000Z",
    };
    const idFromComplete = computePlanId(completePlan);
    expect(idFromComplete).toBe(idFromBody);
  });

  it("matches a manual sha256 over the canonical serialization", () => {
    const body = planBody();
    const id = computePlanId(body);
    // Recompute independently: canonical JSON of the five identity fields,
    // sha256, prefix.
    const canonical = canonicalStringify({
      apiVersion: body.apiVersion,
      name: body.name,
      sourceContextHash: body.sourceContextHash,
      operations: body.operations,
      metadata: body.metadata,
    });
    const expectedHex = createHash("sha256").update(canonical, "utf8").digest("hex");
    expect(id).toBe(`plan-${expectedHex}`);
  });
});

describe("computeOperationId", () => {
  it("is prefixed with op-", () => {
    const id = computeOperationId("run", "build", {});
    expect(id.startsWith("op-")).toBe(true);
  });

  it("is op- + 64 hex chars", () => {
    const id = computeOperationId("run", "build", {});
    const hex = id.slice("op-".length);
    expect(hex).toMatch(/^[0-9a-f]{64}$/);
  });

  it("is deterministic for identical inputs", () => {
    expect(computeOperationId("run", "build", { os: "linux" })).toBe(
      computeOperationId("run", "build", { os: "linux" }),
    );
  });

  it("is independent of context key insertion order", () => {
    const a = computeOperationId("run", "build", { os: "linux", arch: "x64" });
    const b = computeOperationId("run", "build", { arch: "x64", os: "linux" });
    expect(a).toBe(b);
  });

  it("differs across kinds", () => {
    expect(computeOperationId("run", "build", {})).not.toBe(
      computeOperationId("check", "build", {}),
    );
  });

  it("differs across names", () => {
    expect(computeOperationId("run", "build", {})).not.toBe(
      computeOperationId("run", "test", {}),
    );
  });

  it("matrix expansion produces distinct, deterministic ids", () => {
    const combos = [
      { os: "linux", arch: "x64" },
      { os: "linux", arch: "arm64" },
      { os: "macos", arch: "x64" },
      { os: "macos", arch: "arm64" },
    ];
    const ids = combos.map((c) => computeOperationId("run", "build", c));
    expect(new Set(ids).size).toBe(ids.length); // all distinct
    // deterministic
    const again = combos.map((c) => computeOperationId("run", "build", c));
    expect(again).toEqual(ids);
  });
});
