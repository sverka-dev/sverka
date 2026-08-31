import { createHash } from "node:crypto";
import { readFileSync } from "node:fs";
import { canonicalStringify } from "@sverka/workflow";
import type {
  OperationSpec,
  CacheDeclaration as CoreCacheDeclaration,
  ArtifactDeclaration as CoreArtifactDeclaration,
} from "@sverka/workflow";
import type {
  Plan,
  PlanOperation,
  PlanMetadata,
  ExecutorSpec,
  ResourceLimits,
  PlanRetryPolicy,
  PlanCacheDeclaration,
  PlanArtifactDeclaration,
} from "@sverka/workflow";
import { computePlanId } from "@sverka/workflow";
import type { ProjectContext } from "../planner/index.js";
import { SdkError } from "../errors.js";

const SVERKA_VERSION: string = ((): string => {
  let raw: string = "";
  try {
    raw = readFileSync(new URL("../package.json", import.meta.url), "utf-8");
  } catch {
    try {
      raw = readFileSync(new URL("../../package.json", import.meta.url), "utf-8");
    } catch {
      return "0.0.0";
    }
  }
  const parsed: unknown = JSON.parse(raw);
  if (typeof parsed === "object" && parsed !== null && "version" in parsed && typeof (parsed as Record<string, unknown>).version === "string") {
    return (parsed as { version: string }).version;
  }
  return "0.0.0";
})();

export interface ConvertOptions {
  /** Plan name (from WorkflowDefinition.name or default). */
  name: string;
  /** Executor type to fill for operations without an image. */
  executor: "host" | "docker";
  /** Project context for sourceContextHash. */
  context?: ProjectContext;
}

/**
 * Convert an array of OperationSpecs into a validated IR Plan with all
 * defaults filled per the spec's conversion table.
 */
export function convertToPlan(
  operations: readonly OperationSpec[],
  opts: ConvertOptions,
): Plan {
  const planOps = operations.map((spec) => convertOperation(spec, opts));

  const sourceContextHash = computeSourceContextHash(opts.context);
  const metadata: PlanMetadata = {
    sverkaVersion: SVERKA_VERSION,
    generatedBy: "manual",
  };

  const body: Omit<Plan, "id" | "createdAt"> = {
    apiVersion: "sverka.dev/v1",
    name: opts.name,
    sourceContextHash,
    operations: planOps,
    metadata,
  };

  const id = computePlanId(body);
  const createdAt = new Date().toISOString();

  return { ...body, id, createdAt };
}

function convertOperation(
  spec: OperationSpec,
  opts: ConvertOptions,
): PlanOperation {
  if (!spec.id || spec.id.length === 0) {
    throw new SdkError(
      `operation has empty id (kind=${spec.kind}, name=${spec.name})`,
      "EXECUTION_FAILED",
    );
  }

  const executor = buildExecutor(spec, opts);
  const resources = buildResources(spec);
  const retry = buildRetry(spec);
  const artifacts = (spec.artifacts ?? []).map(convertArtifact);
  const cache = spec.cache ? convertCache(spec.cache) : undefined;

  return buildPlanOperation(spec, executor, resources, retry, artifacts, cache);
}

function buildExecutor(
  spec: OperationSpec,
  opts: ConvertOptions,
): ExecutorSpec {
  return {
    type: opts.executor,
    ...(spec.image !== undefined ? { image: spec.image } : {}),
    ...(spec.imageDigest !== undefined ? { imageDigest: spec.imageDigest } : {}),
  };
}

function buildResources(spec: OperationSpec): ResourceLimits {
  return {
    cpu: spec.cpuLimit ?? "1",
    memory: spec.memoryLimit ?? "512Mi",
  };
}

function buildRetry(spec: OperationSpec): PlanRetryPolicy {
  const retries = spec.retries ?? 0;
  return {
    maxAttempts: Math.max(1, retries + 1),
    backoffSeconds: 0,
    retryOn: ["failure", "timeout"],
  };
}

function buildPlanOperation(
  spec: OperationSpec,
  executor: ExecutorSpec,
  resources: ResourceLimits,
  retry: PlanRetryPolicy,
  artifacts: PlanArtifactDeclaration[],
  cache: PlanCacheDeclaration | undefined,
): PlanOperation {
  return {
    id: spec.id,
    kind: spec.kind,
    name: spec.name,
    ...optionalFields(spec),
    ...resolveDefaults(spec),
    executor,
    resources,
    ...(cache !== undefined ? { cache } : {}),
    artifacts,
    retry,
  };
}

type DefaultedField =
  | "dependsOn"
  | "network"
  | "credentials"
  | "timeoutSeconds"
  | "continueOnError";

function valueOrDefault<T>(value: T | undefined, defaultValue: T): T {
  return value === undefined ? defaultValue : value;
}

/** Resolve fields with default values to reduce buildPlanOperation complexity. */
function resolveDefaults(
  spec: OperationSpec,
): Required<Pick<PlanOperation, DefaultedField>> {
  return {
    dependsOn: valueOrDefault(spec.dependsOn, []),
    network: valueOrDefault(spec.network, "deny"),
    credentials: valueOrDefault(spec.credentials, []),
    timeoutSeconds: valueOrDefault(spec.timeoutSeconds, 300),
    continueOnError: valueOrDefault(spec.continueOnError, false),
  };
}

function optionalFields(spec: OperationSpec): Partial<PlanOperation> {
  return {
    ...(spec.description !== undefined ? { description: spec.description } : {}),
    ...(spec.command !== undefined ? { command: spec.command } : {}),
    ...(spec.args !== undefined ? { args: spec.args } : {}),
    ...(spec.env !== undefined ? { env: spec.env } : {}),
    ...(spec.workingDir !== undefined ? { workingDir: spec.workingDir } : {}),
    ...(spec.condition !== undefined ? { condition: spec.condition } : {}),
  };
}

function convertArtifact(a: CoreArtifactDeclaration): PlanArtifactDeclaration {
  return {
    path: a.path,
    ...(a.name !== undefined ? { name: a.name } : {}),
    retain: a.retain ?? false,
  };
}

function convertCache(c: CoreCacheDeclaration): PlanCacheDeclaration {
  return {
    inputs: c.inputs,
    outputs: c.outputs ?? [],
    key: c.key ?? computeCacheKey(c.inputs),
  };
}

function computeCacheKey(inputs: readonly string[]): string {
  // Use 32 hex chars (128 bits) to keep keys compact while avoiding
  // the higher collision risk of a 64-bit truncation.
  return createHash("sha256")
    .update(inputs.join(","))
    .digest("hex")
    .slice(0, 32);
}

function computeSourceContextHash(context?: ProjectContext): string {
  const changedFiles = context
    ? [...context.changedFiles.map((f) => f.path)].sort((a, b) => a.localeCompare(b))
    : [];
  const value = {
    commit: context?.commit ?? "",
    dirty: context?.dirty ?? false,
    changedFiles,
  };
  return createHash("sha256")
    .update(canonicalStringify(value))
    .digest("hex");
}
