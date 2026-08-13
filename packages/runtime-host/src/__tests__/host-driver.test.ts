import { describe, it, expect, beforeEach, afterEach } from "vitest";
import { mkdtemp, rm, writeFile, readFile, mkdir } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { createHostDriver, createAllowlist } from "../index.js";
import type { StepDefinition } from "@sverka/core";

function makeStep(command: string, mode?: "host" | "container"): StepDefinition {
  return {
    id: "ci/test",
    runtime: mode ? { mode } : {},
    operations: [{ kind: "shell", command }],
    inputs: [],
    outputs: [],
    dependencies: [],
  };
}

describe("createHostDriver", () => {
  it("returns a RuntimeDriver", () => {
    const driver = createHostDriver({
      enabled: true,
      allowlist: createAllowlist(["echo"]),
      envAllowlist: [],
    });
    expect(driver.name).toBe("host");
    expect(typeof driver.canExecute).toBe("function");
    expect(typeof driver.executeShell).toBe("function");
  });
});

describe("HostDriver.canExecute", () => {
  const driver = createHostDriver({
    enabled: true,
    allowlist: createAllowlist(["echo", "cat"]),
    envAllowlist: [],
  });

  it("returns true for host-mode steps with allowed commands", () => {
    expect(driver.canExecute(makeStep("echo hello"))).toBe(true);
  });

  it("returns false when disabled", () => {
    const disabled = createHostDriver({
      enabled: false,
      allowlist: createAllowlist(["echo"]),
      envAllowlist: [],
    });
    expect(disabled.canExecute(makeStep("echo hello"))).toBe(false);
  });

  it("returns false for container-mode steps", () => {
    expect(driver.canExecute(makeStep("echo hello", "container"))).toBe(false);
  });

  it("returns false for non-allowed commands", () => {
    expect(driver.canExecute(makeStep("rm -rf /"))).toBe(false);
  });
});

describe("HostDriver.executeShell", () => {
  let testDir: string;
  const driver = createHostDriver({
    enabled: true,
    allowlist: createAllowlist(["echo", "cat", "sh"]),
    envAllowlist: ["HOME"],
    env: { CUSTOM: "value" },
  });

  beforeEach(async () => {
    testDir = await mkdtemp(join(tmpdir(), "sverka-host-"));
  });

  afterEach(async () => {
    await rm(testDir, { recursive: true, force: true });
  });

  it("runs a simple command and returns exitCode 0", async () => {
    const result = await driver.executeShell({
      command: "echo hello",
      workspace: testDir,
      env: {},
    });
    expect(result.exitCode).toBe(0);
    expect(result.stdout.trim()).toBe("hello");
  });

  it("timeout → timedOut true, non-zero exit", async () => {
    const result = await driver.executeShell({
      command: "sh -c 'sleep 10'",
      workspace: testDir,
      env: {},
      timeoutMs: 100,
    });
    expect(result.timedOut).toBe(true);
    expect(result.exitCode).not.toBe(0);
  }, 10000);

  it("non-allowed command → throws CommandNotAllowedError", async () => {
    const strict = createHostDriver({
      enabled: true,
      allowlist: createAllowlist(["echo"]),
      envAllowlist: [],
    });
    await expect(
      strict.executeShell({
        command: "rm -rf /",
        workspace: testDir,
        env: {},
      }),
    ).rejects.toThrow();
  });

  it("env vars forwarded per allowlist + config + request", async () => {
    const outputDir = join(testDir, "outputs");
    await mkdir(outputDir, { recursive: true });
    const result = await driver.executeShell({
      command: "sh -c 'echo $CUSTOM > $SVERKA_OUTPUT_DIR/env.txt'",
      workspace: testDir,
      env: { SVERKA_OUTPUT_DIR: outputDir },
    });
    expect(result.exitCode).toBe(0);
    const content = await readFile(join(outputDir, "env.txt"), "utf-8");
    expect(content.trim()).toBe("value");
  });
});

describe("createAllowlist", () => {
  it("matches by basename", () => {
    const list = createAllowlist(["echo"]);
    expect(list.isAllowed("echo")).toBe(true);
    expect(list.isAllowed("rm")).toBe(false);
  });

  it("matches by absolute path", () => {
    const list = createAllowlist(["/usr/bin/echo"]);
    expect(list.isAllowed("/usr/bin/echo")).toBe(true);
    expect(list.isAllowed("echo")).toBe(false); // absolute entries require exact path
  });

  it("empty list → nothing allowed", () => {
    const list = createAllowlist([]);
    expect(list.isAllowed("echo")).toBe(false);
  });
});
