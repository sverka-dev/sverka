import { describe, it, expect } from "vitest";
import { mkdtempSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";

import { git, gitOrThrow } from "../src/internal/git.js";

describe("internal git seam", () => {
  it("git rejects on spawn failure — ENOENT is not exit code 0", async () => {
    // PATH without git: execFile reports error.code as the string
    // "ENOENT" — a spawn failure must reject, not resolve as success.
    await expect(
      git(["--version"], { env: { PATH: "/definitely-no-git-here" } }),
    ).rejects.toThrow();
  });

  it("git resolves with the exit code on failure (never rejects)", async () => {
    const res = await git(["rev-parse", "--git-dir"], {
      cwd: mkdtempSync(join(tmpdir(), "arena-git-")),
    });
    expect(res.code).not.toBe(0);
  });

  it("gitOrThrow redacts credential args in the error message", async () => {
    const err = await gitOrThrow([
      "-c",
      "http.extraHeader=AUTHORIZATION: bearer SECRET-XYZ",
      "clone",
      "/definitely/missing-repo",
      join(mkdtempSync(join(tmpdir(), "arena-git-")), "dest"),
    ]).then(
      () => {
        throw new Error("expected gitOrThrow to reject");
      },
      (e: unknown) => e as Error,
    );
    expect(err.message).toContain("failed");
    expect(err.message).not.toContain("SECRET-XYZ");
    expect(err.message).toContain("<redacted>");
  });
});
