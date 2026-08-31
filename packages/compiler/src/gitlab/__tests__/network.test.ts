// Tests for network allowlist lowering in the GitLab target.
// Spec 26 — items 10, 12.

import { describe, it, expect } from "vitest";
import { Project, Pipeline, ShellStep, Entry, push } from "@sverka/workflow";
import { synthesize } from "@sverka/workflow";
import { GitlabTarget } from "../target.js";
import { gitlabCapabilities } from "../capabilities.js";
import type { GitlabTargetGraph } from "../types.js";

function singleGraph(result: GitlabTargetGraph | readonly GitlabTargetGraph[]): GitlabTargetGraph {
  if ("jobs" in result) return result;
  return result[0]!;
}

describe("GitLab network allowlist variable (Spec 26 items 10, 12)", () => {
  it("item 10: step with network.allowed → job variables include SVERKA_NETWORK_ALLOWLIST", () => {
    const project = new Project("gl-net-test");
    const pipeline = new Pipeline(project, "ci");
    new ShellStep(pipeline, "build", {
      command: "npm install",
      runtime: { mode: "host", network: { allowed: ["registry.npmjs.org", "github.com"] } },
    });
    new Entry(pipeline, "main", { trigger: push(), roots: ["build"] });

    const graph = synthesize(project);
    const target = new GitlabTarget();
    const targetGraph = singleGraph(target.lower(graph));
    const job = targetGraph.jobs[0]!;
    expect(job.variables).toBeDefined();
    expect(job.variables!["SVERKA_NETWORK_ALLOWLIST"]).toBe("registry.npmjs.org,github.com");
  });

  it("step without network → no SVERKA_NETWORK_ALLOWLIST variable", () => {
    const project = new Project("gl-net-none");
    const pipeline = new Pipeline(project, "ci");
    new ShellStep(pipeline, "build", { command: "npm install" });
    new Entry(pipeline, "main", { trigger: push(), roots: ["build"] });

    const graph = synthesize(project);
    const target = new GitlabTarget();
    const targetGraph = singleGraph(target.lower(graph));
    const job = targetGraph.jobs[0]!;
    expect(job.variables?.["SVERKA_NETWORK_ALLOWLIST"]).toBeUndefined();
  });

  it("item 12: runtime.network capability is emulated", () => {
    expect(gitlabCapabilities["runtime.network"]).toBe("emulated");
  });
});
