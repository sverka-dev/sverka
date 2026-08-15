// expandPipelineCalls — flatten call steps into inline callee steps (F-31).
// Pure graph transform: Definition Graph call steps → flat StepDefinition[].
// Used by the planner (for the native engine) and the GitLab target (v1 inlining).
//
// Namespacing: callee step `deploy/deploy` called from `ci/deploy-staging`
// becomes `ci/deploy-staging/deploy`. Callee-internal refs are rewritten to
// namespaced ids. The call step's dependsOn/condition propagate to the
// callee's root steps. Downstream caller StepRefs pointing at the call step's
// outputs are rewritten to the callee's producing steps.

import type {
  DefinitionGraph,
  PipelineDefinition,
  StepDefinition,
  OperationDefinition,
  Dependency,
  PipelineCall,
} from "./graph.js";
import type { Reference, StepRef, InputLiteral } from "@sverka/constructs";
import { resolveStepId } from "./validate.js";

/**
 * Expand all pipeline-call steps in the given step list into inline callee
 * steps. Returns a flat StepDefinition[] with no call steps.
 *
 * @param graph The full Definition Graph (used to look up callee pipelines).
 * @param steps The reachable steps to expand (typically from bindRunPlan).
 */
export function expandPipelineCalls(
  graph: DefinitionGraph,
  steps: readonly StepDefinition[],
): readonly StepDefinition[] {
  const byId = new Map(graph.project.pipelines.map((p) => [p.id, p]));

  // Phase 1: Expand all call steps recursively, building a global refRewrite
  // map that maps (callStepId, outputName) → (expandedProducerId, outputName).
  // This lets us rewrite downstream caller StepRefs that pointed at call step
  // outputs to point at the callee's actual producing steps.
  const refRewrite = new Map<string, { producer: string; output: string }>();
  const expanded = expandAll(steps, byId, new Map(), refRewrite);

  // Phase 2: Rewrite remaining non-call steps' StepRefs using refRewrite.
  return expanded.map((s) => rewriteCallOutputRefs(s, refRewrite));
}

/**
 * Recursively expand call steps. `idMap` tracks callee step id → namespaced
 * id for the current expansion chain (handles nested calls).
 * `refRewrite` accumulates output mappings for phase 2.
 */
function expandAll(
  steps: readonly StepDefinition[],
  byId: Map<string, PipelineDefinition>,
  idMap: Map<string, string>,
  refRewrite: Map<string, { producer: string; output: string }>,
): readonly StepDefinition[] {
  const result: StepDefinition[] = [];

  for (const step of steps) {
    if (!step.call) {
      result.push(rewriteInternalRefs(step, idMap));
      continue;
    }
    const expanded = expandCallStep(step, byId, idMap, refRewrite);
    result.push(...expanded);
  }

  return result;
}

/**
 * Expand a single call step into the callee's steps, namespaced under the
 * call step's id. Registers output rewrites in refRewrite.
 */
function expandCallStep(
  callStep: StepDefinition,
  byId: Map<string, PipelineDefinition>,
  parentIdMap: Map<string, string>,
  refRewrite: Map<string, { producer: string; output: string }>,
): readonly StepDefinition[] {
  const callee = byId.get(callStep.call!.callee);
  if (!callee) return [callStep]; // shouldn't happen post-validation

  // Use the namespaced id as prefix (handles nested calls where the call
  // step's original id has been rewritten by the parent idMap).
  const prefix = parentIdMap.get(callStep.id) ?? callStep.id;
  const bindings = callStep.call!.inputs;

  // Build idMap: callee step id → namespaced id (prefix + last segment).
  const localIdMap = new Map<string, string>(parentIdMap);
  for (const calleeStep of callee.steps) {
    const localName = calleeStep.id.split("/").pop()!;
    localIdMap.set(calleeStep.id, `${prefix}/${localName}`);
  }

  // Register output rewrites: call step output name → callee producing step.
  // After expansion, refs to (callStep.id, outputName) should point to
  // (namespaced callee producer id, outputName). Use the namespaced call step
  // id (prefix) as the key source, since downstream refs may use either the
  // original or namespaced id depending on expansion depth.
  for (const out of callee.outputs) {
    const namespacedProducer = localIdMap.get(out.stepId) ?? out.stepId;
    refRewrite.set(`${prefix}:${out.name}`, {
      producer: namespacedProducer,
      output: out.name,
    });
  }

  // Determine callee root steps (no internal deps) — they inherit call step's
  // dependsOn/condition.
  const calleeStepIds = new Set(callee.steps.map((s) => s.id));
  const rootIds = new Set(
    callee.steps
      .filter((s) => s.dependencies.every((d) => !calleeStepIds.has(d.producer)))
      .map((s) => s.id),
  );

  // Expand callee steps recursively (for nested calls).
  const expandedCalleeSteps = expandAll(callee.steps, byId, localIdMap, refRewrite);

  // Apply input bindings + propagate call step deps/condition to roots.
  // The caller's pipeline id is the first segment of the call step's id
  // (e.g. "ci" from "ci/deploy-staging"), used to resolve caller StepRefs.
  const callerPipelineId = callStep.id.split("/")[0]!;

  return expandedCalleeSteps.map((s) => {
    const originalCalleeId = reverseLookup(localIdMap, s.id);
    const isRoot = originalCalleeId !== undefined && rootIds.has(originalCalleeId);

    let rewritten = substituteInputBindings(s, bindings, localIdMap, callerPipelineId);

    if (isRoot) {
      rewritten = addCallStepDeps(rewritten, callStep);
      if (callStep.condition !== undefined) {
        rewritten = { ...rewritten, condition: callStep.condition };
      }
    }

    return rewritten;
  });
}

