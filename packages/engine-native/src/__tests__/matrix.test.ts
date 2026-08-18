import { describe, it, expect, beforeEach, afterEach } from "vitest";
import { mkdtemp, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { executeStep } from "../step-executor.js";
import { createValueStore } from "../value-store.js";
import { createArtifactStore } from "../artifact-store.js";
import { createMockDriver } from "./helpers/mock-driver.js";
import type { StepDefinition } from "@sverka/core";

// Test the matrix context ref resolution path in the step executor.
// These tests drive the real executeStep → interpolateCommand → resolveContextRef
// pipeline with a mock driver, ensuring the matrix namespace is exercised
// through production code rather than a copy of the logic.

describe("Matrix context ref resolution in step executor", () => {
  let testDir: string;

  beforeEach(async () => {
    testDir = await mkdtemp(join(tmpdir(), "sverka-matrix-"));
  });

  afterEach(async () => {
    await rm(testDir, { recursive: true, force: true });
  });

  it("resolves matrix.node from step.matrixValues", async () => {
    let capturedCommand = "";
    const driver = createMockDriver({
      executeFn: async (req) => {
        capturedCommand = req.command;
        return { exitCode: 0, stdout: "", stderr: "", durationMs: 1, timedOut: false };
      },
    });
    const step: StepDefinition = {
      id: "ci/build",
      runtime: {},
      operations: [{ kind: "shell", command: "echo ${matrix.node}" }],
      inputs: [{ kind: "context", namespace: "matrix", field: "node" }],
      outputs: [],
      dependencies: [],
      matrixValues: { node: 18, os: "ubuntu" },
    };
    await executeStep({
      step, driver, workspace: testDir,
      artifactStore: createArtifactStore(join(testDir, "art")),
      valueStore: createValueStore(), secrets: {},
      emit: () => {}, isCancelled: () => false,
    });
    expect(capturedCommand).toBe("echo 18");
  });

  it("resolves matrix.os from step.matrixValues", async () => {
    let capturedCommand = "";
    const driver = createMockDriver({
      executeFn: async (req) => {
        capturedCommand = req.command;
        return { exitCode: 0, stdout: "", stderr: "", durationMs: 1, timedOut: false };
      },
    });
    const step: StepDefinition = {
      id: "ci/build",
      runtime: {},
      operations: [{ kind: "shell", command: "echo ${matrix.os}" }],
      inputs: [{ kind: "context", namespace: "matrix", field: "os" }],
      outputs: [],
      dependencies: [],
      matrixValues: { node: 18, os: "ubuntu" },
    };
    await executeStep({
      step, driver, workspace: testDir,
      artifactStore: createArtifactStore(join(testDir, "art")),
      valueStore: createValueStore(), secrets: {},
      emit: () => {}, isCancelled: () => false,
    });
    expect(capturedCommand).toBe("echo ubuntu");
  });

  it("throws for matrix ref when matrixValues is not set", async () => {
    const driver = createMockDriver();
    const step: StepDefinition = {
      id: "ci/build",
      runtime: {},
      operations: [{ kind: "shell", command: "echo ${matrix.node}" }],
      inputs: [{ kind: "context", namespace: "matrix", field: "node" }],
      outputs: [],
      dependencies: [],
    };
    const result = await executeStep({
      step, driver, workspace: testDir,
      artifactStore: createArtifactStore(join(testDir, "art")),
      valueStore: createValueStore(), secrets: {},
      emit: () => {}, isCancelled: () => false,
    });
    expect(result.status).toBe("failed");
    expect(result.error).toContain("matrix.node");
  });
});
