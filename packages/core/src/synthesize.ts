// Synthesis: transforms a construct tree into a Definition Graph.
// Spec 05 — §16, §11.3, §11.4. F-31: two-pass for pipeline calls.

import {
  Pipeline,
  ShellStep,
  PipelineCallStep,
  ComponentStep,
  ChildPipelineStep,
  DownstreamStep,
  ReleaseStep,
  PagesStep,
  Entry,
  type Project,
  Step,
  type StepRef,
  type Reference,
  type InputLiteral,
} from "@sverka/cdk";
import type {
  DefinitionGraph,
  PipelineDefinition,
  Input,
  EntryDefinition,
  StepDefinition,
  OperationDefinition,
  Dependency,
  OutputDefinition,
  PipelineOutputDefinition,
  PipelineCall,
} from "./graph.js";
import {
  detectCycles,
  validateReferences,
  validateOutputCollisions,
  validateReferenceTypes,
  validateDependencies,
  resolveStepId,
} from "./validate.js";
import { validatePipelineCalls } from "./validate-calls.js";
import { SynthesisError } from "./errors.js";

/**
 * Transform a construct tree into a Definition Graph.
 *
 * Three-pass: (1) synthesize all pipelines' steps/entries/outputs without
 * resolving call-step outputs or validating references; (2) resolve call-step
 * outputs from callee pipelines; (3) validate references, types, deps, cycles
 * per pipeline + validate the call graph. This allows callees to be defined
 * after callers and ensures call-step outputs are visible to reference
 * validation.
 */
export function synthesize(project: Project): DefinitionGraph {
  const projectId = project.node.id;
  const pipelines: PipelineDefinition[] = [];

  // Pass 1: synthesize each pipeline's steps/entries/outputs (no validation).
  for (const child of project.node.children) {
    if (!(child instanceof Pipeline)) {
      throw new SynthesisError(
        "INVALID_SCOPE",
        `Project can only contain Pipelines, found '${child.node.id}'`,
        projectId,
      );
    }
    pipelines.push(synthesizePipeline(child, projectId));
  }

  // Pass 2: resolve call-step outputs from callee pipelines.
  resolveCallOutputs(pipelines);

  // Pass 3: validate per-pipeline (refs, types, deps, cycles) + call graph.
  for (const pipeline of pipelines) {
    validateOutputCollisions(pipeline.steps);
    validateReferences(pipeline.steps, pipeline.id);
    validateReferenceTypes(pipeline.steps, pipeline.id);
    validateDependencies(pipeline.steps);
    detectCycles(pipeline.steps);
  }
  validatePipelineCalls(pipelines);

  return {
    project: {
      id: projectId,
      pipelines,
    },
  };
}

function synthesizePipeline(pipeline: Pipeline, projectId: string): PipelineDefinition {
  const pipelineId = pipeline.node.path.slice(projectId.length + 1);
  const steps: StepDefinition[] = [];
  const entries: EntryDefinition[] = [];

  for (const child of pipeline.node.children) {
    if (child instanceof Step) {
      steps.push(synthesizeStep(child, pipelineId));
    } else if (child instanceof Entry) {
      entries.push(synthesizeEntry(child, pipelineId));
    } else {
      throw new SynthesisError(
        "INVALID_SCOPE",
        `Pipeline '${pipelineId}' can only contain Steps and Entries, found '${child.node.id}'`,
        `${projectId}/${pipelineId}`,
      );
    }
  }

  // Collect pipeline-level outputs from all steps, preserving name + producer.
  const outputs: PipelineOutputDefinition[] = steps.flatMap((s) =>
    s.outputs.map((o) => ({ ...o, stepId: s.id })),
  );
  const inputs: Record<string, Input> = Object.fromEntries(pipeline.inputs);

  return {
    id: pipelineId,
    inputs,
    entries,
    steps,
    outputs,
    ...(pipeline.permissions !== undefined ? { permissions: pipeline.permissions } : {}),
    ...(pipeline.defaults !== undefined ? { defaults: pipeline.defaults } : {}),
    ...(pipeline.concurrency !== undefined ? { concurrency: pipeline.concurrency } : {}),
    ...(pipeline.rules.length > 0 ? { rules: pipeline.rules } : {}),
    ...(pipeline.includes.length > 0 ? { includes: pipeline.includes } : {}),
  };
}

