import { describe, it, expect, vi } from "vitest";
import { mkdtempSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";

// Mock the git seam — this test asserts how credentials are transported
// (env vs argv), not git behavior.
vi.mock("../src/internal/git.js", () => ({
  git: vi.fn(async () => ({ code: 0, stdout: "", stderr: "" })),
  gitOrThrow: vi.fn(async () => ({ code: 0, stdout: "", stderr: "" })),
}));

import { gitOrThrow } from "../src/internal/git.js";
import { resolveRegistryDir } from "../src/registry.js";

const gitOrThrowMock = vi.mocked(gitOrThrow);

function freshCheckout(): string {
  return join(mkdtempSync(join(tmpdir(), "arena-auth-")), "checkout");
}

describe("git registry auth transport", () => {
  it("injects the bearer token via GIT_CONFIG_* env, never argv (CWE-214)", async () => {
    await resolveRegistryDir("https://example.com/reg.git", {
      token: "SECRET-TOKEN",
      dir: freshCheckout(),
    });
    const clone = gitOrThrowMock.mock.calls.at(-1);
    expect(clone).toBeDefined();
    expect(JSON.stringify(clone![0])).not.toContain("SECRET-TOKEN");
    const env = clone![1]?.env;
    expect(env?.GIT_CONFIG_COUNT).toBe("1");
    expect(env?.GIT_CONFIG_KEY_0).toBe("http.extraHeader");
    expect(env?.GIT_CONFIG_VALUE_0).toBe("AUTHORIZATION: bearer SECRET-TOKEN");
  });

  it("injects no auth env for non-https remotes", async () => {
    await resolveRegistryDir("git@example.com:reg.git", {
      token: "SECRET-TOKEN",
      dir: freshCheckout(),
    });
    const clone = gitOrThrowMock.mock.calls.at(-1);
    const env = clone![1]?.env;
    expect(env === undefined || Object.keys(env).length === 0).toBe(true);
  });
});
