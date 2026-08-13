import { describe, it, expect, beforeEach, afterEach } from "vitest";
import { mkdtemp, writeFile, readFile, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { createArtifactStore } from "../artifact-store.js";

describe("ArtifactStore", () => {
  let testDir: string;

  beforeEach(async () => {
    testDir = await mkdtemp(join(tmpdir(), "sverka-art-"));
  });

  afterEach(async () => {
    await rm(testDir, { recursive: true, force: true });
  });

  it("store/retrieve files between steps", async () => {
    const store = createArtifactStore(join(testDir, "artifacts"));
    // Create a source file.
    const srcPath = join(testDir, "source.txt");
    await writeFile(srcPath, "artifact content");
    // Store it.
    const storedPath = await store.store("ci/build", "dist", srcPath);
    expect(storedPath).toContain("ci/build");
    // Retrieve it.
    const destPath = join(testDir, "retrieved.txt");
    await store.retrieve("ci/build", "dist", destPath);
    const content = await readFile(destPath, "utf-8");
    expect(content).toBe("artifact content");
  });

  it("throws EngineError on missing source", async () => {
    const store = createArtifactStore(join(testDir, "artifacts"));
    await expect(
      store.store("ci/build", "dist", join(testDir, "nonexistent")),
    ).rejects.toThrow();
  });
});
