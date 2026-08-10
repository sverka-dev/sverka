import { describe, it, expect } from "vitest";
import { main } from "../index.js";
import { CaptureWriter } from "./helpers/fixtures.js";

describe("doctor command", () => {
  it("reports environment status (Node, Bun, git)", async () => {
    const out = new CaptureWriter();
    const code = await main(["doctor"], { output: out });
    // In the test environment all three should be present.
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
    const parsed = JSON.parse(out.stdoutText.trim());
    expect(parsed.command).toBe("doctor");
    expect(Array.isArray(parsed.data.checks)).toBe(true);
    expect(parsed.data.checks.length).toBe(3);
    expect(parsed.data.allOk).toBe(true);
  });

  it("extracts a numeric version for each tool (not the raw --version line)", async () => {
    const out = new CaptureWriter();
    await main(["doctor", "--format", "json"], { output: out });
    const parsed = JSON.parse(out.stdoutText.trim());
    for (const check of parsed.data.checks) {
      expect(check.status).toBe("ok");
      // Version should be a numeric x.y.z, not e.g. "git version 2.43.0".
      expect(check.version).toMatch(/^\d+\.\d+\.\d+/);
    }
  });
});