function reverseLookup(idMap: Map<string, string>, expandedId: string): string | undefined {
  for (const [orig, expanded] of idMap) {
    if (expanded === expandedId) return orig;
  }
  return undefined;
}

/**
 * Rewrite callee-internal StepRefs, dependsOn, importArtifact.from, condition
 * using idMap (callee-internal ids → namespaced ids).
 */
function rewriteInternalRefs(
  step: StepDefinition,
  idMap: Map<string, string>,
): StepDefinition {
  if (idMap.size === 0) return step;
  const rewriteId = (id: string): string => idMap.get(id) ?? id;

  // Rewrite the step's own id.
  const newId = rewriteId(step.id);

  const inputs: Reference[] = step.inputs.map((ref) =>
    ref.kind === "step" ? ({ ...ref, step: rewriteId(ref.step) } as Reference) : ref,
  );

  const dependencies: Dependency[] = step.dependencies.map((d) => ({
    ...d,
    producer: rewriteId(d.producer),
  }));

  const operations: OperationDefinition[] = step.operations.map((op) =>
    op.kind === "importArtifact" ? { ...op, from: rewriteId(op.from) } : op,
  );

  const condition =
    step.condition?.kind === "step"
      ? ({ ...step.condition, step: rewriteId(step.condition.step) } as Reference)
      : step.condition;

  return {
    ...step,
    id: newId,
    inputs,
    dependencies,
    operations,
    ...(condition !== step.condition ? { condition } : {}),
  };
}

/**
 * Substitute callee `inputs.X` context refs with the caller's bound values.
 * - Literal → drop the ref (literal baked in at operation level).
 * - Reference → replace with the bound Reference, resolving caller StepRefs
 *   to pipeline-prefixed ids and rewriting callee-internal refs via idMap.
 */
function substituteInputBindings(
  step: StepDefinition,
  bindings: Readonly<Record<string, Reference | InputLiteral>>,
  idMap: Map<string, string>,
  callerPipelineId: string,
): StepDefinition {
  const resolveBinding = (binding: Reference): Reference => {
    if (binding.kind === "step") {
      // Resolve caller StepRef to pipeline-prefixed id, then apply idMap
      // (for nested calls where the caller ref may have been namespaced).
      const resolved = resolveStepId(callerPipelineId, binding.step);
      return { ...binding, step: idMap.get(resolved) ?? resolved };
    }
    return binding;
  };

  const inputs: Reference[] = [];
  for (const ref of step.inputs) {
    if (ref.kind === "context" && ref.namespace === "inputs") {
      const binding = bindings[ref.field];
      if (binding !== undefined) {
        if (typeof binding === "object" && binding !== null) {
          inputs.push(resolveBinding(binding as Reference));
        }
        continue; // literal → drop ref
      }
    }
    inputs.push(ref);
  }

  let condition = step.condition;
  if (condition?.kind === "context" && condition.namespace === "inputs") {
    const binding = bindings[condition.field];
    if (binding !== undefined) {
      if (typeof binding === "object" && binding !== null) {
        condition = resolveBinding(binding as Reference);
      } else {
        condition = undefined;
      }
    }
  }

  return { ...step, inputs, ...(condition !== step.condition ? { condition } : {}) };
}

/**
 * Add the call step's dependencies to a root callee step as control deps.
 */
function addCallStepDeps(
  rootStep: StepDefinition,
  callStep: StepDefinition,
): StepDefinition {
  const existingProducers = new Set(rootStep.dependencies.map((d) => d.producer));
  const newDeps: Dependency[] = [...rootStep.dependencies];
  for (const dep of callStep.dependencies) {
    if (!existingProducers.has(dep.producer)) {
      newDeps.push(dep);
      existingProducers.add(dep.producer);
    }
  }
  return { ...rootStep, dependencies: newDeps };
}

/**
 * Phase 2: Rewrite StepRefs that pointed at a call step's outputs to point
 * at the callee's actual producing steps (now namespaced).
 */
function rewriteCallOutputRefs(
  step: StepDefinition,
  refRewrite: Map<string, { producer: string; output: string }>,
): StepDefinition {
  if (refRewrite.size === 0) return step;

  const rewriteRef = (ref: Reference): Reference => {
    if (ref.kind !== "step") return ref;
    const key = `${ref.step}:${ref.output}`;
    const target = refRewrite.get(key);
    if (!target) return ref;
    return { ...ref, step: target.producer, output: target.output };
  };

  const inputs: Reference[] = step.inputs.map(rewriteRef);

  const dependencies: Dependency[] = step.dependencies.map((d) => {
    if (d.kind === "control") return d;
    const key = `${d.producer}:${d.output}`;
    const target = refRewrite.get(key);
    if (!target) return d;
    return { ...d, producer: target.producer, output: target.output };
  });

  const operations: OperationDefinition[] = step.operations.map((op) => {
    if (op.kind !== "importArtifact") return op;
    const key = `${op.from}:${op.output}`;
    const target = refRewrite.get(key);
    if (!target) return op;
    return { ...op, from: target.producer, output: target.output };
  });

  const condition =
    step.condition !== undefined ? rewriteRef(step.condition) : undefined;

  return { ...step, inputs, dependencies, operations, ...(condition !== undefined ? { condition } : {}) };
}
