// Capability analysis. Spec 07 — §24.
// Inspects a Definition Graph to detect used capabilities, then checks
// against provided manifests to produce diagnostics.

import type { DefinitionGraph } from "@sverka/core";
import type {
  CapabilityManifest,
  CapabilitySupport,
  CapabilityDetail,
  CapabilityDiagnostic,
} from "./types.js";
import { PluginError } from "./errors.js";

const SUPPORT_LEVELS: readonly CapabilitySupport[] = [
  "native",
  "lowered",
  "emulated",
  "connector",
  "partial",
  "unsupported",
];

const PRIORITY: Record<CapabilitySupport, number> = {
  native: 6,
  lowered: 5,
  connector: 4,
  emulated: 3,
  partial: 2,
  unsupported: 1,
};

/**
 * Validate that a value is a valid capability support level.
 */
export function validateSupport(value: unknown): CapabilitySupport {
  if (typeof value !== "string" || !SUPPORT_LEVELS.includes(value as CapabilitySupport)) {
    throw new PluginError(
      `invalid capability support level: ${String(value)}`,
      "INVALID_CAPABILITY",
    );
  }
  return value as CapabilitySupport;
}

/**
 * Validate a capability manifest object.
 */
export function validateCapabilityManifest(manifest: unknown): asserts manifest is CapabilityManifest {
  if (typeof manifest !== "object" || manifest === null || Array.isArray(manifest)) {
    throw new PluginError("capability manifest must be an object", "INVALID_CAPABILITY");
  }
  const obj = manifest as Record<string, unknown>;
  for (const [key, value] of Object.entries(obj)) {
    validateManifestEntry(key, value);
  }
}

function validateManifestEntry(key: string, value: unknown): void {
  if (typeof value === "string") {
    validateSupport(value);
    return;
  }
  if (typeof value === "object" && value !== null) {
    validateManifestDetail(key, value as Record<string, unknown>);
    return;
  }
  throw new PluginError(
    `capability '${key}' must be a support string or CapabilityDetail object`,
    "INVALID_CAPABILITY",
  );
}

function validateManifestDetail(key: string, detail: Record<string, unknown>): void {
  validateSupport(detail.support);
  if (detail.via !== undefined && typeof detail.via !== "string") {
    throw new PluginError(`capability '${key}' has invalid via: must be a string`, "INVALID_CAPABILITY");
  }
  if (detail.notes !== undefined && typeof detail.notes !== "string") {
    throw new PluginError(`capability '${key}' has invalid notes: must be a string`, "INVALID_CAPABILITY");
  }
}

/**
 * Detect capabilities used by a single step.
 */
function detectStepCapabilities(step: {
  runtime?: { mode?: string; workingDir?: string; shell?: string; env?: Readonly<Record<string, string>>; secrets?: readonly string[] };
  operations: readonly { kind: string }[];
  outputs: readonly { type: string }[];
  dependencies: readonly unknown[];
  matrix?: { dimensions?: unknown; include?: readonly unknown[]; exclude?: readonly unknown[]; failFast?: boolean; maxParallel?: number };
  beforeScript?: readonly unknown[];
  afterScript?: readonly unknown[];
  continueOnError?: unknown;
  retry?: { max?: number };
  interruptible?: boolean;
  runner?: { labels?: readonly string[]; group?: string };
  identity?: { tokens?: Readonly<Record<string, { audience: string }>> };
  rules?: readonly { changes?: readonly string[]; exists?: readonly string[] }[];
  services?: readonly { ports?: readonly number[] }[];
  environment?: { name?: string; action?: string; tier?: string };
  cache?: { policy?: string; restoreKeys?: readonly string[] };
  concurrency?: { group?: string; cancelInProgress?: boolean };
}, caps: Set<string>): void {
  const mode = step.runtime?.mode ?? "host";
  caps.add(`runtime.${mode}`);
  if (step.runtime?.workingDir) caps.add("execution.workdir");
  if (step.runtime?.shell) caps.add("execution.shell");
  if (step.runtime?.env && Object.keys(step.runtime.env).length > 0) caps.add("environment.variables");
  if (step.runtime?.secrets && step.runtime.secrets.length > 0) caps.add("secrets.runtime");
  if (step.interruptible === true) caps.add("concurrency.interruptible");
  if (step.runner !== undefined) {
    caps.add("runner.selection");
    if (step.runner.group !== undefined) caps.add("runner.group");
  }
  if (step.identity !== undefined) {
    caps.add("secrets.oidc");
    const audiences = new Set<string>();
    for (const token of Object.values(step.identity.tokens ?? {})) {
      audiences.add(token.audience);
    }
    if (audiences.size > 1) {
      caps.add("secrets.oidc.multiAudience");
    }
  }
  if (step.rules !== undefined && step.rules.length > 0) {
    caps.add("workflow.rules");
    for (const rule of step.rules) {
      if (rule.changes !== undefined) caps.add("workflow.rules.changes");
      if (rule.exists !== undefined) caps.add("workflow.rules.exists");
    }
  }
  if (step.services !== undefined && step.services.length > 0) {
    caps.add("environment.services");
    for (const service of step.services) {
      if (service.ports !== undefined && service.ports.length > 0) {
        caps.add("environment.services.ports");
      }
    }
  }
  if (step.environment !== undefined) {
    caps.add("deployment.environment");
    if (step.environment.action !== undefined) caps.add("deployment.environment.action");
    if (step.environment.tier !== undefined) caps.add("deployment.environment.tier");
  }
  if (step.cache !== undefined) {
    caps.add("cache");
    if (step.cache.policy !== undefined) caps.add("cache.policy");
    if (step.cache.restoreKeys !== undefined && step.cache.restoreKeys.length > 0) caps.add("cache.fallbackKeys");
  }
  if (step.concurrency !== undefined) {
    caps.add("concurrency.group");
    if (step.concurrency.cancelInProgress !== undefined) caps.add("concurrency.cancelInProgress");
  }

  const outputFlags = { scalar: false, artifact: false };
  detectOperationCapabilities(step.operations, caps, outputFlags);
  detectOutputTypeCapabilities(step.outputs, outputFlags);

  if (step.dependencies.length > 0) caps.add("graph.dependencies");
  if (outputFlags.scalar) caps.add("output.scalar");
  if (outputFlags.artifact) caps.add("output.artifact");

  detectMatrixCapabilities(step.matrix, caps);
  detectScriptCapabilities(step, caps);
}

