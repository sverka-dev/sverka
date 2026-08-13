import { describe, it, expect } from "vitest";
import { createDockerDriver, buildDockerArgs } from "../index.js";
import type { StepDefinition } from "@sverka/core";

function makeStep(mode?: "host" | "container", image?: string): StepDefinition {
  const runtime: { mode?: "host" | "container"; image?: string } = {};
  if (mode !== undefined) runtime.mode = mode;
  if (image !== undefined) runtime.image = image;
  return {
    id: "ci/test",
    runtime,
    operations: [{ kind: "shell", command: "echo hello" }],
    inputs: [],
    outputs: [],
    dependencies: [],
  };
}

describe("createDockerDriver", () => {
  it("returns a RuntimeDriver", () => {
    const driver = createDockerDriver({});
    expect(driver.name).toBe("docker");
    expect(typeof driver.canExecute).toBe("function");
    expect(typeof driver.executeShell).toBe("function");
  });
});

describe("DockerDriver.canExecute", () => {
  const driver = createDockerDriver({});

  it("returns true for container-mode steps with image", () => {
    expect(driver.canExecute(makeStep("container", "node:22"))).toBe(true);
  });

  it("returns false for host-mode steps", () => {
    expect(driver.canExecute(makeStep("host", "node:22"))).toBe(false);
  });

  it("returns false when no image set", () => {
    expect(driver.canExecute(makeStep("container"))).toBe(false);
  });

  it("returns false when mode is undefined", () => {
    expect(driver.canExecute(makeStep(undefined, "node:22"))).toBe(false);
  });
});

describe("buildDockerArgs", () => {
  it("includes read-only, cap-drop, non-root, no-network", () => {
    const args = buildDockerArgs(
      { command: "echo hi", workspace: "/ws", env: {} },
      "1000:1000",
      "none",
      "node:22",
    );
    expect(args).toContain("--read-only");
    expect(args).toContain("--cap-drop=ALL");
    expect(args).toContain("--user=1000:1000");
    expect(args).toContain("--network=none");
  });

  it("mounts workspace at /workspace", () => {
    const args = buildDockerArgs(
      { command: "echo hi", workspace: "/my/ws", env: {} },
      "1000:1000",
      "none",
      "node:22",
    );
    const wsIdx = args.indexOf("-v");
    expect(wsIdx).toBeGreaterThanOrEqual(0);
    expect(args[wsIdx + 1]).toBe("/my/ws:/workspace");
    expect(args).toContain("-w");
    expect(args[args.indexOf("-w") + 1]).toBe("/workspace");
  });

  it("forwards env vars", () => {
    const args = buildDockerArgs(
      { command: "echo hi", workspace: "/ws", env: { FOO: "bar", BAZ: "qux" } },
      "1000:1000",
      "none",
      "node:22",
    );
    expect(args).toContain("--env");
    expect(args.some((a) => a === "FOO=bar")).toBe(true);
    expect(args.some((a) => a === "BAZ=qux")).toBe(true);
  });

  it("Docker socket is never mounted (no docker.sock in mounts)", () => {
    const args = buildDockerArgs(
      { command: "echo hi", workspace: "/ws", env: {} },
      "1000:1000",
      "none",
      "node:22",
    );
    const mountArgs = args.filter((a) => a.includes("docker.sock"));
    expect(mountArgs).toHaveLength(0);
  });

  it("includes image and command", () => {
    const args = buildDockerArgs(
      { command: "echo hi", workspace: "/ws", env: {} },
      "1000:1000",
      "none",
      "node:22",
    );
    expect(args).toContain("node:22");
    expect(args).toContain("sh");
    expect(args).toContain("-c");
    expect(args).toContain("echo hi");
  });
});