function synthesizeStep(step: Step, pipelineId: string): StepDefinition {
  const stepId = `${pipelineId}/${step.node.id}`;
  const operations: OperationDefinition[] = [...collectPrimaryOperations(step)];
  const dependencies: Dependency[] = [];
  const seenDeps = new Set<string>();

  collectExportOperations(step, stepId, operations);
  collectImportOperations(step, pipelineId, operations, dependencies, seenDeps);
  collectControlDeps(step, pipelineId, dependencies, seenDeps);
  collectReportOperations(step, operations);

  const base = buildBaseStep(stepId, step, operations, dependencies);

  // Pipeline-call step: set `call`, emit no shell operations (already empty).
  // Outputs are resolved in pass 2 (resolveCallOutputs).
  if (step instanceof PipelineCallStep) {
    const call: PipelineCall = {
      callee: step.callee,
      inputs: buildCallInputs(step.callInputs),
    };
    return { ...base, call };
  }

  // Component step: set `component`, emit no shell operations.
  if (step instanceof ComponentStep) {
    return { ...base, component: step.component };
  }

  // Child-pipeline step: set `childPipeline`, emit no shell operations.
  if (step instanceof ChildPipelineStep) {
    return { ...base, childPipeline: step.childPipeline };
  }

  // Downstream step: set `downstream`, emit no shell operations.
  if (step instanceof DownstreamStep) {
    return { ...base, downstream: step.downstream };
  }

  return base;
}

/** Build the primary operation (shell/release/pages) for a step, if any. */
function collectPrimaryOperations(step: Step): OperationDefinition[] {
  if (step instanceof ShellStep) {
    return [
      {
        kind: "shell",
        command: step.command,
        ...(step.background ? { background: true } : {}),
      },
    ];
  }
  if (step instanceof ReleaseStep) {
    return [{ kind: "release", ...step.release }];
  }
  if (step instanceof PagesStep) {
    return [{ kind: "deployPages", ...step.pages }];
  }
  return [];
}

/** Build the base `StepDefinition` (without call/component/child/downstream). */
function buildBaseStep(
  stepId: string,
  step: Step,
  operations: OperationDefinition[],
  dependencies: Dependency[],
): StepDefinition {
  const stepOutputs: OutputDefinition[] = [...step.outputs.entries()].map(
    ([name, decl]) => ({ ...decl, name }),
  );
  return {
    id: stepId,
    runtime: step.runtime,
    operations,
    inputs: [...step.inputs],
    outputs: stepOutputs,
    dependencies,
    ...(step.timeout !== undefined ? { timeout: step.timeout } : {}),
    ...(step.condition !== undefined ? { condition: step.condition } : {}),
    ...(step.matrix !== undefined ? { matrix: step.matrix } : {}),
    ...(step.beforeScript !== undefined ? { beforeScript: [...step.beforeScript] } : {}),
    ...(step.afterScript !== undefined ? { afterScript: [...step.afterScript] } : {}),
    ...(step.continueOnError !== undefined ? { continueOnError: step.continueOnError } : {}),
    ...(step.retry !== undefined ? { retry: step.retry } : {}),
    ...(step.interruptible !== undefined ? { interruptible: step.interruptible } : {}),
    ...(step.runner !== undefined ? { runner: step.runner } : {}),
    ...(step.identity !== undefined ? { identity: step.identity } : {}),
    ...(step.rules !== undefined ? { rules: step.rules } : {}),
    ...(step.reports !== undefined ? { reports: step.reports } : {}),
    ...(step.services !== undefined ? { services: step.services } : {}),
    ...(step.environment !== undefined ? { environment: step.environment } : {}),
    ...(step.cache !== undefined ? { cache: step.cache } : {}),
    ...(step.concurrency !== undefined ? { concurrency: step.concurrency } : {}),
    ...(step.delay !== undefined ? { delay: step.delay } : {}),
  };
}

/** Convert a call step's `callInputs` map into a plain record. */
function buildCallInputs(
  callInputs: ReadonlyMap<string, Reference | InputLiteral>,
): Record<string, Reference | InputLiteral> {
  const result: Record<string, Reference | InputLiteral> = {};
  for (const [name, value] of callInputs) {
    result[name] = value;
  }
  return result;
}

/**
 * Pass 2: for each call step, copy the callee pipeline's outputs onto the
 * call step's `outputs` (producer = call step id). This lets downstream
 * caller steps reference callee outputs via the existing StepRef mechanism.
 */
