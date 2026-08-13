import { describe, it, expect, beforeEach, afterEach } from "vitest";
import { mkdtemp, rm, readFile, writeFile, mkdir } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { executeStep } from "../step-executor.js";
import { createValueStore } from "../value-store.js";
import { createArtifactStore } from "../artifact-store.js";
import { createOutputWritingMockDriver } from "./helpers/mock-driver.js";
import type { StepDefinition } from "@sverka/core";
import type { RunEvent } from "../types.js";

describe("StepExecutor", () => {
  let testDir: string;

  beforeEach(async () => {
    testDir = await mkdtemp(join(tmpdir(), "sverka-step-"));
  });

  afterEach(async () => {
    await rm(testDir, { recursive: true, force: true });
  });

  it("exportOutput captures scalar from $SVERKA_OUTPUT_DIR", async () => {
    const driver = createOutputWritingMockDriver();
    const valueStore = createValueStore();
    const artifactStore = createArtifactStore(join(testDir, "art"));
    const events: RunEvent[] = [];
    const step: StepDefinition = {
      id: "ci/build",
      runtime: {},
      operations: [
        { kind: "shell", command: 'echo "1.2.3" > $SVERKA_OUTPUT_DIR/version' },
        { kind: "exportOutput", name: "version", type: "string" },
      ],
      inputs: [],
      outputs: [],
      dependencies: [],
    };
    const result = await executeStep({
      step, driver, workspace: join(testDir, "ws"),
      artifactStore, valueStore, secrets: {},
      emit: (e) => events.push(e), isCancelled: () => false,
    });
    expect(result.status).toBe("succeeded");
    expect(valueStore.get("ci/build", "version")).toBe("1.2.3");
  });

  it("exportArtifact copies file to ArtifactStore", async () => {
    const driver = createOutputWritingMockDriver();
    const valueStore = createValueStore();
    const artifactStore = createArtifactStore(join(testDir, "art"));
    const events: RunEvent[] = [];
    // Create a file in the step workspace first.
    const wsDir = join(testDir, "ws", ".sverka", "workspace", "ci/build");
    await mkdir(wsDir, { recursive: true });
    await writeFile(join(wsDir, "dist.txt"), "artifact data");
    const step: StepDefinition = {
      id: "ci/build",
      runtime: {},
      operations: [
        { kind: "exportArtifact", name: "dist", path: "dist.txt" },
      ],
      inputs: [],
      outputs: [],
      dependencies: [],
    };
    const result = await executeStep({
      step, driver, workspace: join(testDir, "ws"),
      artifactStore, valueStore, secrets: {},
      emit: (e) => events.push(e), isCancelled: () => false,
    });
    expect(result.status).toBe("succeeded");
    // Verify artifact was stored.
    const dest = join(testDir, "retrieved.txt");
    await artifactStore.retrieve("ci/build", "dist", dest);
    expect(await readFile(dest, "utf-8")).toBe("artifact data");
  });

  it("importArtifact copies file from ArtifactStore to workspace", async () => {
    const driver = createOutputWritingMockDriver();
    const valueStore = createValueStore();
    const artifactStore = createArtifactStore(join(testDir, "art"));
    const events: RunEvent[] = [];
    // Store an artifact first.
    const srcPath = join(testDir, "source.txt");
    await writeFile(srcPath, "imported data");
    await artifactStore.store("ci/build", "dist", srcPath);
    const step: StepDefinition = {
      id: "ci/test",
      runtime: {},
      operations: [
        { kind: "importArtifact", name: "dist", from: "ci/build", output: "dist" },
      ],
      inputs: [],
      outputs: [],
      dependencies: [],
    };
    const result = await executeStep({
      step, driver, workspace: join(testDir, "ws"),
      artifactStore, valueStore, secrets: {},
      emit: (e) => events.push(e), isCancelled: () => false,
    });
    expect(result.status).toBe("succeeded");
    // Verify artifact was imported into workspace.
    const imported = await readFile(join(testDir, "ws", ".sverka", "workspace", "ci/test", "dist"), "utf-8");
    expect(imported).toBe("imported data");
  });

  it("diagnostic operation emits diagnostic RunEvent", async () => {
    const driver = createOutputWritingMockDriver();
    const valueStore = createValueStore();
    const artifactStore = createArtifactStore(join(testDir, "art"));
    const events: RunEvent[] = [];
    const step: StepDefinition = {
      id: "ci/build",
      runtime: {},
      operations: [
        { kind: "diagnostic", message: "Building...", severity: "info" },
      ],
      inputs: [],
      outputs: [],
      dependencies: [],
    };
    const result = await executeStep({
      step, driver, workspace: join(testDir, "ws"),
      artifactStore, valueStore, secrets: {},
      emit: (e) => events.push(e), isCancelled: () => false,
    });
    expect(result.status).toBe("succeeded");
    const diag = events.find((e) => e.type === "diagnostic");
    expect(diag).toBeDefined();
  });
});
