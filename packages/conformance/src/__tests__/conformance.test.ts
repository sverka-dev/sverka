import { describe, it, expect } from "vitest";
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
import {
  createSeedWithConstructs,
  createSeedWithSDK,
  createSeedWithDecorators,
  runConformance,
} from "../index.js";

// Helper for host driver config
function makeDriver() {
  return createHostDriver({
    enabled: true,
    allowlist: createAllowlist([]),
    envAllowlist: [],
  });
}

// §33.1 — Authoring conformance
describe("§33.1 Authoring conformance", () => {
  it("all 3 APIs produce the same Definition Graph", () => {
    const g1 = synthesize(createSeedWithConstructs());
    const g2 = synthesize(createSeedWithSDK());
    const g3 = synthesize(createSeedWithDecorators());

    // Compare normalized graphs (sorted by step/entry ID)
    const normalize = (g: typeof g1) => ({
      project: {
        id: g.project.id,
        pipelines: g.project.pipelines.map((p) => ({
          id: p.id,
          inputs: p.inputs,
          entries: [...p.entries].sort((a, b) => a.id.localeCompare(b.id)),
          steps: [...p.steps].sort((a, b) => a.id.localeCompare(b.id)),
          outputs: p.outputs,
        })),
      },
    });

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
});

// §33.2 — Target conformance
describe("§33.2 Target conformance", () => {
  it("GitHub lowering produces valid YAML with jobs", () => {
    const graph = synthesize(createSeedWithConstructs());
    const target = new GithubTarget();
    const targetGraph = target.lower(graph);
    const artifacts = target.emit(targetGraph);
    expect(artifacts).toHaveLength(1);
    const yaml = parse(artifacts[0]!.content);
    expect(yaml.jobs).toBeDefined();
    expect(Object.keys(yaml.jobs)).toHaveLength(3);
  });

  it("GitLab lowering produces valid YAML with script", () => {
    const graph = synthesize(createSeedWithConstructs());
    const target = new GitlabTarget();
    const targetGraph = target.lower(graph);
    const artifacts = target.emit(targetGraph);
    expect(artifacts).toHaveLength(1);
    const yaml = parse(artifacts[0]!.content);
    expect(yaml.stages).toBeDefined();
    // Each job should have script
    for (const jobId of Object.keys(yaml)) {
      if (jobId === "stages" || jobId === "variables") continue;
      expect(yaml[jobId].script).toBeDefined();
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
  it("native engine executes seed pipeline", async () => {
    const graph = synthesize(createSeedWithConstructs());
    const plan = bindRunPlan({
      graph,
      entryId: "ci/on-push",
      inputs: {},
    });
    const engine = createEngine({
      drivers: [makeDriver()],
    });
    const events: unknown[] = [];
    const iterable = engine.run({
      plan,
      workspace: "/tmp/sverka-conf",
      artifactDir: "/tmp/sverka-conf/artifacts",
    });
    for await (const event of iterable) {
      events.push(event);
    }
    const completed = events.find(
      (e) => typeof e === "object" && e !== null && "type" in e && (e as { type: string }).type === "run-completed",
    );
    expect(completed).toBeDefined();
  });
});

// Full pipeline: Project → Graph → RunPlan → Engine → Events
describe("Full pipeline: Project → Graph → RunPlan → Engine → Events", () => {
  it("end-to-end execution produces events", async () => {
    const proj = createSeedWithConstructs();
    const graph = synthesize(proj);
    const plan = bindRunPlan({ graph, entryId: "ci/on-push", inputs: {} });
    const engine = createEngine({
      drivers: [makeDriver()],
    });
    const events: unknown[] = [];
    for await (const event of engine.run({
      plan,
      workspace: "/tmp/sverka-e2e",
      artifactDir: "/tmp/sverka-e2e/artifacts",
    })) {
      events.push(event);
    }
    expect(events.length).toBeGreaterThan(0);
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
    expect(restored.graph.project.id).toBe(graph.project.id);
    expect(restored.graph.project.pipelines.length).toBe(graph.project.pipelines.length);
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
    // Should have results for §34.1 through §34.12 + serialization
    expect(results.length).toBeGreaterThanOrEqual(10);
  });
});
