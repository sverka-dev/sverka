import { describe, it, expect, afterEach } from "vitest";
import { join } from "node:path";
import { writeFile } from "node:fs/promises";
import { loadWorkflow, SdkError } from "../index.js";
import { makeTempDir, cleanupTempDir, writeSimpleConfig, writeMalformedConfig, writeSyntaxErrorConfig } from "./helpers/fixtures.js";

describe("loadWorkflow", () => {
  const dirs: string[] = [];

  afterEach(async () => {
    await Promise.all(dirs.splice(0).map(cleanupTempDir));
  });

  it("loads a valid config and returns a WorkflowDefinition", async () => {
    const dir = await makeTempDir();
    dirs.push(dir);
    const configPath = await writeSimpleConfig(dir, "true");
    const def = await loadWorkflow(configPath);
    expect(def).toBeDefined();
    expect(def.name).toBe("test");
    expect(def.workflow).toBeDefined();
    // The config uses pipeline() which returns an Operation (has kind + spec).
    // The SDK normalizes it to a Workflow at runtime.
    if ("kind" in def.workflow && "spec" in def.workflow) {
      expect(def.workflow.kind).toBeDefined();
    } else if ("roots" in def.workflow) {
      expect(def.workflow.roots).toBeInstanceOf(Array);
    } else {
      expect.fail("workflow is neither an Operation nor a Workflow");
    }
  });

  it("throws CONFIG_INVALID for malformed default export (not an object)", async () => {
    const dir = await makeTempDir();
    dirs.push(dir);
    const configPath = join(dir, "sverka.config.ts");
    await writeFile(configPath, "export default 42;\n", "utf8");
    await expect(loadWorkflow(configPath)).rejects.toMatchObject({
      code: "CONFIG_INVALID",
      name: "SdkError",
    });
  });

  it("throws CONFIG_INVALID for missing name", async () => {
    const dir = await makeTempDir();
    dirs.push(dir);
    const configPath = join(dir, "sverka.config.ts");
    await writeFile(
      configPath,
      "export default { workflow: { roots: [] } };\n",
      "utf8",
    );
    await expect(loadWorkflow(configPath)).rejects.toMatchObject({
      code: "CONFIG_INVALID",
    });
  });

  it("throws CONFIG_INVALID for missing workflow.roots", async () => {
    const dir = await makeTempDir();
    dirs.push(dir);
    const configPath = join(dir, "sverka.config.ts");
    await writeFile(
      configPath,
      "export default { name: 'test', workflow: {} };\n",
      "utf8",
    );
    await expect(loadWorkflow(configPath)).rejects.toMatchObject({
      code: "CONFIG_INVALID",
    });
  });

  it("throws CONFIG_LOAD_FAILED for syntax error (cause preserved)", async () => {
    const dir = await makeTempDir();
    dirs.push(dir);
    const configPath = await writeSyntaxErrorConfig(dir);
    await expect(loadWorkflow(configPath)).rejects.toMatchObject({
      code: "CONFIG_LOAD_FAILED",
      name: "SdkError",
    });
  });

  it("throws CONFIG_NOT_FOUND for non-existent file", async () => {
    const dir = await makeTempDir();
    dirs.push(dir);
    const configPath = join(dir, "sverka.config.ts");
    await expect(loadWorkflow(configPath)).rejects.toMatchObject({
      code: "CONFIG_NOT_FOUND",
      name: "SdkError",
    });
  });

  it("throws SdkError instances (not plain errors)", async () => {
    const dir = await makeTempDir();
    dirs.push(dir);
    const configPath = await writeMalformedConfig(dir);
    try {
      await loadWorkflow(configPath);
      expect.fail("should have thrown");
    } catch (e) {
      expect(e).toBeInstanceOf(SdkError);
    }
  });
});
