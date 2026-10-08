import { describe, it, expect, vi } from "vitest";
import { mkdtempSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";

// Mock the git seam — this test asserts how credentials are transported
// (env vs argv), not git behavior. The real module is spread so helpers
// like redactUrl keep working inside registry.ts error paths.
vi.mock("../src/internal/git.js", async (importOriginal) => {
  const real = await importOriginal<typeof import("../src/internal/git.js")>();
  return {
    ...real,
    git: vi.fn(async () => ({ code: 0, stdout: "", stderr: "" })),
    gitOrThrow: vi.fn(async () => ({ code: 0, stdout: "", stderr: "" })),
  };
});

import { ArenaError } from "../src/config.js";
import { git, gitOrThrow } from "../src/internal/git.js";
import { createGitRegistry, resolveRegistryDir } from "../src/registry.js";
import type { ArenaResultV1 } from "../src/registry.js";

const gitMock = vi.mocked(git);
const gitOrThrowMock = vi.mocked(gitOrThrow);
const okResult = { code: 0, stdout: "", stderr: "" };

function freshCheckout(): string {
  return join(mkdtempSync(join(tmpdir(), "arena-auth-")), "checkout");
}

function v1Doc(): ArenaResultV1 {
  return {
    schema: "arena.result/v1",
    runId: `run-${Math.random().toString(36).slice(2, 10)}`,
    pack: "node-ci",
    agent: "devin",
    model: "claude-sonnet-4-5",
    plugins: [],
    sverkaVersion: "0.9.0",
    startedAt: "2026-10-01T02:00:00.000Z",
    tasks: [
      {
        task: "lint-fix",
        promptHash: "a".repeat(64),
        score: { passed: true, findings: 0 },
        metrics: { durationMs: 5000 },
      },
    ],
  };
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

  it("REGISTRY_UNAVAILABLE redacts a token embedded in the remote URL", async () => {
    gitOrThrowMock.mockRejectedValueOnce(new Error("clone died"));
    const err = await resolveRegistryDir(
      "https://user:SECRET-TOKEN@example.com/reg.git",
      { dir: freshCheckout() },
    ).then(
      () => {
        throw new Error("expected resolveRegistryDir to reject");
      },
      (e: unknown) => e as ArenaError,
    );
    expect(err.code).toBe("REGISTRY_UNAVAILABLE");
    expect(err.message).not.toContain("SECRET-TOKEN");
    expect(err.message).toContain("https://<redacted>@example.com/reg.git");
  });

  it("PUBLISH_CONFLICT redacts a token embedded in the remote URL", async () => {
    // Drive the whole finalize path through the mocked seam: staged diff
    // → commit ok → push rejected → rebase fails → push rejected again.
    gitMock.mockImplementation(async (args) =>
      args.includes("push") ||
      args.includes("pull") ||
      (args.includes("diff") && args.includes("--cached"))
        ? { code: 1, stdout: "", stderr: "rejected" }
        : okResult,
    );
    try {
      const reg = createGitRegistry({
        url: "https://user:SECRET-TOKEN@example.com/reg.git",
        dir: freshCheckout(),
      });
      const err = await reg.publish(v1Doc()).then(
        () => {
          throw new Error("expected publish to reject");
        },
        (e: unknown) => e as ArenaError,
      );
      expect(err.code).toBe("PUBLISH_CONFLICT");
      expect(err.message).not.toContain("SECRET-TOKEN");
      expect(err.message).toContain("https://<redacted>@example.com/reg.git");
    } finally {
      gitMock.mockImplementation(async () => okResult);
    }
  });
});
