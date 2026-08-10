import { describe, it, expect, afterEach } from "vitest";
import { execute, createSverka } from "../index.js";
import {
  makeTempGitRepo,
  cleanupTempDir,
  writeSimpleConfig,
  writeFailingConfig,
} from "./helpers/fixtures.js";

describe("execute mode", () => {
  const dirs: string[] = [];

  afterEach(async () => {
    await Promise.all(dirs.splice(0).map(cleanupTempDir));
  });

  it("returns ExecutionResult with status success for a passing command", async () => {
    const dir = await makeTempGitRepo();
    dirs.push(dir);
    const configPath = await writeSimpleConfig(dir, "true");
    const result = await execute({ root: dir, configPath });
    expect(result).toBeDefined();
    expect(result.status).toBe("success");
    expect(result.findings).toEqual([]);
    expect(result.verdict).toBe("pass");
    expect(result.policyResult).toBeDefined();
    expect(result.outcomes.size).toBeGreaterThan(0);
    expect(result.durationMs).toBeGreaterThanOrEqual(0);
  });

  it("returns ExecutionResult with status failure for a failing command", async () => {
    const dir = await makeTempGitRepo();
    dirs.push(dir);
    const configPath = await writeFailingConfig(dir);
    const result = await execute({ root: dir, configPath });
    expect(result.status).toBe("failure");
    expect(result.verdict).toBe("fail");
    expect(result.findings).toEqual([]);
  });

  it("findings is empty (stub until wave 11)", async () => {
    const dir = await makeTempGitRepo();
    dirs.push(dir);
    const configPath = await writeSimpleConfig(dir, "true");
    const result = await execute({ root: dir, configPath });
    expect(result.findings).toEqual([]);
  });

  it("policyResult is from evaluatePolicy([], DEFAULT_POLICY, [])", async () => {
    const dir = await makeTempGitRepo();
    dirs.push(dir);
    const configPath = await writeSimpleConfig(dir, "true");
    const result = await execute({ root: dir, configPath });
    // With no findings and DEFAULT_POLICY, verdict should be "pass".
    expect(result.policyResult.verdict).toBe("pass");
    expect(result.policyResult.triggered).toEqual([]);
  });

  it("outcomes map has entries for each operation", async () => {
    const dir = await makeTempGitRepo();
    dirs.push(dir);
    const configPath = await writeSimpleConfig(dir, "true");
    const result = await execute({ root: dir, configPath });
    expect(result.outcomes.size).toBeGreaterThan(0);
    for (const outcome of result.outcomes.values()) {
      expect(outcome.operationId).toBeDefined();
      expect(outcome.status).toBeDefined();
      expect(typeof outcome.durationMs).toBe("number");
    }
  });

  it("createSverka execute works the same as top-level execute", async () => {
    const dir = await makeTempGitRepo();
    dirs.push(dir);
    const configPath = await writeSimpleConfig(dir, "true");
    const sverka = createSverka({ root: dir, configPath });
    const result = await sverka.execute();
    expect(result.status).toBe("success");
  });
});
