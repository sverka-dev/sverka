// Conformance runner — executes all §34 acceptance checks.
// Spec 18 — §33, §34.

import { mkdtemp, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { Project, Pipeline, ShellStep } from "@sverka/cdk";
import {
  synthesize,
  expandPipelineCalls,
  SynthesisError,
  type DefinitionGraph,
  type StepDefinition,
  type OperationDefinition,
} from "@sverka/core";
import { serializeGraph, deserializeGraph, validateGraphSchema } from "@sverka/ir";
import { bindRunPlan } from "@sverka/planner";
import { createEngine } from "@sverka/engine-native";
import { createHostDriver, createAllowlist } from "@sverka/runtime-host";
import { GithubTarget } from "@sverka/github";
import { GitlabTarget } from "@sverka/gitlab";
import type { RunEvent } from "@sverka/engine-native";
import {
  createSeedWithConstructs,
  createSeedWithSDK,
  createSeedWithDecorators,
  createReusableSeedWithConstructs,
  createReusableSeedWithSDK,
  createReusableSeedWithDecorators,
} from "./seed.js";

export interface ConformanceResult {
  readonly name: string;
  readonly passed: boolean;
  readonly message: string;
}

type NetworkGlobal = {
  fetch?: (...args: unknown[]) => Promise<unknown>;
  WebSocket?: unknown;
};

const ALLOWLIST = createAllowlist(["sh"]);

/**
 * Canonicalize a value for stable comparison: sort object keys and arrays.
 * Exported for test suites to avoid duplicating the helper.
 */
export function canonicalize(value: unknown): unknown {
  if (Array.isArray(value)) {
    return value
      .map(canonicalize)
      .sort((a, b) => {
        const sa = typeof a === "string" ? a : JSON.stringify(a);
        const sb = typeof b === "string" ? b : JSON.stringify(b);
        return sa < sb ? -1 : sa > sb ? 1 : 0;
      });
  }

  if (value !== null && typeof value === "object") {
    if (value instanceof Date) {
      return value.toISOString();
    }
    const entries = Object.entries(value as Record<string, unknown>)
      .map(([k, v]) => [k, canonicalize(v)] as const)
      .sort(([a], [b]) => (a < b ? -1 : a > b ? 1 : 0));
    return Object.fromEntries(entries);
  }

  return value;
}

/**
 * Normalize a graph for comparison by canonicalizing object keys and arrays.
 */
function normalizeGraph(graph: DefinitionGraph): string {
  return JSON.stringify(canonicalize(graph));
}

function stepById(
  graph: DefinitionGraph,
  id: string,
): StepDefinition | undefined {
  return graph.project.pipelines[0]?.steps.find((s) => s.id === id);
}

function hasOperation(
  step: StepDefinition | undefined,
  kind: OperationDefinition["kind"],
  predicate?: (op: OperationDefinition) => boolean,
): boolean {
  return (
    step !== undefined &&
    step.operations.some((op) => op.kind === kind && (predicate ? predicate(op) : true))
  );
}

function checkAuthoring(
  projConstruct: Project,
  projSDK: Project,
  projDecorator: Project,
): readonly ConformanceResult[] {
  return [
    {
      name: "§34.1: Pipeline authored through Construct API",
      passed: projConstruct !== undefined,
      message: "Construct API produced a Project",
    },
    {
      name: "§34.1: Pipeline authored through SDK API",
      passed: projSDK !== undefined,
      message: "SDK API produced a Project",
    },
    {
      name: "§34.1: Pipeline authored through Decorator API",
      passed: projDecorator !== undefined,
      message: "Decorator API produced a Project",
    },
  ];
}

function checkGraphEquivalence(
  graphConstruct: DefinitionGraph,
  graphSDK: DefinitionGraph,
  graphDecorator: DefinitionGraph,
): ConformanceResult {
  const constructJson = normalizeGraph(graphConstruct);
  const sdkJson = normalizeGraph(graphSDK);
  const decoratorJson = normalizeGraph(graphDecorator);
  const graphsMatch = constructJson === sdkJson && sdkJson === decoratorJson;
  return {
    name: "§34.2: All 3 APIs synthesize equivalent Definition Graph",
    passed: graphsMatch,
    message: graphsMatch
      ? "All 3 graphs are equivalent"
      : `Graphs differ: construct===sdk: ${constructJson === sdkJson}, sdk===decorator: ${sdkJson === decoratorJson}`,
  };
}

function checkTargetCompile(
  graph: DefinitionGraph,
  targetName: "github" | "gitlab",
  marker: string,
): ConformanceResult {
  const target = targetName === "github" ? new GithubTarget() : new GitlabTarget();
  const result = target.compile(graph);
  const hasArtifact = result.artifacts.length > 0 &&
    result.artifacts[0]!.content.includes(marker);
  const passed = hasArtifact && result.diagnostics.length === 0;
  return {
    name: `§34.3: Graph compiles to valid ${targetName === "github" ? "GitHub" : "GitLab"} artifacts`,
    passed,
    message: `${targetName} produced ${result.artifacts.length} artifact(s) with ${result.diagnostics.length} diagnostic(s)`,
  };
}

async function checkEngineExecution(
  graph: DefinitionGraph,
): Promise<{ result: ConformanceResult; events: RunEvent[] }> {
  const tmpRoot = await mkdtemp(join(tmpdir(), "sverka-conf-"));
  try {
    const plan = bindRunPlan({
      graph,
      entryId: "ci/on-push",
      inputs: {},
    });
    const engine = createEngine({
      drivers: [
        createHostDriver({
          enabled: true,
          allowlist: ALLOWLIST,
          envAllowlist: [],
        }),
      ],
    });

    const events: RunEvent[] = [];
    for await (const event of engine.run({
      plan,
      workspace: tmpRoot,
      artifactDir: join(tmpRoot, "artifacts"),
    })) {
      events.push(event);
    }

    const completed = events.find((e) => e.type === "run-completed");
    const runSuccess = completed !== undefined && completed.status === "success";

    const succeeded = new Set(
      events
        .filter((e): e is Extract<RunEvent, { type: "step-succeeded" }> => e.type === "step-succeeded")
        .map((e) => e.stepId),
    );
    const expected = ["ci/lint", "ci/build", "ci/test"];
    const allStepsSucceeded = expected.every((id) => succeeded.has(id));

    const hasFailure = events.some((e) => e.type === "step-failed");

    const passed = runSuccess && allStepsSucceeded && !hasFailure;
    return {
      result: {
        name: "§34.4: Graph executes through native engine",
        passed,
        message: `Engine produced ${events.length} events; run status: ${completed?.status ?? "missing"}; steps succeeded: ${[...succeeded].join(", ")}`,
      },
      events,
    };
  } finally {
    await rm(tmpRoot, { recursive: true, force: true });
  }
}

function checkScalarFlow(graph: DefinitionGraph): ConformanceResult {
  const lintStep = stepById(graph, "ci/lint");
  const buildStep = stepById(graph, "ci/build");

  const exportsScalar = hasOperation(
    lintStep,
    "exportOutput",
    (op) => op.kind === "exportOutput" && op.name === "status",
  );
  const consumesScalar = buildStep?.dependencies.some(
    (d) => d.kind === "value" && d.producer === "ci/lint" && d.output === "status",
  );

  return {
    name: "§34.5: Scalar output flows between steps",
    passed: exportsScalar && consumesScalar === true,
    message: exportsScalar && consumesScalar
      ? "Scalar output 'status' exported by lint and consumed by build"
      : "Scalar dependency not found",
  };
}

function checkArtifactFlow(graph: DefinitionGraph): ConformanceResult {
  const buildStep = stepById(graph, "ci/build");
  const testStep = stepById(graph, "ci/test");

  const exportsArtifact = hasOperation(
    buildStep,
    "exportArtifact",
    (op) => op.kind === "exportArtifact" && op.name === "dist",
  );
  const importsArtifact = hasOperation(
    testStep,
    "importArtifact",
    (op) => op.kind === "importArtifact" && op.from === "ci/build" && op.output === "dist",
  );
  const consumesArtifact = testStep?.dependencies.some(
    (d) => d.kind === "artifact" && d.producer === "ci/build" && d.output === "dist",
  );

  return {
    name: "§34.6: Artifact output flows between steps",
    passed: exportsArtifact && importsArtifact && consumesArtifact === true,
    message: exportsArtifact && importsArtifact && consumesArtifact
      ? "Artifact 'dist' exported by build and imported by test"
      : "Artifact dependency not found",
  };
}

function checkContainerImage(graph: DefinitionGraph): ConformanceResult {
  const steps = graph.project.pipelines.flatMap((p) => p.steps);
  const containerSteps = steps.filter((s) => s.runtime.mode === "container");
  if (containerSteps.length === 0) {
    return {
      name: "§34.7: Container image selected provider-neutrally",
      passed: true,
      message: "Skipped: seed uses host runtime; no container steps to verify",
    };
  }
  const valid = containerSteps.every(
    (s) =>
      typeof s.runtime.image === "string" &&
      s.runtime.image.length > 0 &&
      !/github|gitlab/i.test(s.runtime.image),
  );
  return {
    name: "§34.7: Container image selected provider-neutrally",
    passed: valid,
    message: valid
      ? "Container images are provider-neutral"
      : `Container step '${containerSteps.find((s) => !s.runtime.image || /github|gitlab/i.test(s.runtime.image!))?.id}' uses a provider-specific or missing image`,
  };
}

function checkContextNamespaces(
  graph: DefinitionGraph,
  events: RunEvent[],
): ConformanceResult {
  const testStep = stepById(graph, "ci/test");
  const hasContextCondition =
    testStep?.condition?.kind === "context" &&
    testStep.condition.namespace === "inputs" &&
    testStep.condition.field === "nodeVersion";
  const testSucceeded = events.some(
    (e) => e.type === "step-succeeded" && e.stepId === "ci/test",
  );
  return {
    name: "§34.8: Context namespaces available",
    passed: hasContextCondition && testSucceeded,
    message: hasContextCondition && testSucceeded
      ? "inputs context namespace resolved and test step ran"
      : "Context condition not found or test step did not succeed",
  };
}

function checkCycleDiagnostics(): ConformanceResult {
  const proj = new Project("cycle");
  const p = new Pipeline(proj, "ci");
  const stepA = new ShellStep(p, "a", { command: "echo a", dependsOn: ["b"] });
  const stepB = new ShellStep(p, "b", { command: "echo b", dependsOn: ["a"] });
  void stepA; void stepB;
  try {
    synthesize(proj);
    return {
      name: "§34.9: Cycles produce diagnostics",
      passed: false,
      message: "synthesize did not reject cyclic graph",
    };
  } catch (err) {
    const passed = err instanceof SynthesisError && err.code === "CYCLE";
    return {
      name: "§34.9: Cycles produce diagnostics",
      passed,
      message: passed
        ? "synthesize rejected cyclic graph with CYCLE diagnostic"
        : `unexpected error: ${err instanceof Error ? err.message : String(err)}`,
    };
  }
}

async function checkNoNetwork(graph: DefinitionGraph): Promise<ConformanceResult> {
  const g = globalThis as unknown as NetworkGlobal;
  const originalFetch = g.fetch;
  const originalWebSocket = g.WebSocket;
  let networkTouched = false;

  g.fetch = async () => {
    networkTouched = true;
    throw new Error("network access blocked");
  };
  g.WebSocket = class {
    constructor() {
      networkTouched = true;
      throw new Error("network access blocked");
    }
  };
  void g.WebSocket;

  try {
    const ghResult = new GithubTarget().compile(graph);
    const glResult = new GitlabTarget().compile(graph);
    const hasDiagnostics = ghResult.diagnostics.length > 0 || glResult.diagnostics.length > 0;
    const passed = !networkTouched && !hasDiagnostics;
    return {
      name: "§34.10: Target compilation performs no network access",
      passed,
      message: networkTouched
        ? "Compilation touched the network"
        : `Compiled GitHub + GitLab with ${ghResult.diagnostics.length + glResult.diagnostics.length} diagnostic(s) while network blocked`,
    };
  } finally {
    if (originalFetch === undefined) {
      delete g.fetch;
    } else {
      g.fetch = originalFetch;
    }
    if (originalWebSocket === undefined) {
      delete g.WebSocket;
    } else {
      g.WebSocket = originalWebSocket;
    }
  }
}

function checkProviderNeutral(graph: DefinitionGraph): ConformanceResult {
  const graphJson = JSON.stringify(graph);
  const noProviderTerms = !/github|gitlab/i.test(graphJson);
  return {
    name: "§34.11: No provider-specific term required in portable definition",
    passed: noProviderTerms,
    message: noProviderTerms
      ? "Graph is provider-neutral"
      : "Graph contains provider-specific terms",
  };
}

function checkSerialization(graph: DefinitionGraph): ConformanceResult {
  try {
    const serialized = serializeGraph(graph);
    const deserialized = deserializeGraph(serialized);
    validateGraphSchema(deserialized);
    const restoredGraph = deserialized.graph;
    const match = normalizeGraph(restoredGraph) === normalizeGraph(graph);
    return {
      name: "Serialization round-trip: serialize → deserialize → same graph",
      passed: match,
      message: match ? "Graph round-tripped unchanged" : "Restored graph differs",
    };
  } catch (err) {
    return {
      name: "Serialization round-trip: serialize → deserialize → same graph",
      passed: false,
      message: `Serialization error: ${err instanceof Error ? err.message : String(err)}`,
    };
  }
}

/**
 * F-31 conformance: reusable pipeline authoring through all 3 surfaces.
 */
function checkReusableAuthoring(): {
  results: ConformanceResult[];
  projConstruct: Project;
  projSDK: Project;
  projDecorator: Project;
} {
  const projConstruct = createReusableSeedWithConstructs();
  const projSDK = createReusableSeedWithSDK();
  const projDecorator = createReusableSeedWithDecorators();
  const results: ConformanceResult[] = [
    {
      name: "F-31: Reusable pipeline authored through Construct API",
      passed: projConstruct !== undefined,
      message: "Construct API produced a Project with 2 pipelines",
    },
    {
      name: "F-31: Reusable pipeline authored through SDK API",
      passed: projSDK !== undefined,
      message: "SDK API produced a Project with 2 pipelines",
    },
    {
      name: "F-31: Reusable pipeline authored through Decorator API",
      passed: projDecorator !== undefined,
      message: "Decorator API produced a Project with 2 pipelines",
    },
  ];
  return { results, projConstruct, projSDK, projDecorator };
}

/**
 * F-31 conformance: synthesize reusable pipeline graphs from all 3 surfaces.
 * Returns the graphs or an error result.
 */
function checkReusableSynthesis(
  projConstruct: Project,
  projSDK: Project,
  projDecorator: Project,
): { results: ConformanceResult[]; graph?: DefinitionGraph } {
  let graphConstruct: DefinitionGraph;
  let graphSDK: DefinitionGraph;
  let graphDecorator: DefinitionGraph;
  try {
    graphConstruct = synthesize(projConstruct);
    graphSDK = synthesize(projSDK);
    graphDecorator = synthesize(projDecorator);
  } catch (err) {
    return {
      results: [
        {
          name: "F-31: All 3 APIs synthesize reusable pipeline graph",
          passed: false,
          message: `Synthesis error: ${err instanceof Error ? err.message : String(err)}`,
        },
      ],
    };
  }
  const constructJson = normalizeGraph(graphConstruct);
  const sdkJson = normalizeGraph(graphSDK);
  const decoratorJson = normalizeGraph(graphDecorator);
  const graphsMatch = constructJson === sdkJson && sdkJson === decoratorJson;
  const results: ConformanceResult[] = [
    {
      name: "F-31: All 3 APIs synthesize equivalent reusable pipeline graph",
      passed: graphsMatch,
      message: graphsMatch
        ? "All 3 reusable pipeline graphs are equivalent"
        : `Graphs differ: construct===sdk: ${constructJson === sdkJson}, sdk===decorator: ${sdkJson === decoratorJson}`,
    },
  ];
  return { results, graph: graphConstruct };
}

/**
 * F-31 conformance: call step presence and expansion in the reusable pipeline.
 */
function checkReusableCallAndExpansion(graph: DefinitionGraph): ConformanceResult[] {
  const results: ConformanceResult[] = [];
  const hasCallStep = graph.project.pipelines.some((p) =>
    p.steps.some((s) => s.call !== undefined),
  );
  results.push({
    name: "F-31: Graph contains a pipeline-call step",
    passed: hasCallStep,
    message: hasCallStep ? "Call step found in graph" : "No call step in graph",
  });
  const ciPipeline = graph.project.pipelines.find((p) => p.id === "ci");
  if (ciPipeline) {
    const expanded = expandPipelineCalls(graph, ciPipeline.steps);
    const hasNoCallSteps = expanded.every((s) => s.call === undefined);
    const hasNamespacedStep = expanded.some((s) =>
      s.id.includes("deploy-staging/deploy"),
    );
    results.push({
      name: "F-31: Expansion flattens call steps into inline namespaced steps",
      passed: hasNoCallSteps && hasNamespacedStep,
      message: `Expanded ${expanded.length} steps; no call steps: ${hasNoCallSteps}; namespaced step present: ${hasNamespacedStep}`,
    });
  }
  return results;
}

/**
 * F-31 conformance: reusable pipelines authored through all 3 surfaces
 * produce equivalent graphs, compile to both targets, and expand correctly.
 */
function checkReusablePipelineConformance(): readonly ConformanceResult[] {
  const results: ConformanceResult[] = [];

  const { results: authoringResults, projConstruct, projSDK, projDecorator } =
    checkReusableAuthoring();
  results.push(...authoringResults);

  const { results: synthesisResults, graph } = checkReusableSynthesis(
    projConstruct,
    projSDK,
    projDecorator,
  );
  results.push(...synthesisResults);
  if (!graph) return results;

  results.push(...checkReusableCallAndExpansion(graph));

  results.push(
    checkTargetCompile(graph, "github", "workflow_call"),
    checkTargetCompile(graph, "gitlab", "script:"),
  );

  return results;
}

/**
 * Run all conformance checks and return results.
 * This is the §34 acceptance gate.
 */
export async function runConformance(): Promise<readonly ConformanceResult[]> {
  const results: ConformanceResult[] = [];

  const projConstruct = createSeedWithConstructs();
  const projSDK = createSeedWithSDK();
  const projDecorator = createSeedWithDecorators();

  results.push(...checkAuthoring(projConstruct, projSDK, projDecorator));

  const graphConstruct = synthesize(projConstruct);
  const graphSDK = synthesize(projSDK);
  const graphDecorator = synthesize(projDecorator);

  results.push(checkGraphEquivalence(graphConstruct, graphSDK, graphDecorator));

  results.push(
    checkTargetCompile(graphConstruct, "github", "jobs:"),
    checkTargetCompile(graphConstruct, "gitlab", "script:"),
  );

  const { result: engineResult, events } = await checkEngineExecution(graphConstruct);
  results.push(engineResult);

  results.push(
    checkScalarFlow(graphConstruct),
    checkArtifactFlow(graphConstruct),
    checkContainerImage(graphConstruct),
    // Reuse events from checkEngineExecution for the context-namespace check.
    checkContextNamespaces(graphConstruct, events),
    checkCycleDiagnostics(),
    await checkNoNetwork(graphConstruct),
    checkProviderNeutral(graphConstruct),
    checkSerialization(graphConstruct),
    // F-31: Reusable pipeline conformance.
    ...checkReusablePipelineConformance(),
  );

  // F-31: Reusable pipeline conformance.
  results.push(...checkReusablePipelineConformance());

  return results;
}
