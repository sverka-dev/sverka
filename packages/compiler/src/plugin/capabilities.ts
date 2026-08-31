// Capability analysis. Spec 07 — §24.
// Inspects a Definition Graph to detect used capabilities, then checks
// against provided manifests to produce diagnostics.

import type { DefinitionGraph } from "@sverka/workflow";
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
 * Shape of a step used for capability detection.
 */
interface CapabilityStep {
  runtime?: { mode?: string; workingDir?: string; shell?: string; env?: Readonly<Record<string, string>>; secrets?: readonly string[] };
  operations: readonly CapabilityOperation[];
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
  call?: unknown;
  component?: unknown;
  childPipeline?: unknown;
  downstream?: unknown;
  delay?: string;
  condition?: unknown;
}

interface CapabilityOperation {
  kind: string;
  spec?: { type?: string };
  retention?: string;
  access?: string;
}

interface OutputFlags {
  scalar: boolean;
  artifact: boolean;
}

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
function detectStepCapabilities(step: CapabilityStep, caps: Set<string>): void {
  detectRuntimeCapabilities(step, caps);
  detectRunnerCapabilities(step, caps);
  detectIdentityCapabilities(step, caps);
  detectRuleCapabilities(step, caps);
  detectServiceCapabilities(step, caps);
  detectEnvironmentCapabilities(step, caps);
  detectCacheCapabilities(step, caps);
  detectConcurrencyCapabilities(step, caps);
  detectSpecialStepCapabilities(step, caps);

  const outputFlags: OutputFlags = { scalar: false, artifact: false };
  for (const op of step.operations) {
    detectOperationCapabilities(op, caps, outputFlags);
  }
  detectOutputTypeCapabilities(step.outputs, outputFlags);

  if (step.dependencies.length > 0) caps.add("graph.dependencies");
  if (step.condition !== undefined) caps.add("graph.conditions");
  if (outputFlags.scalar) caps.add("output.scalar");
  if (outputFlags.artifact) caps.add("output.artifact");

  detectMatrixCapabilities(step.matrix, caps);
  detectScriptCapabilities(step, caps);
}

/**
 * Detect capabilities for special step kinds: call, component, child pipeline,
 * downstream, and delay.
 */
