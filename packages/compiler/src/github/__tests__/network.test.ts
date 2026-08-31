// Tests for network allowlist lowering in the GitHub target.
// Spec 26 — items 8, 9.

import { describe, it, expect } from "vitest";
import { Project, Pipeline, ShellStep, Entry, push } from "@sverka/workflow";
import { synthesize } from "@sverka/workflow";
import { GithubTarget } from "../target.js";
import { githubCapabilities } from "../capabilities.js";
import type { GithubTargetGraph } from "../types.js";

function singleGraph(result: GithubTargetGraph | readonly GithubTargetGraph[]): GithubTargetGraph {
  if ("jobs" in result) return result;
  return result[0]!;
}

describe("GitHub network allowlist annotation (Spec 26 items 8-9)", () => {
  it("item 8: step with network.allowed → job has comment annotation", () => {
    const project = new Project("gh-net-test");
    const pipeline = new Pipeline(project, "ci");
    new ShellStep(pipeline, "build", {
      command: "npm install",
      runtime: { mode: "host", network: { allowed: ["registry.npmjs.org", "github.com"] } },
    });
    new Entry(pipeline, "main", { trigger: push(), roots: ["build"] });

    const graph = synthesize(project);
    const target = new GithubTarget();
    const targetGraph = singleGraph(target.lower(graph));
    const job = targetGraph.jobs[0]!;
    const annotation = job.steps.find(
      (s) => s.name === "Sverka network allowlist",
    );
    expect(annotation).toBeDefined();
    expect(annotation!.run).toBe(
      'echo "# sverka:network-allowlist: registry.npmjs.org,github.com"',
    );
  });

  it("item 9: step without network → no annotation", () => {
    const project = new Project("gh-net-none");
    const pipeline = new Pipeline(project, "ci");
    new ShellStep(pipeline, "build", { command: "npm install" });
    new Entry(pipeline, "main", { trigger: push(), roots: ["build"] });

    const graph = synthesize(project);
    const target = new GithubTarget();
    const targetGraph = singleGraph(target.lower(graph));
    const job = targetGraph.jobs[0]!;
    const annotation = job.steps.find(
      (s) => s.name === "Sverka network allowlist",
    );
    expect(annotation).toBeUndefined();
  });

  it("item 12: runtime.network capability is emulated", () => {
    expect(githubCapabilities["runtime.network"]).toBe("emulated");
  });
});
