import { describe, it, expect, vi, beforeEach } from "vitest";
import { main } from "../index.js";
import { CaptureWriter } from "./helpers/fixtures.js";

vi.mock("node:child_process", async (importOriginal) => {
  const actual = await importOriginal<typeof import("node:child_process")>();
  return {
    ...actual,
    spawnSync: vi.fn(),
  };
});

import { spawnSync } from "node:child_process";

const mockedSpawnSync = vi.mocked(spawnSync);

function mockVersion(stdout: string, status = 0) {
  return {
    status,
    error: status === 0 ? undefined : new Error("not found"),
    stdout,
    stderr: "",
  } as unknown as ReturnType<typeof spawnSync>;
}

beforeEach(() => {
  mockedSpawnSync.mockReset();
  // Defaults are overwritten per test as needed.
  mockedSpawnSync
    .mockReturnValueOnce(mockVersion("v20.0.0"))
    .mockReturnValueOnce(mockVersion("1.3.14"))
    .mockReturnValueOnce(mockVersion("git version 2.43.0"));
});

describe("doctor command", () => {
  it("reports environment status (Node, Bun, git)", async () => {
    const out = new CaptureWriter();
    const code = await main(["doctor"], { output: out });
    expect(code).toBe(0);
    expect(out.stdoutText).toContain("node:");
    expect(out.stdoutText).toContain("bun:");
    expect(out.stdoutText).toContain("git:");
  });

  it("exit code 0 when all checks pass", async () => {
    const out = new CaptureWriter();
    const code = await main(["doctor"], { output: out });
    expect(code).toBe(0);
    expect(out.stdoutText).toContain("All checks passed");
  });

  it("--format json produces JSON output", async () => {
    const out = new CaptureWriter();
    const code = await main(["doctor", "--format", "json"], { output: out });
    expect(code).toBe(0);
    const parsed = JSON.parse(out.stdoutText.trim()) as {
      command: string;
      data: { checks: unknown[]; allOk: boolean };
    };
    expect(parsed.command).toBe("doctor");
    expect(Array.isArray(parsed.data.checks)).toBe(true);
    expect(parsed.data.checks.length).toBe(3);
    expect(parsed.data.allOk).toBe(true);
  });

  it("extracts a numeric version for each tool (not the raw --version line)", async () => {
    const out = new CaptureWriter();
    await main(["doctor", "--format", "json"], { output: out });
    const parsed = JSON.parse(out.stdoutText.trim()) as {
      data: { checks: { status: string; version: string }[] };
    };
    for (const check of parsed.data.checks) {
      expect(check.status).toBe("ok");
      // Version should be a numeric x.y.z, not e.g. "git version 2.43.0".
      expect(check.version).toMatch(/^\d+\.\d+\.\d+/);
    }
  });

  it("succeeds when Bun is missing because it is optional", async () => {
    mockedSpawnSync.mockReset();
    mockedSpawnSync
      .mockReturnValueOnce(mockVersion("v20.0.0"))
      .mockReturnValueOnce({
        status: -2,
        error: { code: "ENOENT" },
        stdout: "",
        stderr: "",
      } as unknown as ReturnType<typeof spawnSync>)
      .mockReturnValueOnce(mockVersion("git version 2.43.0"));

    const out = new CaptureWriter();
    const code = await main(["doctor", "--format", "json"], { output: out });
    expect(code).toBe(0);
    const parsed = JSON.parse(out.stdoutText.trim()) as {
      data: { checks: { name: string; status: string }[]; allOk: boolean };
    };
    const bun = parsed.data.checks.find((c) => c.name === "bun");
    expect(bun?.status).toBe("missing");
    expect(parsed.data.allOk).toBe(true);
  });
});
