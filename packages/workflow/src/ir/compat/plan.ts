import type { OperationKind } from "../../core/index.js";

/**
 * The canonical Plan. A validated, serializable DAG.
 */
export interface Plan {
  readonly apiVersion: "sverka.dev/v1";
  readonly id: string; // deterministic plan id
  readonly name: string;
  readonly sourceContextHash: string; // hash of source files + config
  readonly operations: readonly PlanOperation[];
  readonly metadata: PlanMetadata;
  readonly createdAt: string; // ISO 8601, informational only
}

export interface PlanOperation {
  readonly id: string; // deterministic, stable across runs
  readonly kind: OperationKind;
  readonly name: string;
  readonly description?: string;
  readonly command?: string;
  readonly args?: readonly string[];
  readonly env?: Readonly<Record<string, string>>;
  readonly workingDir?: string;

  // Dependency graph
  readonly dependsOn: readonly string[]; // ids of prerequisite operations

  // Execution target
  readonly executor: ExecutorSpec;

  // Resource limits
  readonly resources: ResourceLimits;

  // Network policy
  readonly network: NetworkPolicy;

  // Credentials
  readonly credentials: readonly CredentialDeclaration[];

  // Cache
  readonly cache?: CacheDeclaration;

  // Artifacts
  readonly artifacts: readonly ArtifactDeclaration[];

  // Reliability
  readonly retry: RetryPolicy;
  readonly timeoutSeconds: number; // mandatory, must be > 0

  // Control flow
  readonly condition?: string;
  readonly continueOnError: boolean;

  // Compiler metadata (target-specific, ignored by runtime)
  readonly compiler?: Readonly<Record<string, unknown>>;
}

export interface ExecutorSpec {
  readonly type: "docker" | "podman" | "host" | "remote";
  readonly image?: string;
  readonly imageDigest?: string; // sha256 digest, required for container types
  readonly remote?: RemoteExecutorRef;
}

export interface RemoteExecutorRef {
  readonly provider: "github" | "gitlab" | "sonarcloud" | "custom";
  readonly endpoint: string;
}

export interface ResourceLimits {
  readonly cpu: string; // e.g. "2", "0.5"
  readonly memory: string; // e.g. "512Mi", "2Gi"
}

export type NetworkPolicy = "deny" | "allow-host" | "allow-egress";

export interface CredentialDeclaration {
  readonly name: string;
  readonly envVar: string;
  readonly required: boolean;
}

export interface CacheDeclaration {
  readonly inputs: readonly string[];
  readonly outputs: readonly string[];
  readonly key: string; // deterministic cache key
}

export interface ArtifactDeclaration {
  readonly path: string;
  readonly name?: string;
  readonly retain: boolean;
}

export interface RetryPolicy {
  readonly maxAttempts: number; // >= 1
  readonly backoffSeconds: number; // >= 0
  readonly retryOn: readonly ("failure" | "timeout")[];
}

export interface PlanMetadata {
  readonly sverkaVersion: string;
  readonly generatedBy: "planner" | "manual" | "compiler";
  readonly compilerAnnotations?: Readonly<Record<string, unknown>>;
  readonly labels?: Readonly<Record<string, string>>;
}
