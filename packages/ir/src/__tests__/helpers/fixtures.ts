// Shared test fixtures for @sverka/ir tests.
import { Project, Pipeline, ShellStep, Entry, push } from "@sverka/constructs";
import { synthesize, type DefinitionGraph } from "@sverka/core";
import { computeGraphId, computeRunPlanId } from "../../ids.js";
import type { RunPlan, BoundEntry, InputValue } from "../../run-plan.js";

/** Build a simple build→test→deploy graph with artifact + scalar transfer. */
export function makeSampleGraph(): DefinitionGraph {
  const proj = new Project("myproj");
  const pipeline = new Pipeline(proj, "ci");
  new ShellStep(pipeline, "build", {
    command: "npm run build",
    outputs: {
      dist: { type: "artifact", path: "./dist" },
      version: { type: "string" },
    },
  });
  new ShellStep(pipeline, "test", {
    command: "npm test",
    inputs: [{ kind: "step", step: "build", output: "dist", type: "artifact" }],
  });
  new ShellStep(pipeline, "deploy", {
    command: "deploy",
    inputs: [{ kind: "step", step: "build", output: "version", type: "string" }],
    dependsOn: ["test"],
  });
  new Entry(pipeline, "on-push", {
    trigger: push({ branches: ["main"] }),
    roots: ["deploy"],
  });
  return synthesize(proj);
}

/** Build a sample RunPlan with real IDs, bound to the first entry. */
export function makeSampleRunPlan(graph: DefinitionGraph): RunPlan {
  const pipeline = graph.project.pipelines[0]!;
  const entry = pipeline.entries[0]!;
  const boundEntry: BoundEntry = { id: entry.id, trigger: entry.trigger };
  const inputs: Record<string, InputValue> = { env: "production" };
  const graphId = computeGraphId(graph);
  const body = {
    apiVersion: "sverka.dev/v1run" as const,
    graphId,
    entry: boundEntry,
    inputs,
    steps: pipeline.steps,
  };
  const id = computeRunPlanId(body);
  return {
    ...body,
    id,
    createdAt: "2026-08-13T00:00:00.000Z",
  };
}

