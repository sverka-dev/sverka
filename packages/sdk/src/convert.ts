import { createHash } from "node:crypto";
import type {
  OperationSpec,
  CacheDeclaration as CoreCache,
  ArtifactDeclaration as CoreArtifact,
} from "@sverka/core";
import type {
  Plan,
  PlanOperation,
  PlanMetadata,
  ExecutorSpec,
  ResourceLimits,
  RetryPolicy,
  CacheDeclaration as IrCache,
  ArtifactDeclaration as IrArtifact,
} from "@sverka/ir";
import { computePlanId } from "@sverka/ir";
import type { ProjectContext } from "@sverka/planner";

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
    sverkaVersion: "0.1.0",
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
    throw new Error(
      `operation has empty id (kind=${spec.kind}, name=${spec.name})`,
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

function buildRetry(spec: OperationSpec): RetryPolicy {
  return {
    maxAttempts: spec.retries ?? 1,
    backoffSeconds: 0,
    retryOn: ["failure", "timeout"],
  };
}

function buildPlanOperation(
  spec: OperationSpec,
  executor: ExecutorSpec,
  resources: ResourceLimits,
  retry: RetryPolicy,
  artifacts: IrArtifact[],
  cache: IrCache | undefined,
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

/** Resolve fields with default values to reduce buildPlanOperation complexity. */
function resolveDefaults(spec: OperationSpec): Partial<PlanOperation> {
  return {
    dependsOn: spec.dependsOn ?? [],
    network: spec.network ?? "deny",
    credentials: spec.credentials ?? [],
    timeoutSeconds: spec.timeoutSeconds ?? 300,
    continueOnError: spec.continueOnError ?? false,
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

function convertArtifact(a: CoreArtifact): IrArtifact {
  return {
    path: a.path,
    ...(a.name !== undefined ? { name: a.name } : {}),
    retain: a.retain ?? false,
  };
}

function convertCache(c: CoreCache): IrCache {
  return {
    inputs: c.inputs,
    outputs: c.outputs ?? [],
    key: c.key ?? computeCacheKey(c.inputs),
  };
}

function computeCacheKey(inputs: readonly string[]): string {
  return createHash("sha256")
    .update(inputs.join(","))
    .digest("hex")
    .slice(0, 16);
}

function computeSourceContextHash(context?: ProjectContext): string {
  if (!context) return "";
  const parts = [
    context.commit,
    String(context.dirty),
    context.changedFiles.map((f) => f.path).join(","),
  ];
  return createHash("sha256")
    .update(parts.join("|"))
    .digest("hex");
}
