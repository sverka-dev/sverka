import { describe, it, expect, afterEach } from "vitest";
import { join } from "node:path";
import { SdkError, loadWorkflow, createSverka, execute } from "../index.js";
import {
  makeTempDir,
  makeTempGitRepo,
  cleanupTempDir,
  writeMalformedConfig,
  writeSyntaxErrorConfig,
} from "./helpers/fixtures.js";

describe("error handling", () => {
  const dirs: string[] = [];

  afterEach(async () => {
    await Promise.all(dirs.splice(0).map(cleanupTempDir));
  });

  it("CONFIG_INVALID for malformed default export", async () => {
    const dir = await makeTempDir();
    dirs.push(dir);
    const configPath = await writeMalformedConfig(dir);
    await expect(loadWorkflow(configPath)).rejects.toMatchObject({
      code: "CONFIG_INVALID",
    });
  });

  it("CONFIG_LOAD_FAILED preserves cause", async () => {
    const dir = await makeTempDir();
    dirs.push(dir);
    const configPath = await writeSyntaxErrorConfig(dir);
    try {
      await loadWorkflow(configPath);
      expect.fail("should have thrown");
    } catch (e) {
      expect(e).toBeInstanceOf(SdkError);
      const err = e as SdkError;
      expect(err.code).toBe("CONFIG_LOAD_FAILED");
      expect(err.cause).toBeDefined();
    }
  });

  it("CONFIG_NOT_FOUND for non-existent file", async () => {
    const dir = await makeTempDir();
    dirs.push(dir);
    const configPath = join(dir, "sverka.config.ts");
    await expect(loadWorkflow(configPath)).rejects.toMatchObject({
      code: "CONFIG_NOT_FOUND",
    });
  });

  it("CONFIG_NOT_FOUND when no config and auto-discovery has no checks", async () => {
    // A git repo with no recognized languages/package managers.
    const dir = await makeTempGitRepo();
    dirs.push(dir);
    await expect(execute({ root: dir })).rejects.toMatchObject({
      code: "CONFIG_NOT_FOUND",
    });
  });
});

describe("createSverka defaults", () => {
  const dirs: string[] = [];

  afterEach(async () => {
    await Promise.all(dirs.splice(0).map(cleanupTempDir));
  });

  it("default options applied to subsequent calls", async () => {
    const dir = await makeTempGitRepo();
    dirs.push(dir);
    const sverka = createSverka({ root: dir });
    // plan() with no options should use the default root.
    const result = await sverka.plan();
    expect(result.context.root).toBe(dir);
  });

  it("per-call options override defaults", async () => {
    const dir1 = await makeTempGitRepo();
    dirs.push(dir1);
    const dir2 = await makeTempGitRepo();
    dirs.push(dir2);
    const sverka = createSverka({ root: dir1 });
    // Override root with dir2.
    const result = await sverka.plan({ root: dir2 });
    expect(result.context.root).toBe(dir2);
  });
});
