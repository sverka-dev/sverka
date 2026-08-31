// Tests for network allowlist in the docker driver.
// Spec 26 — items 4, 5, 6.

import { describe, it, expect } from "vitest";
import { buildDockerArgs } from "../docker-driver.js";
import type { ShellExecuteRequest } from "../../engine-native/index.js";

function baseRequest(): ShellExecuteRequest {
  return {
    command: "echo hello",
    workspace: "/workspace",
    env: {},
  };
}

describe("Docker driver network allowlist (Spec 26 items 4-6)", () => {
  it("item 4: network.allowed non-empty → --label sverka.network.allowlist=<domains>", () => {
    const args = buildDockerArgs(
      baseRequest(),
      "1000:1000",
      "bridge",
      "node:24",
      "/workspace",
      {},
      { allowed: ["registry.npmjs.org"] },
    );
    expect(args).toContain("--label=sverka.network.allowlist=registry.npmjs.org");
    // Should use the configured network (not --network=none) since allowed is non-empty.
    expect(args).toContain("--network=bridge");
  });

  it("item 4: multiple domains joined with comma", () => {
    const args = buildDockerArgs(
      baseRequest(),
      "1000:1000",
      "bridge",
      "node:24",
      "/workspace",
      {},
      { allowed: ["registry.npmjs.org", "github.com"] },
    );
    expect(args).toContain("--label=sverka.network.allowlist=registry.npmjs.org,github.com");
  });

  it("item 5: no network field → --network=none (default deny)", () => {
    const args = buildDockerArgs(
      baseRequest(),
      "1000:1000",
      "bridge",
      "node:24",
      "/workspace",
      {},
      undefined,
    );
    expect(args).toContain("--network=none");
    expect(args.some((a) => a.startsWith("--label=sverka.network.allowlist"))).toBe(false);
  });

  it("item 6: network.allowed: [] → --network=none", () => {
    const args = buildDockerArgs(
      baseRequest(),
      "1000:1000",
      "bridge",
      "node:24",
      "/workspace",
      {},
      { allowed: [] },
    );
    expect(args).toContain("--network=none");
    expect(args.some((a) => a.startsWith("--label=sverka.network.allowlist"))).toBe(false);
  });
});
