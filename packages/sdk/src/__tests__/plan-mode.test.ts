import { describe, it, expect, afterEach } from "vitest";
import { plan, createSverka } from "../index.js";
import { makeTempGitRepo, cleanupTempDir, writeSimpleConfig } from "./helpers/fixtures.js";

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
    // Use a command that would fail if executed.
    const configPath = await writeSimpleConfig(dir, "false");
    const result = await plan({ root: dir, configPath });
    // Plan mode should succeed regardless of command — it doesn't execute.
    expect(result.operations.length).toBeGreaterThan(0);
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
});
