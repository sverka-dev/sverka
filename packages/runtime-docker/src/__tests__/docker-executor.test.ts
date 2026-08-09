import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";
import { mkdtemp, mkdir, writeFile, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { DockerExecutor } from "../docker-executor.js";
import { ContainerPolicyError } from "../errors.js";
import {
  makeDockerOp,
  makeRequest,
  defaultConfig,
} from "./helpers/fixtures.js";

// Mock the docker-cli seam so no real Docker daemon is needed.
vi.mock("../internal/docker-cli.js", () => ({
  runDocker: vi.fn(async (): Promise<{
    stdout: string;
    stderr: string;
    exitCode: number;
    timedOut?: boolean;
  }> => ({
    stdout: "hello\n",
    stderr: "",
    exitCode: 0,
  })),
}));

// Import the mocked module so tests can override per-test.
import { runDocker } from "../internal/docker-cli.js";

const mockedRunDocker = vi.mocked(runDocker);

beforeEach(() => {
  mockedRunDocker.mockReset();
  mockedRunDocker.mockResolvedValue({ stdout: "hello\n", stderr: "", exitCode: 0 });
});

// --- Slice D: canExecute ---

describe("DockerExecutor.canExecute", () => {
  it("returns true for docker type", () => {
    const exec = new DockerExecutor(defaultConfig());
    expect(exec.canExecute(makeDockerOp())).toBe(true);
  });

  it("returns false for host type", () => {
    const exec = new DockerExecutor(defaultConfig());
    expect(
      exec.canExecute(makeDockerOp({ executor: { type: "host" } })),
    ).toBe(false);
  });

  it("returns false for podman type", () => {
    const exec = new DockerExecutor(defaultConfig());
    expect(
      exec.canExecute(makeDockerOp({ executor: { type: "podman", image: "node:24" } })),
    ).toBe(false);
  });

  it("returns false for remote type", () => {
    const exec = new DockerExecutor(defaultConfig());
    expect(
      exec.canExecute(
        makeDockerOp({
          executor: {
            type: "remote",
            remote: { provider: "github", endpoint: "https://api.github.com" },
          },
        }),
      ),
    ).toBe(false);
  });
});

// --- Slice D: buildDockerArgs (container policy) ---

describe("DockerExecutor.buildDockerArgs — container policy", () => {
  const exec = new DockerExecutor(defaultConfig());

  it("includes --rm", () => {
    const args = exec.buildDockerArgs(makeRequest(makeDockerOp()));
    expect(args).toContain("--rm");
  });

  it("includes --read-only", () => {
    const args = exec.buildDockerArgs(makeRequest(makeDockerOp()));
    expect(args).toContain("--read-only");
  });

  it("includes --cap-drop ALL", () => {
    const args = exec.buildDockerArgs(makeRequest(makeDockerOp()));
    expect(args).toContain("--cap-drop");
    expect(args[args.indexOf("--cap-drop") + 1]).toBe("ALL");
  });

  it("includes --network none for deny", () => {
    const args = exec.buildDockerArgs(
      makeRequest(makeDockerOp({ network: "deny" })),
    );
    expect(args).toContain("--network");
    expect(args[args.indexOf("--network") + 1]).toBe("none");
  });

  it("includes --user with runAs", () => {
    const args = exec.buildDockerArgs(makeRequest(makeDockerOp()));
    expect(args).toContain("--user");
    expect(args[args.indexOf("--user") + 1]).toBe("1000:1000");
  });

  it("includes --memory from resources", () => {
    const args = exec.buildDockerArgs(
      makeRequest(makeDockerOp({ resources: { cpu: "2", memory: "1Gi" } })),
    );
    expect(args).toContain("--memory");
    expect(args[args.indexOf("--memory") + 1]).toBe("1Gi");
  });

  it("includes --cpus from resources", () => {
    const args = exec.buildDockerArgs(
      makeRequest(makeDockerOp({ resources: { cpu: "0.5", memory: "512Mi" } })),
    );
    expect(args).toContain("--cpus");
    expect(args[args.indexOf("--cpus") + 1]).toBe("0.5");
  });

  it("includes --timeout from timeoutSeconds", () => {
    const args = exec.buildDockerArgs(
      makeRequest(makeDockerOp({ timeoutSeconds: 60 })),
    );
    expect(args).toContain("--timeout");
    expect(args[args.indexOf("--timeout") + 1]).toBe("60");
  });

  it("includes --workdir /workspace", () => {
    const args = exec.buildDockerArgs(makeRequest(makeDockerOp()));
    expect(args).toContain("--workdir");
    expect(args[args.indexOf("--workdir") + 1]).toBe("/workspace");
  });

  it("mounts workspace read-only", () => {
    const args = exec.buildDockerArgs(
      makeRequest(makeDockerOp(), { workspace: "/ws" }),
    );
    const mount = args.find((a) => a.includes("target=/workspace"));
    expect(mount).toBeDefined();
    expect(mount).toContain("source=/ws");
    expect(mount).toContain("readonly");
  });

  it("mounts cacheDir at /cache", () => {
    const args = exec.buildDockerArgs(
      makeRequest(makeDockerOp(), { cacheDir: "/cache" }),
    );
    const mount = args.find((a) => a.includes("target=/cache"));
    expect(mount).toBeDefined();
    expect(mount).toContain("source=/cache");
  });

  it("mounts artifactDir at /artifacts", () => {
    const args = exec.buildDockerArgs(
      makeRequest(makeDockerOp(), { artifactDir: "/art" }),
    );
    const mount = args.find((a) => a.includes("target=/artifacts"));
    expect(mount).toBeDefined();
    expect(mount).toContain("source=/art");
  });

  it("never mounts the Docker socket", () => {
    const args = exec.buildDockerArgs(makeRequest(makeDockerOp()));
    expect(args.some((a) => a.includes("docker.sock"))).toBe(false);
  });

  it("throws ContainerPolicyError when a mount source references docker.sock", () => {
    expect(() =>
      exec.buildDockerArgs(
        makeRequest(makeDockerOp(), { workspace: "/var/run/docker.sock" }),
      ),
    ).toThrow(ContainerPolicyError);
  });

  it("uses image@digest as the image", () => {
    const op = makeDockerOp({
      executor: {
        type: "docker",
        image: "busybox:latest",
        imageDigest: "sha256:abc",
      },
    });
    const args = exec.buildDockerArgs(makeRequest(op));
    expect(args).toContain("busybox:latest@sha256:abc");
  });

  it("appends command and args", () => {
    const op = makeDockerOp({ command: "echo", args: ["hi", "there"] });
    const args = exec.buildDockerArgs(makeRequest(op));
    const imgIdx = args.indexOf("busybox:latest@sha256:abcdef1234567890abcdef1234567890abcdef1234567890abcdef1234567890");
    expect(args[imgIdx + 1]).toBe("echo");
    expect(args[imgIdx + 2]).toBe("hi");
    expect(args[imgIdx + 3]).toBe("there");
  });
});

// --- Slice E: Network policy mapping ---

describe("DockerExecutor.buildDockerArgs — network policy", () => {
  const exec = new DockerExecutor(defaultConfig());

  it("maps deny to --network none", () => {
    const args = exec.buildDockerArgs(
      makeRequest(makeDockerOp({ network: "deny" })),
    );
    expect(args).toContain("--network");
    expect(args[args.indexOf("--network") + 1]).toBe("none");
  });

  it("maps allow-egress to default bridge (no --network none)", () => {
    const args = exec.buildDockerArgs(
      makeRequest(makeDockerOp({ network: "allow-egress" })),
    );
    expect(args).not.toContain("--network");
  });

  it("maps allow-host to --network host", () => {
    const args = exec.buildDockerArgs(
      makeRequest(makeDockerOp({ network: "allow-host" })),
    );
    expect(args).toContain("--network");
    expect(args[args.indexOf("--network") + 1]).toBe("host");
  });
});

// --- Slice F: Timeout enforcement ---

describe("DockerExecutor.execute — timeout enforcement", () => {
  it("raises MISSING_TIMEOUT when timeoutSeconds is 0", async () => {
    const exec = new DockerExecutor(defaultConfig());
    const op = makeDockerOp({ timeoutSeconds: 0 });
    await expect(exec.execute(makeRequest(op))).rejects.toMatchObject({
      code: "CONTAINER_POLICY_VIOLATION",
      name: "ContainerPolicyError",
    });
    expect(mockedRunDocker).not.toHaveBeenCalled();
  });

  it("raises MISSING_TIMEOUT when timeoutSeconds is negative", async () => {
    const exec = new DockerExecutor(defaultConfig());
    const op = makeDockerOp({ timeoutSeconds: -1 });
    await expect(exec.execute(makeRequest(op))).rejects.toMatchObject({
      code: "CONTAINER_POLICY_VIOLATION",
    });
    expect(mockedRunDocker).not.toHaveBeenCalled();
  });

  it("returns failure with timeout error when container times out", async () => {
    mockedRunDocker.mockResolvedValue({
      stdout: "",
      stderr: "",
      exitCode: 137,
      timedOut: true,
    });
    const exec = new DockerExecutor(defaultConfig());
    const op = makeDockerOp({ timeoutSeconds: 1 });
    const result = await exec.execute(makeRequest(op));
    expect(result.status).toBe("failure");
    expect(result.error).toContain("timeout");
    expect(result.exitCode).toBe(137);
  });
});

// --- Slice G: Image digest presence ---

describe("DockerExecutor.execute — image digest", () => {
  it("raises MISSING_DIGEST when imageDigest is absent", async () => {
    const exec = new DockerExecutor(defaultConfig());
    const op = makeDockerOp({
      executor: { type: "docker", image: "busybox:latest" },
    });
    await expect(exec.execute(makeRequest(op))).rejects.toMatchObject({
      code: "CONTAINER_POLICY_VIOLATION",
      name: "ContainerPolicyError",
    });
    expect(mockedRunDocker).not.toHaveBeenCalled();
  });
});

// --- Slice H: Secrets allowlist + env building ---

describe("DockerExecutor.buildEnv — secrets allowlist", () => {
  const exec = new DockerExecutor(defaultConfig());

  it("passes only declared credentials from request.credentials", () => {
    const op = makeDockerOp({
      credentials: [
        { name: "api-key", envVar: "API_KEY", required: true },
      ],
    });
    const env = exec.buildEnv(
      makeRequest(op, {
        credentials: { API_KEY: "secret-value", OTHER: "leaked" },
      }),
    );
    expect(env.API_KEY).toBe("secret-value");
    expect(env.OTHER).toBeUndefined();
  });

  it("includes request.env vars", () => {
    const env = exec.buildEnv(
      makeRequest(makeDockerOp(), { env: { FOO: "bar" } }),
    );
    expect(env.FOO).toBe("bar");
  });

  it("raises UNDECLARED_SECRET for secret-like request.env not in credentials", () => {
    const exec2 = new DockerExecutor(defaultConfig());
    let caught: unknown;
    try {
      exec2.buildEnv(makeRequest(makeDockerOp(), { env: { MY_SECRET: "s" } }));
    } catch (e) {
      caught = e;
    }
    expect(caught).toBeInstanceOf(ContainerPolicyError);
    expect((caught as ContainerPolicyError).code).toBe("CONTAINER_POLICY_VIOLATION");
    expect((caught as ContainerPolicyError).message).toContain("MY_SECRET");
  });

  it("allows secret-like env var when declared in credentials", () => {
    const op = makeDockerOp({
      credentials: [
        { name: "token", envVar: "API_TOKEN", required: true },
      ],
    });
    const env = exec.buildEnv(
      makeRequest(op, {
        credentials: { API_TOKEN: "tok" },
        env: { API_TOKEN: "tok" },
      }),
    );
    expect(env.API_TOKEN).toBe("tok");
  });

  it("raises DOCKER_SOCKET_DENIED when env value references docker.sock", () => {
    expect(() =>
      exec.buildEnv(
        makeRequest(makeDockerOp(), { env: { PATH: "/var/run/docker.sock" } }),
      ),
    ).toThrow(ContainerPolicyError);
  });
});

// --- Slice J: Logs + exit codes ---

describe("DockerExecutor.execute — logs and exit codes", () => {
  it("captures stdout and stderr into logs", async () => {
    mockedRunDocker.mockResolvedValue({
      stdout: "out-line\n",
      stderr: "err-line\n",
      exitCode: 0,
    });
    const exec = new DockerExecutor(defaultConfig());
    const result = await exec.execute(makeRequest(makeDockerOp()));
    expect(result.logs).toContain("out-line");
    expect(result.logs).toContain("err-line");
    expect(result.status).toBe("success");
    expect(result.exitCode).toBe(0);
  });

  it("returns failure for non-zero exit", async () => {
    mockedRunDocker.mockResolvedValue({
      stdout: "",
      stderr: "boom",
      exitCode: 1,
    });
    const exec = new DockerExecutor(defaultConfig());
    const result = await exec.execute(makeRequest(makeDockerOp()));
    expect(result.status).toBe("failure");
    expect(result.exitCode).toBe(1);
    expect(result.error).toContain("exit code 1");
  });

  it("truncates logs exceeding maxLogBytes with a notice", async () => {
    mockedRunDocker.mockResolvedValue({
      stdout: "A".repeat(100),
      stderr: "",
      exitCode: 0,
    });
    const exec = new DockerExecutor(defaultConfig({ maxLogBytes: 20 }));
    const result = await exec.execute(makeRequest(makeDockerOp()));
    expect(result.logs.length).toBeLessThanOrEqual(
      20 + "\n[log truncated]".length,
    );
    expect(result.logs).toContain("[log truncated]");
  });
});

// --- Slice J2: Artifact collection ---

describe("DockerExecutor.execute — artifacts", () => {
  let workspace: string;
  let artifactDir: string;

  beforeEach(async () => {
    workspace = await mkdtemp(join(tmpdir(), "sverka-docker-ws-"));
    artifactDir = await mkdtemp(join(tmpdir(), "sverka-docker-art-"));
  });

  afterEach(async () => {
    await rm(workspace, { recursive: true, force: true });
    await rm(artifactDir, { recursive: true, force: true });
  });

  it("copies declared artifacts into artifactDir", async () => {
    await mkdir(join(workspace, "out"), { recursive: true });
    await writeFile(join(workspace, "out", "report.txt"), "test report");
    const exec = new DockerExecutor(defaultConfig());
    const op = makeDockerOp({
      artifacts: [{ path: "out/report.txt", name: "report.txt", retain: true }],
    });
    const result = await exec.execute(
      makeRequest(op, { workspace, artifactDir }),
    );
    expect(result.status).toBe("success");
    expect(result.artifacts).toHaveLength(1);
    expect(result.artifacts[0]).toContain("report.txt");
  });

  it("reports missing artifacts in error without changing status", async () => {
    const exec = new DockerExecutor(defaultConfig());
    const op = makeDockerOp({
      artifacts: [{ path: "nonexistent.txt", retain: true }],
    });
    const result = await exec.execute(
      makeRequest(op, { workspace, artifactDir }),
    );
    expect(result.status).toBe("success");
    expect(result.error).toContain("missing artifact");
    expect(result.artifacts).toHaveLength(0);
  });
});

// --- Edge cases ---

describe("DockerExecutor.execute — edge cases", () => {
  it("raises WRONG_EXECUTOR_TYPE for non-docker operation", async () => {
    const exec = new DockerExecutor(defaultConfig());
    const op = makeDockerOp({ executor: { type: "host" } });
    await expect(exec.execute(makeRequest(op))).rejects.toMatchObject({
      code: "CONTAINER_POLICY_VIOLATION",
    });
    expect(mockedRunDocker).not.toHaveBeenCalled();
  });

  it("dispose is a no-op", async () => {
    const exec = new DockerExecutor(defaultConfig());
    await expect(exec.dispose()).resolves.toBeUndefined();
  });
});
