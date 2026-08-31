import { describe, it, expect, beforeEach, afterEach } from "vitest";
import { mkdtemp, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { executeStep } from "../step-executor.js";
import { createMockDriver } from "./helpers/mock-driver.js";
import { createValueStore, createArtifactStore } from "../index.js";
import type { StepDefinition } from "@sverka/workflow";

describe("StepExecutor — safe-outputs: secret enforcement (Spec 25)", () => {
  let testDir: string;

  beforeEach(async () => {
    testDir = await mkdtemp(join(tmpdir(), "sverka-safe-"));
  });

  afterEach(async () => {
    await rm(testDir, { recursive: true, force: true });
  });

  it("item 10: step without permissions.write excludes write-capable secrets", async () => {
    let capturedEnv: Record<string, string> = {};
    const driver = createMockDriver({
      executeFn: async (req) => {
        capturedEnv = req.env;
        return { exitCode: 0, stdout: "", stderr: "", durationMs: 1, timedOut: false };
      },
    });
    // Step declares runtime.secrets (so they would normally be injected),
    // but has NO permissions.write — so it should be treated as read-only
    // and the secrets should be withheld.
    const step: StepDefinition = {
      id: "ci/build",
      runtime: { secrets: ["DEPLOY_TOKEN"] },
      operations: [{ kind: "shell", command: "echo build" }],
      inputs: [],
      outputs: [],
      dependencies: [],
      // No permissions → read-only
    };
    await executeStep({
      step, driver, workspace: testDir,
      artifactStore: createArtifactStore(join(testDir, "art")),
      valueStore: createValueStore(),
      secrets: { DEPLOY_TOKEN: "secret-deploy-value" },
      emit: () => {}, isCancelled: () => false,
    });
    // Read-only step must not receive write-capable secrets
    expect(capturedEnv.DEPLOY_TOKEN).toBeUndefined();
  });

  it("item 11: step with permissions.write resolves secrets normally", async () => {
    let capturedEnv: Record<string, string> = {};
    const driver = createMockDriver({
      executeFn: async (req) => {
        capturedEnv = req.env;
        return { exitCode: 0, stdout: "", stderr: "", durationMs: 1, timedOut: false };
      },
    });
    const step: StepDefinition = {
      id: "ci/deploy",
      runtime: { secrets: ["DEPLOY_TOKEN"] },
      operations: [{ kind: "shell", command: "deploy" }],
      inputs: [],
      outputs: [],
      dependencies: [],
      permissions: {
        write: [{ kind: "deploy", target: "production" }],
      },
    };
    await executeStep({
      step, driver, workspace: testDir,
      artifactStore: createArtifactStore(join(testDir, "art")),
      valueStore: createValueStore(),
      secrets: { DEPLOY_TOKEN: "secret-deploy-value" },
      emit: () => {}, isCancelled: () => false,
    });
    // Step with declared writes resolves secrets normally
    expect(capturedEnv.DEPLOY_TOKEN).toBe("secret-deploy-value");
  });

  it("step with permissions set but empty write array is read-only", async () => {
    let capturedEnv: Record<string, string> = {};
    const driver = createMockDriver({
      executeFn: async (req) => {
        capturedEnv = req.env;
        return { exitCode: 0, stdout: "", stderr: "", durationMs: 1, timedOut: false };
      },
    });
    const step: StepDefinition = {
      id: "ci/build",
      runtime: { secrets: ["DEPLOY_TOKEN"] },
      operations: [{ kind: "shell", command: "echo build" }],
      inputs: [],
      outputs: [],
      dependencies: [],
      permissions: { write: [] },
    };
    await executeStep({
      step, driver, workspace: testDir,
      artifactStore: createArtifactStore(join(testDir, "art")),
      valueStore: createValueStore(),
      secrets: { DEPLOY_TOKEN: "secret-deploy-value" },
      emit: () => {}, isCancelled: () => false,
    });
    expect(capturedEnv.DEPLOY_TOKEN).toBeUndefined();
  });
});
