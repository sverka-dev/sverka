import { describe, it, expect } from "vitest";
import { DockerExecutor } from "../docker-executor.js";
import { defaultConfig, makeDockerOp, makeRequest } from "./helpers/fixtures.js";

// Integration tests require a real Docker daemon. Skipped by default.
// Run with: SVERKA_DOCKER=1 bun run test
describe.skipIf(!process.env.SVERKA_DOCKER)("DockerExecutor integration", () => {
  it("runs echo hello in busybox and returns success", async () => {
    const exec = new DockerExecutor(defaultConfig());
    const op = makeDockerOp({
      executor: {
        type: "docker",
        image: "busybox:latest",
        // Replace with a real digest when running integration tests.
        imageDigest: process.env.SVERKA_BUSYBOX_DIGEST ?? "sha256:dummy",
      },
      command: "echo",
      args: ["hello"],
      timeoutSeconds: 30,
    });
    const result = await exec.execute(makeRequest(op));
    expect(result.status).toBe("success");
    expect(result.logs).toContain("hello");
  });

  it("returns failure for a command that exits 1", async () => {
    const exec = new DockerExecutor(defaultConfig());
    const op = makeDockerOp({
      executor: {
        type: "docker",
        image: "busybox:latest",
        imageDigest: process.env.SVERKA_BUSYBOX_DIGEST ?? "sha256:dummy",
      },
      command: "sh",
      args: ["-c", "exit 1"],
      timeoutSeconds: 30,
    });
    const result = await exec.execute(makeRequest(op));
    expect(result.status).toBe("failure");
    expect(result.exitCode).toBe(1);
  });
});
