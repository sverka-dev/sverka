// Conformance test: SDK-authored pipeline must synthesize the same
// Definition Graph as the Construct API conformance seed.
// Spec 03 — Conformance. Architecture spec §33.1.

import { describe, it, expect } from "vitest";
import { Project, Pipeline, ShellStep, Entry, push } from "@sverka/workflow";
import { synthesize } from "@sverka/workflow";
import type { DefinitionGraph } from "@sverka/workflow";
import { $, artifact, pipelineV0 as pipeline } from "../index.js";

/** Build the conformance seed using the Construct API (same as Wave A test). */
function buildViaConstructAPI(): DefinitionGraph {
  const proj = new Project("myproj");
  const pip = new Pipeline(proj, "ci");

  new ShellStep(pip, "build", {
    command: "npm run build",
    outputs: {
      dist: { type: "artifact", path: "./dist" },
      version: { type: "string" },
    },
  });

  new ShellStep(pip, "test", {
    command: "npm test",
    inputs: [{ kind: "step", step: "build", output: "dist", type: "artifact" }],
    dependsOn: ["build"],
  });

  new ShellStep(pip, "deploy", {
    command: "deploy",
    inputs: [{ kind: "step", step: "build", output: "version", type: "string" }],
  });

  new Entry(pip, "on-push", {
    trigger: push(),
    roots: ["build"],
  });

  return synthesize(proj);
}

/** Build the same pipeline using the SDK composables. */
function buildViaSdkAPI(): DefinitionGraph {
  const proj = new Project("myproj");

  // Create references for interpolation — these match the Construct API inputs.
  const buildDistRef = { kind: "step" as const, step: "build", output: "dist", type: "artifact" as const };
  const buildVersionRef = { kind: "step" as const, step: "build", output: "version", type: "string" as const };

  pipeline(proj, "ci", {
    steps: [
      (pip) =>
        $`npm run build`
          .outputs({
            dist: artifact("./dist"),
            version: { type: "string" },
          })
          .build(pip, "build"),
      (pip) =>
        $`npm test`
          .inputs([buildDistRef])
          .dependsOn(["build"])
          .build(pip, "test"),
      (pip) =>
        $`deploy`
          .inputs([buildVersionRef])
          .build(pip, "deploy"),
    ],
    entries: [
      (pip) => new Entry(pip, "on-push", { trigger: push(), roots: ["build"] }),
    ],
  });

  return synthesize(proj);
}

describe("SDK conformance — same graph as Construct API", () => {
  it("produces identical Definition Graph structure", () => {
    const constructGraph = buildViaConstructAPI();
    const sdkGraph = buildViaSdkAPI();

    // Same project id.
    expect(sdkGraph.project.id).toBe(constructGraph.project.id);

    // Same number of pipelines.
    expect(sdkGraph.project.pipelines).toHaveLength(constructGraph.project.pipelines.length);

    const sdkPip = sdkGraph.project.pipelines[0]!;
    const constructPip = constructGraph.project.pipelines[0]!;

    // Same pipeline id.
    expect(sdkPip.id).toBe(constructPip.id);

    // Same number of steps.
    expect(sdkPip.steps).toHaveLength(constructPip.steps.length);

    // Verify each step matches.
    for (const constructStep of constructPip.steps) {
      const sdkStep = sdkPip.steps.find((s) => s.id === constructStep.id);
      expect(sdkStep).toBeDefined();
      expect(sdkStep!.operations).toEqual(constructStep.operations);
      expect(sdkStep!.dependencies).toEqual(constructStep.dependencies);
      expect(sdkStep!.inputs).toEqual(constructStep.inputs);
      expect(sdkStep!.outputs).toEqual(constructStep.outputs);
    }

    // Same entries.
    expect(sdkPip.entries).toHaveLength(constructPip.entries.length);
    for (const constructEntry of constructPip.entries) {
      const sdkEntry = sdkPip.entries.find((e) => e.id === constructEntry.id);
      expect(sdkEntry).toBeDefined();
      expect(sdkEntry!.trigger).toEqual(constructEntry.trigger);
      expect(sdkEntry!.roots).toEqual(constructEntry.roots);
    }
  });

  it("produces identical graph content (deterministic)", () => {
    const constructGraph = buildViaConstructAPI();
    const sdkGraph = buildViaSdkAPI();
    // Structural equality implies content-addressed IDs would match.
    expect(sdkGraph).toEqual(constructGraph);
  });
});
