// Validation functions for the Definition Graph.
// Spec 05 — §11.4.

import type { StepDefinition, DefinitionGraph } from "./graph.js";
import { SynthesisError } from "./errors.js";
import type { StepRef, OutputType, CacheSpec, RetryPolicy, NetworkAllowlist, WriteDeclaration } from "../cdk/index.js";

/**
 * Detect cycles in the dependency graph using DFS.
 * Throws SynthesisError(CYCLE) on first cycle found.
 */
export function detectCycles(steps: readonly StepDefinition[]): void {
  const stepMap = new Map(steps.map((s) => [s.id, s]));
  const WHITE = 0; // unvisited
  const GRAY = 1; // in current DFS path
  const BLACK = 2; // fully processed
  const color = new Map<string, number>();
  for (const s of steps) {
    color.set(s.id, WHITE);
  }

  function dfs(id: string): void {
    const c = color.get(id);
    if (c === BLACK) return;
    if (c === GRAY) {
      throw new SynthesisError("CYCLE", `Dependency cycle detected at step '${id}'`, id);
    }
    const step = stepMap.get(id);
    if (!step) {
      throw new SynthesisError(
        "UNKNOWN_PRODUCER",
        `Step '${id}' not found during cycle detection`,
        id,
      );
    }
    color.set(id, GRAY);
    for (const dep of step.dependencies) {
      dfs(dep.producer);
    }
    color.set(id, BLACK);
  }

  for (const s of steps) {
    if (color.get(s.id) === WHITE) {
      dfs(s.id);
    }
  }
}

/**
 * Validate that all explicit dependencies (including control dependencies from
 * dependsOn) point to existing steps in the pipeline.
 * Throws SynthesisError(UNKNOWN_PRODUCER).
 */
export function validateDependencies(steps: readonly StepDefinition[]): void {
  const stepIds = new Set(steps.map((s) => s.id));
  for (const step of steps) {
    for (const dep of step.dependencies) {
      if (!stepIds.has(dep.producer)) {
        throw new SynthesisError(
          "UNKNOWN_PRODUCER",
          `Step '${step.id}' depends on unknown producer '${dep.producer}'`,
          step.id,
        );
      }
    }
  }
}

/**
 * Validate that all StepRef inputs point to existing steps in the pipeline.
 * Throws SynthesisError(UNKNOWN_PRODUCER).
 */
export function validateReferences(
  steps: readonly StepDefinition[],
  pipelineId: string,
): void {
  const stepIds = new Set(steps.map((s) => s.id));
  for (const step of steps) {
    for (const input of step.inputs) {
      if (input.kind === "step") {
        const ref: StepRef = input;
        const producerId = resolveStepId(pipelineId, ref.step);
        if (!stepIds.has(producerId)) {
          throw new SynthesisError(
            "UNKNOWN_PRODUCER",
            `Step '${step.id}' references unknown producer '${ref.step}'`,
            step.id,
          );
        }
      }
    }

    if (step.condition?.kind === "step") {
      const ref: StepRef = step.condition;
      const producerId = resolveStepId(pipelineId, ref.step);
      if (!stepIds.has(producerId)) {
        throw new SynthesisError(
          "UNKNOWN_PRODUCER",
          `Step '${step.id}' condition references unknown producer '${ref.step}'`,
          step.id,
        );
      }
    }
  }
}

/**
 * Validate that no step has duplicate output names.
 * Throws SynthesisError(OUTPUT_COLLISION).
 */
export function validateOutputCollisions(steps: readonly StepDefinition[]): void {
  for (const step of steps) {
    const names = new Set<string>();
    for (const op of step.operations) {
      if (
        op.kind === "exportOutput" ||
        op.kind === "exportArtifact" ||
        op.kind === "importArtifact"
      ) {
        if (names.has(op.name)) {
          throw new SynthesisError(
            "OUTPUT_COLLISION",
            `Step '${step.id}' has duplicate output name '${op.name}'`,
            step.id,
          );
        }
        names.add(op.name);
      }
    }
  }
}

