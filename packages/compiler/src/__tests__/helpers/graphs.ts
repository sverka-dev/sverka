// Shared test graph fixtures for compiler target tests.
// Eliminates duplicated Project/Pipeline/ShellStep/Entry setup across
// drone, temporal, dagger, and inngest compile test suites.

import { expect } from "vitest";
import { Project, Pipeline, ShellStep, Entry, type DefinitionGraph } from "@sverka/workflow";
import { synthesize } from "@sverka/workflow";
import type { Condition, RetryPolicy, MatrixSpec, Runtime, OutputDeclaration, Trigger } from "@sverka/workflow";

export interface StepSpec {
  id: string;
  command: string;
  dependsOn?: string[];
  condition?: Condition;
  retry?: RetryPolicy;
  timeout?: number;
  runtime?: Runtime;
  matrix?: MatrixSpec;
  outputs?: Readonly<Record<string, OutputDeclaration>>;
}

export interface GraphOptions {
  projectName?: string;
  pipelineName?: string;
  trigger?: Trigger;
  entryId?: string;
  steps?: StepSpec[];
  roots?: string[];
}

/** Build a DefinitionGraph from declarative options. */
export function makeGraph(opts: GraphOptions = {}): DefinitionGraph {
  const {
    projectName = "test",
    pipelineName = "ci",
    trigger = { kind: "manual" },
    entryId = "on-manual",
    steps = [{ id: "build", command: "echo hi" }],
    roots,
  } = opts;
  const proj = new Project(projectName);
  const p = new Pipeline(proj, pipelineName);
  for (const step of steps) {
    new ShellStep(p, step.id, {
      command: step.command,
      dependsOn: step.dependsOn,
      condition: step.condition,
      retry: step.retry,
      timeout: step.timeout,
      runtime: step.runtime,
      matrix: step.matrix,
      outputs: step.outputs,
    });
  }
  const rootSteps = roots ?? steps.map((s) => s.id).slice(-1);
  new Entry(p, entryId, { trigger, roots: rootSteps });
  return synthesize(proj);
}

/** Single-step graph with a manual trigger (default). */
export function makeSimpleGraph(trigger: Trigger = { kind: "manual" }): DefinitionGraph {
  return makeGraph({ trigger, steps: [{ id: "build", command: "bun run build" }] });
}

/** Two-step graph with a dependency (lint → build). */
export function makeGraphWithDeps(trigger: Trigger = { kind: "manual" }): DefinitionGraph {
  return makeGraph({
    trigger,
    steps: [
      { id: "lint", command: "bun run lint" },
      { id: "build", command: "bun run build", dependsOn: ["lint"] },
    ],
  });
}

/** Diamond graph: lint + test → build. */
export function makeDiamondGraph(trigger: Trigger = { kind: "manual" }): DefinitionGraph {
  return makeGraph({
    trigger,
    steps: [
      { id: "lint", command: "bun run lint" },
      { id: "test", command: "bun run test" },
      { id: "build", command: "bun run build", dependsOn: ["lint", "test"] },
    ],
  });
}

/** Assert that a compilation result has a diagnostic for the given capability. */
export function expectDiagnostic(
  diagnostics: ReadonlyArray<{ capability?: string }>,
  capability: string,
): void {
  if (!diagnostics.some((d) => d.capability === capability)) {
    throw new Error(`expected diagnostic for capability "${capability}"`);
  }
}

/** Step spec for a condition test: build + conditional step. */
export function conditionSteps(status: "failure" | "never" | "success" | "always"): StepSpec[] {
  if (status === "never" || status === "always") {
    return [{ id: "build", command: "echo hi", condition: { kind: "status", status } }];
  }
  return [
    { id: "build", command: "echo hi" },
    { id: "notify", command: "echo failed", condition: { kind: "status", status }, dependsOn: ["build"] },
  ];
}

/** Run condition test assertions on generated content. */
export function expectCondition(
  content: string,
  expectGuard: string,
  excludeGuard = "if (true)",
): void {
  expect(content).toContain(expectGuard);
  if (excludeGuard) expect(content).not.toContain(excludeGuard);
}

/** Standard matrix step used in compiler target tests. */
export function matrixStep(): StepSpec {
  return { id: "build", command: "echo hi", matrix: { dimensions: { node: ["18", "20"] } } };
}

/** Standard timeout step (30s) used in compiler target tests. */
export function timeoutStep(): StepSpec {
  return { id: "build", command: "echo hi", timeout: 30000 };
}
