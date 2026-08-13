// Synthesis: transforms a construct tree into a Definition Graph.
// Spec 05 — §16, §11.3, §11.4.

import {
  Pipeline,
  ShellStep,
  Entry,
  type Project,
  Step,
  type StepRef,
  type Input,
} from "@sverka/constructs";
import type {
  DefinitionGraph,
  PipelineDefinition,
  EntryDefinition,
  StepDefinition,
  OperationDefinition,
  Dependency,
  OutputDefinition,
  PipelineOutputDefinition,
} from "./graph.js";
import {
  detectCycles,
  validateReferences,
  validateOutputCollisions,
  validateReferenceTypes,
  validateDependencies,
  resolveStepId,
} from "./validate.js";
import { SynthesisError } from "./errors.js";

/**
 * Transform a construct tree into a Definition Graph.
 *
 * Lifecycle: discover → instantiate → normalize → build graph → validate.
 * Discover and instantiate are implicit (user creates the tree directly).
 */
export function synthesize(project: Project): DefinitionGraph {
  const projectId = project.node.id;
  const pipelines: PipelineDefinition[] = [];

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
  const inputs: Input[] = [...pipeline.inputs.values()];

  // Validate.
  validateOutputCollisions(steps);
  validateReferences(steps, pipelineId);
  validateReferenceTypes(steps, pipelineId);
  validateDependencies(steps);
  detectCycles(steps);

  return { id: pipelineId, inputs, entries, steps, outputs };
}

function synthesizeStep(step: Step, pipelineId: string): StepDefinition {
  const stepId = `${pipelineId}/${step.node.id}`;
  const operations: OperationDefinition[] = [];
  const dependencies: Dependency[] = [];
  const seenDeps = new Set<string>();

  // Shell operation (only ShellStep has a command in v0).
  if (step instanceof ShellStep) {
    operations.push({ kind: "shell", command: step.command });
  }

  // Export operations from outputs.
  for (const [name, decl] of step.outputs) {
    if (decl.type === "artifact") {
      if (decl.path === undefined) {
        throw new SynthesisError(
          "INVALID_OUTPUT",
          `Artifact output '${name}' on step '${stepId}' must have a path`,
          stepId,
        );
      }
      operations.push({ kind: "exportArtifact", name, path: decl.path });
    } else {
      operations.push({ kind: "exportOutput", name, type: decl.type });
    }
  }

  // Import operations + dependency inference from inputs.
  for (const input of step.inputs) {
    if (input.kind === "step") {
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
        addDependency(dependencies, seenDeps, {
          kind: "artifact",
          producer: producerId,
          output: ref.output,
        });
      } else {
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

  const stepOutputs: OutputDefinition[] = [...step.outputs.entries()].map(
    ([name, decl]) => ({ ...decl, name }),
  );

  const def: StepDefinition = {
    id: stepId,
    runtime: step.runtime,
    operations,
    inputs: [...step.inputs],
    outputs: stepOutputs,
    dependencies,
    ...(step.timeout !== undefined ? { timeout: step.timeout } : {}),
  };

  return def;
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