function detectSpecialStepCapabilities(step: CapabilityStep, caps: Set<string>): void {
  if (step.call !== undefined) caps.add("reusable.pipeline");
  if (step.component !== undefined) caps.add("reusable.component");
  if (step.childPipeline !== undefined) caps.add("reusable.childPipeline");
  if (step.downstream !== undefined) caps.add("reusable.downstream");
  if (step.delay !== undefined) caps.add("scheduling.delay");
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

function detectRuntimeCapabilities(step: CapabilityStep, caps: Set<string>): void {
  const mode = step.runtime?.mode ?? "host";
  caps.add(`runtime.${mode}`);
  if (step.runtime?.workingDir) caps.add("execution.workdir");
  if (step.runtime?.shell) caps.add("execution.shell");
  if (step.runtime?.env && Object.keys(step.runtime.env).length > 0) caps.add("environment.variables");
  if (step.runtime?.secrets && step.runtime.secrets.length > 0) caps.add("secrets.runtime");
  if (step.interruptible === true) caps.add("concurrency.interruptible");
}

function detectRunnerCapabilities(step: CapabilityStep, caps: Set<string>): void {
  if (step.runner === undefined) return;
  caps.add("runner.selection");
  if (step.runner.group !== undefined) caps.add("runner.group");
}

function detectIdentityCapabilities(step: CapabilityStep, caps: Set<string>): void {
  if (step.identity === undefined) return;
  caps.add("secrets.oidc");
  const audiences = new Set<string>();
  for (const token of Object.values(step.identity.tokens ?? {})) {
    audiences.add(token.audience);
  }
  if (audiences.size > 1) {
    caps.add("secrets.oidc.multiAudience");
  }
}

function detectRuleCapabilities(step: CapabilityStep, caps: Set<string>): void {
  if (step.rules === undefined || step.rules.length === 0) return;
  caps.add("workflow.rules");
  for (const rule of step.rules) {
    if (rule.changes !== undefined) caps.add("workflow.rules.changes");
    if (rule.exists !== undefined) caps.add("workflow.rules.exists");
  }
}

function detectServiceCapabilities(step: CapabilityStep, caps: Set<string>): void {
  if (step.services === undefined || step.services.length === 0) return;
  caps.add("environment.services");
  for (const service of step.services) {
    if (service.ports !== undefined && service.ports.length > 0) {
      caps.add("environment.services.ports");
    }
  }
}

function detectEnvironmentCapabilities(step: CapabilityStep, caps: Set<string>): void {
  if (step.environment === undefined) return;
  caps.add("deployment.environment");
  if (step.environment.action !== undefined) caps.add("deployment.environment.action");
  if (step.environment.tier !== undefined) caps.add("deployment.environment.tier");
}

function detectCacheCapabilities(step: CapabilityStep, caps: Set<string>): void {
  if (step.cache === undefined) return;
  caps.add("cache");
  if (step.cache.policy !== undefined) caps.add("cache.policy");
  if (step.cache.restoreKeys !== undefined && step.cache.restoreKeys.length > 0) caps.add("cache.fallbackKeys");
}

function detectConcurrencyCapabilities(step: CapabilityStep, caps: Set<string>): void {
  if (step.concurrency === undefined) return;
  caps.add("concurrency.group");
  if (step.concurrency.cancelInProgress !== undefined) caps.add("concurrency.cancelInProgress");
}

function detectOperationCapabilities(
  op: CapabilityOperation,
  caps: Set<string>,
  outputFlags: OutputFlags,
): void {
  switch (op.kind) {
    case "shell":
      caps.add("operation.shell");
      break;
    case "exportOutput":
      outputFlags.scalar = true;
      break;
    case "exportArtifact":
      detectExportArtifactCapabilities(op, caps, outputFlags);
      break;
    case "importArtifact":
      caps.add("operation.import");
      break;
    case "report":
      detectReportCapabilities(op, caps);
      break;
  }
}

function detectExportArtifactCapabilities(
  op: CapabilityOperation,
  caps: Set<string>,
  outputFlags: OutputFlags,
): void {
  outputFlags.artifact = true;
  if (op.retention !== undefined) caps.add("artifact.retention");
  if (op.access !== undefined) caps.add("artifact.access");
}

function detectReportCapabilities(op: CapabilityOperation, caps: Set<string>): void {
  caps.add("artifact.report");
  if (op.spec?.type !== undefined) {
    caps.add(`artifact.report.${op.spec.type}`);
  }
}

function detectOutputTypeCapabilities(
  outputs: readonly { type: string }[],
  outputFlags: OutputFlags,
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
  steps: readonly CapabilityStep[];
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
  inputs?: Readonly<Record<string, { type?: string; options?: readonly string[]; pattern?: string; secret?: boolean }>>;
  concurrency?: { group?: string; cancelInProgress?: boolean };
  rules?: readonly unknown[];
}, caps: Set<string>): void {
  detectTriggerCapabilities(pipeline.entries, caps);
  if (pipeline.permissions !== undefined) {
    caps.add("environment.permissions");
  }
  detectInputCapabilities(pipeline.inputs, caps);
  if (pipeline.defaults !== undefined) {
    detectDefaultCapabilities(pipeline.defaults, caps);
  }
  if (pipeline.concurrency !== undefined) {
    caps.add("concurrency.group");
    if (pipeline.concurrency.cancelInProgress !== undefined) caps.add("concurrency.cancelInProgress");
  }
  if (pipeline.rules !== undefined && pipeline.rules.length > 0) {
    caps.add("workflow.rules");
  }
  for (const step of pipeline.steps) {
    detectStepCapabilities(step, caps);
  }
}

function detectTriggerCapabilities(
  entries: readonly { trigger: { kind: string } }[],
  caps: Set<string>,
): void {
  for (const entry of entries) {
    caps.add(`trigger.${entry.trigger.kind}`);
  }
}

function detectInputCapabilities(
  inputs: Readonly<Record<string, { type?: string; options?: readonly string[]; pattern?: string; secret?: boolean }>> | undefined,
  caps: Set<string>,
): void {
  if (inputs === undefined || Object.keys(inputs).length === 0) return;
  caps.add("workflow.inputs");
  for (const input of Object.values(inputs)) {
    if (input.secret) caps.add("secrets.pipeline-input");
    if (input.type === "choice") caps.add("workflow.inputs.choice");
    if (input.type === "array") caps.add("workflow.inputs.array");
    if (input.pattern !== undefined) caps.add("workflow.inputs.pattern");
  }
}

function detectDefaultCapabilities(
  defaults: {
    shell?: unknown;
    workdir?: unknown;
    env?: unknown;
    beforeScript?: unknown;
    afterScript?: unknown;
    timeout?: unknown;
    retry?: unknown;
    interruptible?: unknown;
  },
  caps: Set<string>,
): void {
  caps.add("workflow.defaults");
  const defaultCaps: ReadonlyArray<[unknown, string]> = [
    [defaults.shell, "workflow.defaults.shell"],
    [defaults.workdir, "workflow.defaults.workdir"],
    [defaults.env, "workflow.defaults.env"],
    [defaults.beforeScript, "workflow.defaults.beforeScript"],
    [defaults.afterScript, "workflow.defaults.afterScript"],
    [defaults.timeout, "workflow.defaults.timeout"],
    [defaults.retry, "workflow.defaults.retry"],
    [defaults.interruptible, "workflow.defaults.interruptible"],
  ];
  for (const [value, cap] of defaultCaps) {
    if (value !== undefined) caps.add(cap);
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