function buildOutputTypeMap(
  steps: readonly StepDefinition[],
): Map<string, Map<string, OutputType>> {
  const outputTypes = new Map<string, Map<string, OutputType>>();
  for (const step of steps) {
    const outs = new Map<string, OutputType>();
    // Export operations (shell steps).
    for (const op of step.operations) {
      if (op.kind === "exportOutput") {
        outs.set(op.name, op.type);
      } else if (op.kind === "exportArtifact") {
        outs.set(op.name, "artifact");
      }
    }
    // Call-step outputs (copied from callee at synthesis — no operations).
    for (const out of step.outputs) {
      if (!outs.has(out.name)) {
        outs.set(out.name, out.type);
      }
    }
    outputTypes.set(step.id, outs);
  }
  return outputTypes;
}

function validateInputReference(
  step: StepDefinition,
  ref: StepRef,
  outputTypes: Map<string, Map<string, OutputType>>,
  pipelineId: string,
): void {
  const producerId = resolveStepId(pipelineId, ref.step);
  const producerOutputs = outputTypes.get(producerId);
  if (!producerOutputs) {
    // UNKNOWN_PRODUCER is reported by validateReferences/validateDependencies.
    return;
  }
  const declaredType = producerOutputs.get(ref.output);
  if (declaredType === undefined) {
    throw new SynthesisError(
      "INCOMPATIBLE_REFERENCE",
      `Step '${step.id}' references output '${ref.output}' which doesn't exist on producer '${ref.step}'`,
      step.id,
    );
  }
  if (declaredType !== ref.type) {
    throw new SynthesisError(
      "INCOMPATIBLE_REFERENCE",
      `Step '${step.id}' references '${ref.output}' as type '${ref.type}' but producer declares '${declaredType}'`,
      step.id,
    );
  }
}

function validateConditionReference(
  step: StepDefinition,
  ref: StepRef,
  outputTypes: Map<string, Map<string, OutputType>>,
  pipelineId: string,
): void {
  validateInputReference(step, ref, outputTypes, pipelineId);
  if (ref.type !== "boolean") {
    throw new SynthesisError(
      "INCOMPATIBLE_REFERENCE",
      `Step '${step.id}' condition must reference a boolean output, got '${ref.type}'`,
      step.id,
    );
  }
}

/**
 * Validate that StepRef types match the producer's output type.
 * Throws SynthesisError(INCOMPATIBLE_REFERENCE).
 */
export function validateReferenceTypes(
  steps: readonly StepDefinition[],
  pipelineId: string,
): void {
  const outputTypes = buildOutputTypeMap(steps);
  for (const step of steps) {
    for (const input of step.inputs) {
      if (input.kind === "step") {
        validateInputReference(step, input as StepRef, outputTypes, pipelineId);
      }
    }
    validateStepConditionRefs(step, outputTypes, pipelineId);
  }
}

/**
 * Validate references inside a step's condition (step ref or expression refs).
 */
function validateStepConditionRefs(
  step: StepDefinition,
  outputTypes: Map<string, Map<string, OutputType>>,
  pipelineId: string,
): void {
  const cond = step.condition;
  if (!cond) return;
  if (cond.kind === "step") {
    validateConditionReference(step, cond as StepRef, outputTypes, pipelineId);
    return;
  }
  if (cond.kind === "expression") {
    for (const ref of cond.refs) {
      if (ref.kind === "step") {
        validateInputReference(step, ref as StepRef, outputTypes, pipelineId);
      }
    }
  }
}

/**
 * Resolve a step reference name to a full step id within a pipeline.
 * Step references use the step's local name (e.g. "build"), while step ids
 * include the pipeline path (e.g. "ci/build").
 */
export function resolveStepId(pipelineId: string, stepName: string): string {
  // If the reference already includes the pipeline prefix, use as-is.
  if (stepName.startsWith(`${pipelineId}/`)) {
    return stepName;
  }
  return `${pipelineId}/${stepName}`;
}

/**
 * Validate a complete Definition Graph — runs all 4 validators per pipeline.
 * Throws SynthesisError on first failure. Used by IR deserialization to
 * ensure semantic validity after schema validation passes.
 */
export function validateGraph(graph: DefinitionGraph): void {
  for (const pipeline of graph.project.pipelines) {
    const steps = pipeline.steps;
    const stepIds = new Set(steps.map((s) => s.id));
    validateOutputCollisions(steps);
    validateDependencies(steps);
    validateReferences(steps, pipeline.id);
    validateReferenceTypes(steps, pipeline.id);
    detectCycles(steps);
    for (const step of steps) {
      validateCacheKeys(step);
      validateRetryPolicy(step);
      validateNetworkAllowlist(step);
      validateWriteDeclarations(step);
    }
    for (const entry of pipeline.entries) {
      if (entry.roots.length === 0) {
        throw new SynthesisError(
          "INVALID_ENTRY",
          `Entry '${entry.id}' in pipeline '${pipeline.id}' has no roots`,
          entry.id,
        );
      }
      for (const root of entry.roots) {
        if (!stepIds.has(root)) {
          throw new SynthesisError(
            "UNKNOWN_PRODUCER",
            `Entry '${entry.id}' in pipeline '${pipeline.id}' references unknown root step '${root}'`,
            root,
          );
        }
      }
    }
  }
}

