// Tests for network allowlist advisory diagnostic on host runtime.
// Spec 26 — item 7.

import { describe, it, expect, beforeEach, afterEach } from "vitest";
import { mkdtemp, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { createEngine } from "../../engine-native/index.js";
import { createMockDriver } from "../../engine-native/__tests__/helpers/mock-driver.js";
import type { RunEvent } from "../../engine-native/index.js";
import type { RunPlan, StepDefinition } from "@sverka/workflow";

async function collectEvents(
  engine: ReturnType<typeof createEngine>,
  request: Parameters<ReturnType<typeof createEngine>["run"]>[0],
): Promise<RunEvent[]> {
  const events: RunEvent[] = [];
  for await (const event of engine.run(request)) {
    events.push(event);
  }
  return events;
}

function makePlan(steps: StepDefinition[], id = "rp-net"): RunPlan {
  return {
    apiVersion: "sverka.dev/v1run",
    id,
    graphId: `graph-${id}`,
    entry: { id: "ci/on-push", trigger: { kind: "push" } },
    inputs: {},
    steps,
    createdAt: "2026-08-31T00:00:00.000Z",
  };
}

function shellStep(id: string, command: string, extra?: Partial<StepDefinition>): StepDefinition {
  return {
    id,
    runtime: {},
    operations: [{ kind: "shell", command }],
    inputs: [],
    outputs: [],
    dependencies: [],
    ...extra,
  };
}

describe("Host driver network allowlist diagnostic (Spec 26 item 7)", () => {
  let testDir: string;

  beforeEach(async () => {
    testDir = await mkdtemp(join(tmpdir(), "sverka-net-"));
  });

  afterEach(async () => {
    await rm(testDir, { recursive: true, force: true });
  });

  it("emits info diagnostic when host step has network.allowlist", async () => {
    const driver = createMockDriver({ name: "host" });
    const engine = createEngine({ drivers: [driver] });
    const plan = makePlan([
      shellStep("ci/build", "echo hello", {
        runtime: { mode: "host", network: { allowed: ["registry.npmjs.org"] } },
      }),
    ]);

    const events = await collectEvents(engine, {
      plan,
      workspace: testDir,
      artifactDir: join(testDir, "artifacts"),
      drivers: [driver],
    });

    const diagnostics = events.filter(
      (e) => e.type === "diagnostic" && e.stepId === "ci/build",
    );
    expect(diagnostics).toHaveLength(1);
    expect(diagnostics[0]!.type).toBe("diagnostic");
    if (diagnostics[0]!.type === "diagnostic") {
      expect(diagnostics[0]!.message).toBe("network allowlist not enforced on host runtime");
      expect(diagnostics[0]!.severity).toBe("info");
    }
  });

  it("does not emit diagnostic when host step has no network field", async () => {
    const driver = createMockDriver({ name: "host" });
    const engine = createEngine({ drivers: [driver] });
    const plan = makePlan([
      shellStep("ci/build", "echo hello", { runtime: { mode: "host" } }),
    ]);

    const events = await collectEvents(engine, {
      plan,
      workspace: testDir,
      artifactDir: join(testDir, "artifacts"),
      drivers: [driver],
    });

    const diagnostics = events.filter(
      (e) => e.type === "diagnostic" && e.stepId === "ci/build",
    );
    expect(diagnostics).toHaveLength(0);
  });
});
