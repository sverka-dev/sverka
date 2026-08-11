import { describe, it, expect, afterEach } from "vitest";
import { execute, createSverka } from "../index.js";
import type { CheckResolver } from "../index.js";
import { makeTempGitRepo, makeTempGitRepoWithPackageJson, cleanupTempDir, writeSimpleConfig, writeFailingConfig } from "./helpers/fixtures.js";

describe("execute mode", { timeout: 30_000 }, () => {
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

  it("reports empty findings, a passing policy result, and per-operation outcomes", async () => {
    const dir = await makeTempGitRepo();
    dirs.push(dir);
    const configPath = await writeSimpleConfig(dir, "true");
    const result = await execute({ root: dir, configPath });

    // findings is a stub until wave 11.
    expect(result.findings).toEqual([]);

    // With no findings and DEFAULT_POLICY, the verdict is "pass".
    expect(result.policyResult.verdict).toBe("pass");
    expect(result.policyResult.triggered).toEqual([]);

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

  it("executes auto-discovered checks using a custom resolver", async () => {
    const dir = await makeTempGitRepoWithPackageJson();
    dirs.push(dir);
    const customResolver: CheckResolver = {
      resolve(check) {
        return {
          checkId: check.checkId,
          operation: {
            id: check.id,
            kind: "check",
            name: check.checkId,
            description: check.reason,
            command: "true",
            args: [],
          },
          outputs: [],
        };
      },
    };
    const result = await execute({ root: dir, resolver: customResolver });
    expect(result.status).toBe("success");
    expect(result.verdict).toBe("pass");
    expect(result.outcomes.size).toBeGreaterThan(0);
  });

  it("extracts SARIF findings from resolved-check outputs before cleanup", async () => {
    const dir = await makeTempGitRepoWithPackageJson();
    dirs.push(dir);
    const sarif = JSON.stringify({
      version: "2.1.0",
      runs: [
        {
          tool: { driver: { name: "test-tool", version: "1.0.0" } },
          results: [
            {
              ruleId: "R1",
              level: "error",
              message: { text: "bad code" },
              locations: [
                {
                  physicalLocation: {
                    artifactLocation: { uri: "src/a.ts" },
                    region: { startLine: 1, endLine: 1 },
                  },
                },
              ],
            },
          ],
        },
      ],
    });
    const customResolver: CheckResolver = {
      resolve(check) {
        if (check.checkId !== "test") return null;
        return {
          checkId: check.checkId,
          operation: {
            id: check.id,
            kind: "check",
            name: check.checkId,
            description: check.reason,
            command: "node",
            args: ["-e", `require('fs').writeFileSync('findings.sarif', '${sarif}')`],
          },
          outputs: [{ path: "findings.sarif", format: "sarif" }],
        };
      },
    };
    const result = await execute({ root: dir, resolver: customResolver });
    expect(result.status).toBe("success");
    expect(result.findings).toHaveLength(1);
    expect(result.findings[0]!.checkId).toMatch(/^test/);
    expect(result.findings[0]!.severity).toBe("high");
  });

  it("rejects docker executor for auto-discovered checks without images", async () => {
    const dir = await makeTempGitRepoWithPackageJson();
    dirs.push(dir);
    const customResolver: CheckResolver = {
      resolve(check) {
        return {
          checkId: check.checkId,
          operation: {
            id: check.id,
            kind: "check",
            name: check.checkId,
            description: check.reason,
            command: "true",
            args: [],
          },
          outputs: [],
        };
      },
    };
    await expect(execute({ root: dir, executor: "docker", resolver: customResolver })).rejects.toThrow(
      "docker executor requires container images",
    );
  });
});