function detectMatrixCapabilities(
  matrix: { dimensions?: unknown; include?: readonly unknown[]; exclude?: readonly unknown[]; failFast?: boolean; maxParallel?: number } | undefined,
  caps: Set<string>,
): void {
  if (!matrix) return;
  caps.add("graph.matrix");
  if (matrix.include && matrix.include.length > 0) caps.add("matrix.include");
  if (matrix.exclude && matrix.exclude.length > 0) caps.add("matrix.exclude");
  if (matrix.failFast !== undefined) caps.add("matrix.failFast");
  if (matrix.maxParallel !== undefined) caps.add("matrix.maxParallel");
}

function detectScriptCapabilities(
  step: {
    beforeScript?: readonly unknown[];
    afterScript?: readonly unknown[];
    continueOnError?: unknown;
    retry?: { max?: number };
  },
  caps: Set<string>,
): void {
  if (step.beforeScript && step.beforeScript.length > 0) caps.add("step.beforeScript");
  if (step.afterScript && step.afterScript.length > 0) caps.add("step.afterScript");
  if (step.continueOnError !== undefined) caps.add("step.continueOnError");
  if (step.retry !== undefined) caps.add("policy.retry");
}

function detectOperationCapabilities(
  operations: readonly { kind: string; spec?: { type?: string }; retention?: string; access?: string }[],
  caps: Set<string>,
  outputFlags: { scalar: boolean; artifact: boolean },
): void {
  for (const op of operations) {
    if (op.kind === "shell") caps.add("operation.shell");
    else if (op.kind === "exportOutput") outputFlags.scalar = true;
    else if (op.kind === "exportArtifact") {
      outputFlags.artifact = true;
      if (op.retention !== undefined) caps.add("artifact.retention");
      if (op.access !== undefined) caps.add("artifact.access");
    }
    else if (op.kind === "importArtifact") caps.add("operation.import");
    else if (op.kind === "report") {
      caps.add("artifact.report");
      if (op.spec?.type !== undefined) {
        caps.add(`artifact.report.${op.spec.type}`);
      }
    }
  }
}

function detectOutputTypeCapabilities(
  outputs: readonly { type: string }[],
  outputFlags: { scalar: boolean; artifact: boolean },
): void {
  for (const output of outputs) {
    if (output.type === "artifact") outputFlags.artifact = true;
    else outputFlags.scalar = true;
  }
}

/**
 * Detect capabilities used by a single pipeline.
 */
