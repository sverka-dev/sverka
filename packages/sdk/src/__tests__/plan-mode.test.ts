import { describe, it, expect, afterEach } from "vitest";
import { existsSync } from "node:fs";
import { join } from "node:path";
import { plan, createSverka } from "../index.js";
import {
  makeTempGitRepo,
  makeTempGitRepoWithPackageJson,
  cleanupTempDir,
  writeSimpleConfig,
} from "./helpers/fixtures.js";

describe("plan mode", () => {
  const dirs: string[] = [];

  afterEach(async () => {
    await Promise.all(dirs.splice(0).map(cleanupTempDir));
  });

  it("auto-discovery: returns PlanResult with context and proposal (zero config)", async () => {
    const dir = await makeTempGitRepo();
    dirs.push(dir);
    const result = await plan({ root: dir });
    expect(result).toBeDefined();
    expect(result.context).toBeDefined();
    expect(result.context.root).toBe(dir);
    expect(result.proposal).not.toBeNull();
    expect(result.operations).toEqual([]);
  });

  it("with config: returns PlanResult with operations and proposal=null", async () => {
    const dir = await makeTempGitRepo();
    dirs.push(dir);
    const configPath = await writeSimpleConfig(dir, "true");
    const result = await plan({ root: dir, configPath });
    expect(result).toBeDefined();
    expect(result.context).toBeDefined();
    expect(result.proposal).toBeNull();
    expect(result.operations.length).toBeGreaterThan(0);
  });

  it("no side effects (plan mode does not execute commands)", async () => {
    const dir = await makeTempGitRepo();
    dirs.push(dir);
    // Use a command that would create a marker if executed.
    const marker = join(dir, "marker.txt");
    const configPath = await writeSimpleConfig(dir, "touch", [marker]);
    const result = await plan({ root: dir, configPath });
    expect(result.operations.length).toBeGreaterThan(0);
    expect(existsSync(marker)).toBe(false);
  });

  it("createSverka plan works the same as top-level plan", async () => {
    const dir = await makeTempGitRepo();
    dirs.push(dir);
    const sverka = createSverka({ root: dir });
    const result = await sverka.plan();
    expect(result).toBeDefined();
    expect(result.context).toBeDefined();
    expect(result.proposal).not.toBeNull();
  });

  it("auto-discovery: resolves proposed checks into operations when package managers are detected", async () => {
    const dir = await makeTempGitRepoWithPackageJson();
    dirs.push(dir);
    const result = await plan({ root: dir });
    expect(result.proposal).not.toBeNull();
    expect(result.proposal!.checks.length).toBeGreaterThan(0);
    // The builtin resolver should produce operations for Node checks.
    expect(result.operations.length).toBeGreaterThan(0);
    for (const op of result.operations) {
      expect(op.kind).toBe("check");
      expect(op.command).toBeDefined();
    }
  });
});
