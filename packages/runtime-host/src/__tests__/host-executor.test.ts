import { describe, it, expect, beforeEach, afterEach } from "vitest";
import { mkdtemp, mkdir, writeFile, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { HostExecutor } from "../host-executor.js";
import { createAllowlist } from "../allowlist.js";
import { HostExecutorError, CommandNotAllowedError } from "../errors.js";
import { makeHostOp, makeRequest, defaultConfig } from "./helpers/fixtures.js";

let workspace: string;
let artifactDir: string;

beforeEach(async () => {
  workspace = await mkdtemp(join(tmpdir(), "sverka-ws-"));
  artifactDir = await mkdtemp(join(tmpdir(), "sverka-art-"));
});

afterEach(async () => {
  await rm(workspace, { recursive: true, force: true });
  await rm(artifactDir, { recursive: true, force: true });
});

// --- Slice D: canExecute + spawn + output + exit code ---

describe("HostExecutor.canExecute", () => {
  it("returns false for all operations when disabled", () => {
    const exec = new HostExecutor(defaultConfig({ enabled: false }));
    expect(exec.canExecute(makeHostOp())).toBe(false);
  });

  it("returns true for host type with allowed command and valid timeout", () => {
    const exec = new HostExecutor(defaultConfig());
    expect(exec.canExecute(makeHostOp({ command: "node" }))).toBe(true);
  });

  it("returns false for docker type", () => {
    const exec = new HostExecutor(defaultConfig());
    expect(
      exec.canExecute(
        makeHostOp({ executor: { type: "docker", image: "node:24" } }),
      ),
    ).toBe(false);
  });

  it("returns false when command is not in allowlist", () => {
    const exec = new HostExecutor(defaultConfig());
    expect(exec.canExecute(makeHostOp({ command: "rm" }))).toBe(false);
  });

  it("returns false when timeoutSeconds is missing", () => {
    const exec = new HostExecutor(defaultConfig());
    // timeoutSeconds is required in PlanOperation; simulate by setting to 0
    expect(
      exec.canExecute(
        makeHostOp({ command: "node", timeoutSeconds: 0 as unknown as number }),
      ),
    ).toBe(false);
  });

  it("returns false when timeoutSeconds is <= 0", () => {
    const exec = new HostExecutor(defaultConfig());
    expect(
      exec.canExecute(makeHostOp({ command: "node", timeoutSeconds: -1 })),
    ).toBe(false);
  });
});

describe("HostExecutor.execute — spawn and output", () => {
  it("captures stdout and returns success for exit 0", async () => {
    const exec = new HostExecutor(defaultConfig());
    const op = makeHostOp({
      command: "node",
      args: ["-e", "console.log('hello')"],
    });
    const result = await exec.execute(
      makeRequest(op, { workspace, artifactDir }),
    );
    expect(result.status).toBe("success");
    expect(result.exitCode).toBe(0);
    expect(result.logs).toContain("hello");
  });

  it("returns failure for non-zero exit", async () => {
    const exec = new HostExecutor(defaultConfig());
    const op = makeHostOp({
      command: "node",
      args: ["-e", "process.exit(1)"],
    });
    const result = await exec.execute(
      makeRequest(op, { workspace, artifactDir }),
    );
    expect(result.status).toBe("failure");
    expect(result.exitCode).toBe(1);
  });

  it("captures both stdout and stderr in logs", async () => {
    const exec = new HostExecutor(defaultConfig());
    const op = makeHostOp({
      command: "node",
      args: ["-e", "console.log('out'); console.error('err')"],
    });
    const result = await exec.execute(
      makeRequest(op, { workspace, artifactDir }),
    );
    expect(result.logs).toContain("out");
    expect(result.logs).toContain("err");
  });
});

// --- Slice E: Timeout ---

describe("HostExecutor.execute — timeout", () => {
  it("kills the process and returns failure on timeout", async () => {
    const exec = new HostExecutor(defaultConfig());
    const op = makeHostOp({
      command: "node",
      args: ["-e", "setTimeout(()=>{}, 50000)"],
      timeoutSeconds: 0.1,
    });
    const result = await exec.execute(
      makeRequest(op, { workspace, artifactDir }),
    );
    expect(result.status).toBe("failure");
    expect(result.error).toContain("timeout");
  });

  it("raises MISSING_TIMEOUT when timeoutSeconds is 0", async () => {
    const exec = new HostExecutor(defaultConfig());
    const op = makeHostOp({ command: "node", timeoutSeconds: 0 });
    await expect(
      exec.execute(makeRequest(op, { workspace, artifactDir })),
    ).rejects.toThrow(HostExecutorError);
  });
});

// --- Slice F: Environment bounding ---

describe("HostExecutor.execute — environment bounding", () => {
  it("does not forward host env vars not in envAllowlist", async () => {
    process.env.SVERKA_TEST_SECRET = "leaked";
    const exec = new HostExecutor(defaultConfig({ envAllowlist: ["PATH"] }));
    const op = makeHostOp({
      command: "node",
      args: ["-e", "console.log(process.env.SVERKA_TEST_SECRET ?? 'absent')"],
    });
    const result = await exec.execute(
      makeRequest(op, { workspace, artifactDir }),
    );
    expect(result.logs).toContain("absent");
    delete process.env.SVERKA_TEST_SECRET;
  });

  it("forwards envAllowlist entries from host", async () => {
    const exec = new HostExecutor(defaultConfig({ envAllowlist: ["PATH"] }));
    const op = makeHostOp({
      command: "node",
      args: ["-e", "console.log(process.env.PATH ? 'has-path' : 'no-path')"],
    });
    const result = await exec.execute(
      makeRequest(op, { workspace, artifactDir }),
    );
    expect(result.logs).toContain("has-path");
  });

  it("forwards request.env values", async () => {
    const exec = new HostExecutor(defaultConfig());
    const op = makeHostOp({
      command: "node",
      args: ["-e", "console.log(process.env.FOO)"],
    });
    const result = await exec.execute(
      makeRequest(op, { workspace, artifactDir, env: { FOO: "bar" } }),
    );
    expect(result.logs).toContain("bar");
  });

  it("forwards request.credentials values", async () => {
    const exec = new HostExecutor(defaultConfig());
    const op = makeHostOp({
      command: "node",
      args: ["-e", "console.log(process.env.SECRET)"],
    });
    const result = await exec.execute(
      makeRequest(op, { workspace, artifactDir, credentials: { SECRET: "s" } }),
    );
    expect(result.logs).toContain("s");
  });
});

// --- Slice G: Working directory ---

describe("HostExecutor.execute — working directory", () => {
  it("uses request.workspace as cwd by default", async () => {
    const exec = new HostExecutor(defaultConfig());
    const op = makeHostOp({
      command: "node",
      args: ["-e", "console.log(process.cwd())"],
    });
    const result = await exec.execute(
      makeRequest(op, { workspace, artifactDir }),
    );
    expect(result.logs).toContain(workspace);
  });

  it("honors operation.workingDir relative to workspace", async () => {
    await mkdir(join(workspace, "subdir"), { recursive: true });
    const exec = new HostExecutor(defaultConfig());
    const op = makeHostOp({
      command: "node",
      args: ["-e", "console.log(process.cwd())"],
      workingDir: "subdir",
    });
    const result = await exec.execute(
      makeRequest(op, { workspace, artifactDir }),
    );
    expect(result.logs).toContain(join(workspace, "subdir"));
  });

  it("rejects workingDir resolving outside workspace", async () => {
    const exec = new HostExecutor(defaultConfig());
    const op = makeHostOp({
      command: "node",
      args: ["-e", "console.log('hi')"],
      workingDir: "../../etc",
    });
    await expect(
      exec.execute(makeRequest(op, { workspace, artifactDir })),
    ).rejects.toMatchObject({ code: "WORKDIR_OUTSIDE_WORKSPACE" });
  });
});

// --- Slice H: Privilege escalation prevention ---

describe("HostExecutor — privilege escalation prevention", () => {
  it("rejects runAsUid: 0 at construction", () => {
    expect(() => new HostExecutor(defaultConfig({ runAsUid: 0 }))).toThrow(
      HostExecutorError,
    );
  });

  it("rejects sudo in allowlist at construction", () => {
    expect(
      () =>
        new HostExecutor(
          defaultConfig({
            allowlist: createAllowlist(["node", "sudo"]),
          }),
        ),
    ).toThrow(HostExecutorError);
  });

  it("rejects su in allowlist at construction", () => {
    expect(
      () =>
        new HostExecutor(
          defaultConfig({
            allowlist: createAllowlist(["su"]),
          }),
        ),
    ).toThrow(HostExecutorError);
  });
});

// --- Slice I: Artifacts + log truncation ---

describe("HostExecutor.execute — artifacts", () => {
  it("copies declared artifacts into artifactDir", async () => {
    await writeFile(join(workspace, "report.txt"), "test report");
    const exec = new HostExecutor(defaultConfig());
    const op = makeHostOp({
      command: "node",
      args: ["-e", "console.log('done')"],
      artifacts: [{ path: "report.txt", retain: true }],
    });
    const result = await exec.execute(
      makeRequest(op, { workspace, artifactDir }),
    );
    expect(result.artifacts).toHaveLength(1);
    expect(result.artifacts[0]).toContain("report.txt");
  });

  it("reports missing artifacts in error without changing status", async () => {
    const exec = new HostExecutor(defaultConfig());
    const op = makeHostOp({
      command: "node",
      args: ["-e", "console.log('done')"],
      artifacts: [{ path: "nonexistent.txt", retain: true }],
    });
    const result = await exec.execute(
      makeRequest(op, { workspace, artifactDir }),
    );
    expect(result.status).toBe("success");
    expect(result.error).toContain("missing artifact");
  });
});

describe("HostExecutor.execute — log truncation", () => {
  it("truncates logs exceeding maxLogBytes with a notice", async () => {
    const exec = new HostExecutor(defaultConfig({ maxLogBytes: 20 }));
    const op = makeHostOp({
      command: "node",
      args: ["-e", "console.log('A'.repeat(100))"],
    });
    const result = await exec.execute(
      makeRequest(op, { workspace, artifactDir }),
    );
    expect(result.logs.length).toBeLessThanOrEqual(
      20 + "\n[log truncated]".length,
    );
    expect(result.logs).toContain("[log truncated]");
  });
});

// --- Edge cases ---

describe("HostExecutor.execute — edge cases", () => {
  it("raises EXECUTOR_DISABLED when disabled", async () => {
    const exec = new HostExecutor(defaultConfig({ enabled: false }));
    await expect(
      exec.execute(makeRequest(makeHostOp(), { workspace, artifactDir })),
    ).rejects.toMatchObject({ code: "EXECUTOR_DISABLED" });
  });

  it("raises WRONG_EXECUTOR_TYPE for non-host operation", async () => {
    const exec = new HostExecutor(defaultConfig());
    const op = makeHostOp({ executor: { type: "docker", image: "node:24" } });
    await expect(
      exec.execute(makeRequest(op, { workspace, artifactDir })),
    ).rejects.toMatchObject({ code: "WRONG_EXECUTOR_TYPE" });
  });

  it("raises COMMAND_NOT_ALLOWED for disallowed command", async () => {
    const exec = new HostExecutor(defaultConfig());
    const op = makeHostOp({ command: "rm" });
    await expect(
      exec.execute(makeRequest(op, { workspace, artifactDir })),
    ).rejects.toThrow(CommandNotAllowedError);
  });

  it("returns failure for spawn error (binary not found)", async () => {
    const exec = new HostExecutor(
      defaultConfig({
        allowlist: createAllowlist(["nonexistent-binary-xyz"]),
      }),
    );
    const op = makeHostOp({ command: "nonexistent-binary-xyz" });
    const result = await exec.execute(
      makeRequest(op, { workspace, artifactDir }),
    );
    expect(result.status).toBe("failure");
    expect(result.error).toContain("spawn error");
  });

  it("dispose is a no-op", async () => {
    const exec = new HostExecutor(defaultConfig());
    await expect(exec.dispose()).resolves.toBeUndefined();
  });
});
