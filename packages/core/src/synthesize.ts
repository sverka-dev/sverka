// Synthesis: transforms a construct tree into a Definition Graph.
// Spec 05 — §16, §11.3, §11.4.

import {
  Pipeline,
  ShellStep,
  Entry,
  type Project,
  type Step,
  type StepRef,
  type OutputDeclaration,
  type Input,
} from "@sverka/constructs";
import type {
  DefinitionGraph,
  ProjectDefinition,
  PipelineDefinition,
  EntryDefinition,
  StepDefinition,
  OperationDefinition,
  Dependency,
} from "./graph.js";
import {
  detectCycles,
  validateReferences,
  validateOutputCollisions,
  validateReferenceTypes,
} from "./validate.js";

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
    if (child instanceof Pipeline) {
      pipelines.push(synthesizePipeline(child, projectId));
    }
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
    if (child instanceof ShellStep) {
      steps.push(synthesizeStep(child, pipelineId));
    } else if (child instanceof Entry) {
      entries.push(synthesizeEntry(child, pipelineId));
    }
  }

  // Collect pipeline-level outputs from all steps.
  const outputs: OutputDeclaration[] = steps.flatMap((s) => s.outputs);
  const inputs: Input[] = [...pipeline.inputs.values()];

  // Validate.
  validateOutputCollisions(steps);
  validateReferences(steps, pipelineId);
  validateReferenceTypes(steps, pipelineId);
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
      operations.push({ kind: "exportArtifact", name, path: decl.path ?? "" });
    } else {
      operations.push({ kind: "exportOutput", name, type: decl.type });
    }
  }

  // Import operations + dependency inference from inputs.
  for (const input of step.inputs) {
    if (input.kind === "step") {
      const ref: StepRef = input;
      const producerId = `${pipelineId}/${ref.step}`;
      if (ref.type === "artifact") {
        operations.push({
          kind: "importArtifact",
          name: ref.output,
          from: ref.step,
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
      producer: `${pipelineId}/${depName}`,
    });
  }

  const def: StepDefinition = {
    id: stepId,
    runtime: step.runtime,
    operations,
    inputs: [...step.inputs],
    outputs: [...step.outputs.values()],
    dependencies,
    ...(step.timeout !== undefined ? { timeout: step.timeout } : {}),
  };

  return def;
}

function synthesizeEntry(entry: Entry, pipelineId: string): EntryDefinition {
  return {
    id: `${pipelineId}/${entry.node.id}`,
    trigger: entry.trigger,
    roots: entry.roots.map((r) => `${pipelineId}/${r}`),
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
      : `${dep.kind}:${dep.producer}:${dep.output ?? ""}`;
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