/**
 * Validate that cache keys and restore keys do not reference step outputs.
 * Step-output references are unavailable before execution and cannot be used
 * to address the cache. Throws SynthesisError(CACHE_KEY_STEP_REF).
 *
 * Recognizes `${{ steps.<id>.outputs.<name> }}` and `${{ step.<id>.<name> }}`
 * patterns. Context refs (env/git/matrix/inputs/secrets) are allowed.
 */
export function validateCacheKeys(step: StepDefinition): void {
  const cache: CacheSpec | undefined = step.cache;
  if (!cache) return;
  for (const key of [cache.key, ...(cache.restoreKeys ?? [])]) {
    if (hasStepOutputRef(key)) {
      throw new SynthesisError(
        "CACHE_KEY_STEP_REF",
        `Cache key in step '${step.id}' must not reference step outputs: '${key}'`,
        step.id,
      );
    }
  }
}

/**
 * Validate a step's retry policy. Throws SynthesisError(INVALID_RETRY_POLICY)
 * when `max` is negative or `backoff.baseMs` is negative.
 */
export function validateRetryPolicy(step: StepDefinition): void {
  const retry: RetryPolicy | undefined = step.retry;
  if (!retry) return;
  if (retry.max < 0) {
    throw new SynthesisError(
      "INVALID_RETRY_POLICY",
      `Retry policy in step '${step.id}' has negative max (${retry.max})`,
      step.id,
    );
  }
  if (retry.backoff && retry.backoff.baseMs < 0) {
    throw new SynthesisError(
      "INVALID_RETRY_POLICY",
      `Retry policy in step '${step.id}' has negative backoff.baseMs (${retry.backoff.baseMs})`,
      step.id,
    );
  }
}

/**
 * Returns true if the given cache key string contains a step-output reference
 * such as `${{ steps.build.outputs.version }}` or `${{ step.build.version }}`.
 */
function hasStepOutputRef(key: string): boolean {
  const refPattern = /\$\{\{\s*([^}]+?)\s*\}\}/g;
  for (const match of key.matchAll(refPattern)) {
    const inner = match[1]!.trim();
    // `steps.<id>.outputs.<name>` or `step.<id>.<name>` — both refer to step outputs.
    if (inner.startsWith("steps.") || inner.startsWith("step.")) {
      return true;
    }
  }
  return false;
}

/**
 * Validate a step's network allowlist. Throws SynthesisError(
 * INVALID_NETWORK_ALLOWLIST) when `allowed` contains a non-string or an
 * empty string. An empty `allowed` array (deny all) is valid.
 */
export function validateNetworkAllowlist(step: StepDefinition): void {
  const network: NetworkAllowlist | undefined = step.runtime.network;
  if (!network) return;
  for (const domain of network.allowed) {
    if (typeof domain !== "string" || domain.length === 0) {
      throw new SynthesisError(
        "INVALID_NETWORK_ALLOWLIST",
        `Network allowlist in step '${step.id}' contains an invalid domain (must be a non-empty string)`,
        step.id,
      );
    }
  }
}

/**
 * Validate a step's write declarations. Throws SynthesisError(
 * INVALID_WRITE_DECLARATION) when any WriteDeclaration has an empty `kind`
 * or `target`.
 */
export function validateWriteDeclarations(step: StepDefinition): void {
  const perms = step.permissions;
  if (!perms || !perms.write) return;
  for (const decl of perms.write) {
    if (!decl.kind || decl.kind.length === 0) {
      throw new SynthesisError(
        "INVALID_WRITE_DECLARATION",
        `Write declaration in step '${step.id}' has an empty kind`,
        step.id,
      );
    }
    if (!decl.target || decl.target.length === 0) {
      throw new SynthesisError(
        "INVALID_WRITE_DECLARATION",
        `Write declaration in step '${step.id}' has an empty target`,
        step.id,
      );
    }
  }
}