function detectPipelineCapabilities(pipeline: {
  entries: readonly { trigger: { kind: string } }[];
  inputs?: Readonly<Record<string, { secret?: boolean }>>;
  steps: readonly {
    runtime?: { mode?: string; workingDir?: string; shell?: string; env?: Readonly<Record<string, string>>; secrets?: readonly string[] };
    operations: readonly { kind: string }[];
    outputs: readonly { type: string }[];
    dependencies: readonly unknown[];
    matrix?: { dimensions?: unknown; include?: readonly unknown[]; exclude?: readonly unknown[]; failFast?: boolean; maxParallel?: number };
    interruptible?: boolean;
    runner?: { labels?: readonly string[]; group?: string };
    identity?: { tokens?: Readonly<Record<string, { audience: string }>> };
    rules?: readonly { changes?: readonly string[]; exists?: readonly string[] }[];
    services?: readonly { ports?: readonly number[] }[];
  environment?: { name?: string; action?: string; tier?: string };
  cache?: { policy?: string; restoreKeys?: readonly string[] };
  concurrency?: { group?: string; cancelInProgress?: boolean };
  }[];
  permissions?: unknown;
  defaults?: {
    shell?: unknown;
    workdir?: unknown;
    env?: unknown;
    beforeScript?: unknown;
    afterScript?: unknown;
    timeout?: unknown;
    retry?: unknown;
    interruptible?: unknown;
  };
  inputs?: Readonly<Record<string, { type?: string; options?: readonly string[]; pattern?: string }>>;
}, caps: Set<string>): void {
  for (const entry of pipeline.entries) {
    caps.add(`trigger.${entry.trigger.kind}`);
  }
  if (pipeline.inputs) {
    for (const input of Object.values(pipeline.inputs)) {
      if (input.secret) caps.add("secrets.pipeline-input");
    }
  }
  if (pipeline.permissions !== undefined) {
    caps.add("environment.permissions");
  }
  if (pipeline.inputs !== undefined && Object.keys(pipeline.inputs).length > 0) {
    caps.add("workflow.inputs");
    for (const input of Object.values(pipeline.inputs)) {
      if (input.type === "choice") caps.add("workflow.inputs.choice");
      if (input.type === "array") caps.add("workflow.inputs.array");
      if (input.pattern !== undefined) caps.add("workflow.inputs.pattern");
    }
  }
  if (pipeline.defaults !== undefined) {
    caps.add("workflow.defaults");
    const d = pipeline.defaults;
    if (d.shell !== undefined) caps.add("workflow.defaults.shell");
    if (d.workdir !== undefined) caps.add("workflow.defaults.workdir");
    if (d.env !== undefined) caps.add("workflow.defaults.env");
    if (d.beforeScript !== undefined) caps.add("workflow.defaults.beforeScript");
    if (d.afterScript !== undefined) caps.add("workflow.defaults.afterScript");
    if (d.timeout !== undefined) caps.add("workflow.defaults.timeout");
    if (d.retry !== undefined) caps.add("workflow.defaults.retry");
    if (d.interruptible !== undefined) caps.add("workflow.defaults.interruptible");
  }
  for (const step of pipeline.steps) {
    detectStepCapabilities(step, caps);
  }
}

/**
 * Detect capabilities used by a Definition Graph.
 * Returns a set of capability identifiers (e.g., "trigger.push").
 */
export function detectCapabilities(graph: DefinitionGraph): Set<string> {
  const caps = new Set<string>();
  for (const pipeline of graph.project.pipelines) {
    detectPipelineCapabilities(pipeline, caps);
  }
  return caps;
}

/**
 * Get the support level from a manifest entry.
 */
function getSupportLevel(entry: CapabilitySupport | CapabilityDetail): CapabilitySupport {
  if (typeof entry === "string") return validateSupport(entry);
  if (entry === null || typeof entry !== "object") {
    throw new PluginError("capability entry must be a string or CapabilityDetail", "INVALID_CAPABILITY");
  }
  return validateSupport((entry as CapabilityDetail).support);
}

/**
 * Find the best support level for a capability across all manifests.
 * "native" > "lowered" > "connector" > "emulated" > "partial" > "unsupported".
 */
function findBestSupport(
  capability: string,
  manifests: readonly CapabilityManifest[],
): CapabilitySupport {
  let best: CapabilitySupport = "unsupported";
  for (const manifest of manifests) {
    const entry = manifest[capability];
    if (entry === undefined) continue;
    const level = getSupportLevel(entry);
    if (PRIORITY[level] > PRIORITY[best]) {
      best = level;
    }
  }
  return best;
}

/**
 * Map a support level to a diagnostic severity.
 */
function severityFor(support: CapabilitySupport): "error" | "warning" | "info" {
  switch (support) {
    case "unsupported":
      return "error";
    case "emulated":
    case "partial":
      return "warning";
    case "connector":
      return "info";
    default:
      return "info";
  }
}

/**
 * Analyze a Definition Graph against capability manifests.
 * Returns diagnostics for capabilities that are not natively or lowered
 * supported.
 */
export function analyzeCapabilities(
  graph: DefinitionGraph,
  manifests: readonly CapabilityManifest[],
): readonly CapabilityDiagnostic[] {
  for (const manifest of manifests) {
    validateCapabilityManifest(manifest);
  }
  const used = detectCapabilities(graph);
  const diagnostics: CapabilityDiagnostic[] = [];

  for (const capability of used) {
    const support = findBestSupport(capability, manifests);
    if (support === "native" || support === "lowered") continue;

    diagnostics.push({
      capability,
      support,
      severity: severityFor(support),
      message: `capability '${capability}' is ${support}`,
    });
  }

  return diagnostics;
}
