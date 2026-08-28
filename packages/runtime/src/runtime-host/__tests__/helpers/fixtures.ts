import type { PlanOperation } from "@sverka/workflow";
import type { ExecuteRequest } from "../../../index.js";
import { createAllowlist } from "../../allowlist.js";
import type { HostExecutorConfig } from "../../config.js";

/**
 * Build a minimal PlanOperation with executor.type: "host".
 * Override any field via `overrides`.
 */
export function makeHostOp(
  overrides: Partial<PlanOperation> = {},
): PlanOperation {
  const base: PlanOperation = {
    id: "op-host-1",
    kind: "run",
    name: "host-check",
    dependsOn: [],
    executor: { type: "host" },
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
 * A default config with the host executor enabled and a permissive allowlist.
 */
export function defaultConfig(
  overrides: Partial<HostExecutorConfig> = {},
): HostExecutorConfig {
  const base: HostExecutorConfig = {
    enabled: true,
    allowlist: createAllowlist(["node", "echo", "sh", "cat", "ls"]),
    envAllowlist: ["PATH"],
  };
  return { ...base, ...overrides };
}
