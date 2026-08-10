import type { PlanOperation } from "@sverka/ir";
import type { ExecuteRequest } from "@sverka/runtime";
import type { DockerExecutorConfig } from "../../config.js";

/**
 * Build a minimal PlanOperation with executor.type: "docker".
 * Override any field via `overrides`.
 */
export function makeDockerOp(
  overrides: Partial<PlanOperation> = {},
): PlanOperation {
  const base: PlanOperation = {
    id: "op-docker-1",
    kind: "run",
    name: "docker-check",
    dependsOn: [],
    executor: {
      type: "docker",
      image: "busybox:latest",
      imageDigest:
        "sha256:abcdef1234567890abcdef1234567890abcdef1234567890abcdef1234567890",
    },
    command: "echo",
    args: ["hello"],
    resources: { cpu: "1", memory: "512Mi" },
    network: "deny",
    credentials: [],
    artifacts: [],
    retry: { maxAttempts: 1, backoffSeconds: 0, retryOn: ["failure"] },
    timeoutSeconds: 30,
    continueOnError: false,
  };
  return { ...base, ...overrides };
}

/**
 * Build an ExecuteRequest with a temp workspace, env, credentials, etc.
 */
export function makeRequest(
  operation: PlanOperation,
  overrides: Partial<ExecuteRequest> = {},
): ExecuteRequest {
  const base: ExecuteRequest = {
    operation,
    workspace: "/tmp/sverka-test-workspace",
    env: {},
    credentials: {},
    cacheDir: "/tmp/sverka-test-cache",
    artifactDir: "/tmp/sverka-test-artifacts",
  };
  return { ...base, ...overrides };
}

/**
 * A default DockerExecutorConfig with a non-root runAs and a cache dir.
 */
export function defaultConfig(
  overrides: Partial<DockerExecutorConfig> = {},
): DockerExecutorConfig {
  const base: DockerExecutorConfig = {
    runAs: "1000:1000",
    cacheDir: "/tmp/sverka-test-cache",
  };
  return { ...base, ...overrides };
}