function resolveCallOutputs(pipelines: PipelineDefinition[]): void {
  const byId = new Map(pipelines.map((p) => [p.id, p]));

  for (let pi = 0; pi < pipelines.length; pi++) {
    const pipeline = pipelines[pi]!;
    let modified = false;
    const newSteps = [...pipeline.steps];

    for (let si = 0; si < newSteps.length; si++) {
      const step = newSteps[si]!;
      if (!step.call) continue;
      const callee = byId.get(step.call.callee);
      if (!callee) continue; // UNKNOWN_CALLEE is reported by validatePipelineCalls
      // Copy callee's pipeline-level outputs onto the call step.
      const copiedOutputs = callee.outputs.map((o) => ({
        name: o.name,
        type: o.type,
        ...(o.path !== undefined ? { path: o.path } : {}),
        ...(o.description !== undefined ? { description: o.description } : {}),
      }));
      newSteps[si] = { ...step, outputs: copiedOutputs };
      modified = true;
    }

    if (modified) {
      pipelines[pi] = { ...pipeline, steps: newSteps };
    }
  }
}

function collectReportOperations(
  step: Step,
  operations: OperationDefinition[],
): void {
  if (step.reports === undefined) return;
  for (const report of step.reports) {
    operations.push({ kind: "report", spec: report });
  }
}

function collectExportOperations(
  step: Step,
  stepId: string,
  operations: OperationDefinition[],
): void {
  for (const [name, decl] of step.outputs) {
    if (decl.type === "artifact") {
      if (decl.path === undefined) {
        throw new SynthesisError(
          "INVALID_OUTPUT",
          `Artifact output '${name}' on step '${stepId}' must have a path`,
          stepId,
        );
      }
      operations.push({
        kind: "exportArtifact",
        name,
        path: decl.path,
        ...(decl.retention !== undefined ? { retention: decl.retention } : {}),
        ...(decl.access !== undefined ? { access: decl.access } : {}),
      });
    } else {
      operations.push({ kind: "exportOutput", name, type: decl.type });
    }
  }
}

function collectImportOperations(
  step: Step,
  pipelineId: string,
  operations: OperationDefinition[],
  dependencies: Dependency[],
  seenDeps: Set<string>,
): void {
  for (const input of step.inputs) {
    if (input.kind !== "step") continue;
    const ref: StepRef = input;
    const producerId = resolveStepId(pipelineId, ref.step);
    const depKey =
      ref.type === "artifact"
        ? `artifact:${producerId}:${ref.output}`
        : `value:${producerId}:${ref.output}`;
    if (seenDeps.has(depKey)) continue;

    if (ref.type === "artifact") {
      operations.push({
        kind: "importArtifact",
        name: ref.output,
        from: producerId,
        output: ref.output,
      });
    }
    addDependency(dependencies, seenDeps, {
      kind: ref.type === "artifact" ? "artifact" : "value",
      producer: producerId,
      output: ref.output,
    });
  }
}

function collectControlDeps(
  step: Step,
  pipelineId: string,
  dependencies: Dependency[],
  seenDeps: Set<string>,
): void {
  // Condition dependencies.
  if (step.condition?.kind === "step") {
    const ref = step.condition;
    const producerId = resolveStepId(pipelineId, ref.step);
    addDependency(dependencies, seenDeps, {
      kind: "value",
      producer: producerId,
      output: ref.output,
    });
  } else if (step.condition?.kind === "expression") {
    for (const ref of step.condition.refs) {
      if (ref.kind === "step") {
        const producerId = resolveStepId(pipelineId, ref.step);
        addDependency(dependencies, seenDeps, {
          kind: "value",
          producer: producerId,
          output: ref.output,
        });
      }
    }
  }

  // Control dependencies from dependsOn.
  for (const depName of step.dependsOn) {
    addDependency(dependencies, seenDeps, {
      kind: "control",
      producer: resolveStepId(pipelineId, depName),
    });
  }
}

function synthesizeEntry(entry: Entry, pipelineId: string): EntryDefinition {
  return {
    id: `${pipelineId}/${entry.node.id}`,
    trigger: entry.trigger,
    roots: entry.roots.map((r) => resolveStepId(pipelineId, r)),
  };
}

function addDependency(
  deps: Dependency[],
  seen: Set<string>,
  dep: Dependency,
): void {
  const key =
    dep.kind === "control"
      ? `control:${dep.producer}`
      : `${dep.kind}:${dep.producer}:${dep.output}`;
  if (seen.has(key)) return;

  // If a more specific (value/artifact) dep exists, skip control dep.
  // If adding a specific dep, remove any existing control dep for same producer.
  if (dep.kind === "control") {
    const hasSpecific = deps.some(
      (d) => d.producer === dep.producer && d.kind !== "control",
    );
    if (hasSpecific) return;
  } else {
    const controlIdx = deps.findIndex(
      (d) => d.producer === dep.producer && d.kind === "control",
    );
    if (controlIdx >= 0) {
      deps.splice(controlIdx, 1);
      seen.delete(`control:${dep.producer}`);
    }
  }

  seen.add(key);
  deps.push(dep);
}
