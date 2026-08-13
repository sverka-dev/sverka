import { describe, it, expect, beforeEach, afterEach } from "vitest";
import { mkdtemp, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { parse } from "yaml";
import { synthesize } from "@sverka/core";
import { serializeGraph, deserializeGraph, validateGraphSchema } from "@sverka/ir";
import { bindRunPlan } from "@sverka/planner";
import { createEngine } from "@sverka/engine-native";
import { createHostDriver, createAllowlist } from "@sverka/runtime-host";
import { GithubTarget } from "@sverka/github";
import { GitlabTarget } from "@sverka/gitlab";
import { analyzeCapabilities } from "@sverka/plugin";
import { githubCapabilities } from "@sverka/github";
import { gitlabCapabilities } from "@sverka/gitlab";
import type { RunEvent } from "@sverka/engine-native";
import {
  createSeedWithConstructs,
  createSeedWithSDK,
  createSeedWithDecorators,
  runConformance,
  canonicalize,
} from "../index.js";

// Helper for host driver config — allow `sh` scripts used by the seed.
function makeDriver() {
  return createHostDriver({
    enabled: true,
    allowlist: createAllowlist(["sh"]),
    envAllowlist: [],
  });
}

// Normalize a graph for stable comparison.
function normalize(g: unknown): string {
  return JSON.stringify(canonicalize(g));
}

// §33.1 — Authoring conformance
describe("§33.1 Authoring conformance", () => {
  it("all 3 APIs produce the same Definition Graph", () => {
    const g1 = synthesize(createSeedWithConstructs());
    const g2 = synthesize(createSeedWithSDK());
    const g3 = synthesize(createSeedWithDecorators());

    expect(normalize(g1)).toEqual(normalize(g2));
    expect(normalize(g2)).toEqual(normalize(g3));
  });

  it("seed pipeline has 3 steps", () => {
    const graph = synthesize(createSeedWithConstructs());
    expect(graph.project.pipelines[0]?.steps).toHaveLength(3);
  });

  it("seed pipeline has 1 entry", () => {
    const graph = synthesize(createSeedWithConstructs());
    expect(graph.project.pipelines[0]?.entries).toHaveLength(1);
  });

  it("seed pipeline has push trigger", () => {
    const graph = synthesize(createSeedWithConstructs());
    expect(graph.project.pipelines[0]?.entries[0]?.trigger.kind).toBe("push");
  });

  it("seed pipeline has nodeVersion input", () => {
    const graph = synthesize(createSeedWithConstructs());
    expect(graph.project.pipelines[0]?.inputs.nodeVersion).toBeDefined();
    expect(graph.project.pipelines[0]?.inputs.nodeVersion?.default).toBe("22");
  });

  it("seed pipeline has scalar and artifact data flow", () => {
    const graph = synthesize(createSeedWithConstructs());
    const steps = graph.project.pipelines[0]!.steps;

    const lint = steps.find((s) => s.id === "ci/lint")!;
    const build = steps.find((s) => s.id === "ci/build")!;
    const test = steps.find((s) => s.id === "ci/test")!;

    expect(lint.operations.some((op) => op.kind === "exportOutput")).toBe(true);
    expect(
      build.dependencies.some(
        (d) => d.kind === "value" && d.producer === "ci/lint" && d.output === "status",
      ),
    ).toBe(true);

    expect(build.operations.some((op) => op.kind === "exportArtifact")).toBe(true);
    expect(
      test.dependencies.some(
        (d) => d.kind === "artifact" && d.producer === "ci/build" && d.output === "dist",
      ),
    ).toBe(true);
  });
});

// §33.2 — Target conformance
describe("§33.2 Target conformance", () => {
  it("GitHub lowering produces valid YAML with jobs", () => {
    const graph = synthesize(createSeedWithConstructs());
    const target = new GithubTarget();
    const targetGraph = target.lower(graph);
    const artifacts = target.emit(targetGraph);
    expect(artifacts).toHaveLength(1);
    const yaml = parse(artifacts[0]!.content) as Record<string, { jobs?: Record<string, unknown> }>;
    expect(yaml.jobs).toBeDefined();
    expect(Object.keys(yaml.jobs!)).toHaveLength(3);
  });

  it("GitLab lowering produces valid YAML with script", () => {
    const graph = synthesize(createSeedWithConstructs());
    const target = new GitlabTarget();
    const targetGraph = target.lower(graph);
    const artifacts = target.emit(targetGraph);
    expect(artifacts).toHaveLength(1);
    const yaml = parse(artifacts[0]!.content) as Record<string, { script?: unknown; stages?: unknown }>;
    expect(yaml.stages).toBeDefined();
    for (const jobId of Object.keys(yaml)) {
      if (jobId === "stages" || jobId === "variables") continue;
      expect(yaml[jobId]?.script).toBeDefined();
    }
  });

  it("GitHub lowering maps dependencies to needs", () => {
    const graph = synthesize(createSeedWithConstructs());
    const target = new GithubTarget();
    const targetGraph = target.lower(graph);
    const buildJob = targetGraph.jobs.find((j) => j.id === "build");
    expect(buildJob?.needs).toContain("lint");
  });

  it("GitLab lowering maps dependencies to needs", () => {
    const graph = synthesize(createSeedWithConstructs());
    const target = new GitlabTarget();
    const targetGraph = target.lower(graph);
    const buildJob = targetGraph.jobs.find((j) => j.id === "build");
    expect(buildJob?.needs).toContain("lint");
  });
});

// §33.3 — Engine conformance
describe("§33.3 Engine conformance", () => {
  let testDir: string;

  beforeEach(async () => {
    testDir = await mkdtemp(join(tmpdir(), "sverka-engine-"));
  });

  afterEach(async () => {
    await rm(testDir, { recursive: true, force: true });
  });

  it("native engine executes seed pipeline successfully", async () => {
    const graph = synthesize(createSeedWithConstructs());
    const plan = bindRunPlan({
      graph,
      entryId: "ci/on-push",
      inputs: {},
    });
    const engine = createEngine({
      drivers: [makeDriver()],
    });
    const events: RunEvent[] = [];
    for await (const event of engine.run({
      plan,
      workspace: testDir,
      artifactDir: join(testDir, "artifacts"),
    })) {
      events.push(event);
    }
    const completed = events.find((e) => e.type === "run-completed");
    expect(completed).toBeDefined();
    expect(completed!.status).toBe("success");

    for (const stepId of ["ci/lint", "ci/build", "ci/test"]) {
      expect(
        events.some((e) => e.type === "step-succeeded" && e.stepId === stepId),
      ).toBe(true);
    }
  });
});

// Full pipeline: Project → Graph → RunPlan → Engine → Events
describe("Full pipeline: Project → Graph → RunPlan → Engine → Events", () => {
  let testDir: string;

  beforeEach(async () => {
    testDir = await mkdtemp(join(tmpdir(), "sverka-e2e-"));
  });

  afterEach(async () => {
    await rm(testDir, { recursive: true, force: true });
  });

  it("end-to-end execution produces success events", async () => {
    const proj = createSeedWithConstructs();
    const graph = synthesize(proj);
    const plan = bindRunPlan({ graph, entryId: "ci/on-push", inputs: {} });
    const engine = createEngine({
      drivers: [makeDriver()],
    });
    const events: RunEvent[] = [];
    for await (const event of engine.run({
      plan,
      workspace: testDir,
      artifactDir: join(testDir, "artifacts"),
    })) {
      events.push(event);
    }
    expect(events.length).toBeGreaterThan(0);
    const completed = events.find((e) => e.type === "run-completed");
    expect(completed?.status).toBe("success");
  });
});

// Full compilation: Project → Graph → Target → YAML
describe("Full compilation: Project → Graph → Target → YAML", () => {
  it("end-to-end compilation produces YAML artifacts", () => {
    const proj = createSeedWithConstructs();
    const graph = synthesize(proj);

    const ghTarget = new GithubTarget();
    const ghArtifacts = ghTarget.emit(ghTarget.lower(graph));
    expect(ghArtifacts[0]?.content).toContain("jobs:");

    const glTarget = new GitlabTarget();
    const glArtifacts = glTarget.emit(glTarget.lower(graph));
    expect(glArtifacts[0]?.content).toContain("script:");
  });
});

// Serialization round-trip
describe("Serialization round-trip", () => {
  it("serialize → deserialize → same graph", () => {
    const graph = synthesize(createSeedWithConstructs());
    const json = serializeGraph(graph);
    const restored = deserializeGraph(json);
    validateGraphSchema(restored);
    expect(normalize(restored.graph)).toEqual(normalize(graph));
  });
});

// Capability conformance
describe("§33.4 Capability conformance", () => {
  it("seed pipeline has no capability diagnostics", () => {
    const graph = synthesize(createSeedWithConstructs());
    const diags = analyzeCapabilities(graph, [githubCapabilities, gitlabCapabilities]);
    expect(diags).toHaveLength(0);
  });
});

// §34 acceptance gate
describe("§34 Acceptance gate — runConformance", () => {
  it("all conformance checks pass", async () => {
    const results = await runConformance();
    const failures = results.filter((r) => !r.passed);
    for (const r of results) {
      expect(r.passed).toBe(true);
    }
    expect(failures).toHaveLength(0);
  });

  it("conformance covers all §34 criteria", async () => {
    const results = await runConformance();
    for (const criterion of [
      "§34.1",
      "§34.2",
      "§34.3",
      "§34.4",
      "§34.5",
      "§34.6",
      "§34.7",
      "§34.8",
      "§34.9",
      "§34.10",
      "§34.11",
    ]) {
      expect(
        results.some((r) => r.name.startsWith(criterion)),
        `missing conformance criterion: ${criterion} (got: ${results.map((r) => r.name).join(", ")})`,
      ).toBe(true);
    }
    expect(
      results.some((r) => r.name.startsWith("Serialization round-trip")),
    ).toBe(true);
  });
});
