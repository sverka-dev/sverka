import { describe, it, expect } from "vitest";
import { parse } from "yaml";
import { Project, Pipeline, ShellStep, Entry } from "@sverka/workflow";
import { synthesize } from "@sverka/workflow";
import { compileGitlab, gitlabCapabilities } from "../index.js";

function makeGraphWithPermissions(
  writeDecls: readonly { kind: string; target: string; description?: string }[],
): ReturnType<typeof synthesize> {
  const proj = new Project("test");
  const p = new Pipeline(proj, "ci");
  new ShellStep(p, "deploy", {
    command: "deploy",
    permissions: { write: writeDecls },
  });
  new Entry(p, "on-push", { trigger: { kind: "push" }, roots: ["deploy"] });
  return synthesize(proj);
}

function makeGraphWithNoPermissions(): ReturnType<typeof synthesize> {
  const proj = new Project("test");
  const p = new Pipeline(proj, "ci");
  new ShellStep(p, "build", { command: "npm run build" });
  new Entry(p, "on-push", { trigger: { kind: "push" }, roots: ["build"] });
  return synthesize(proj);
}

describe("compileGitlab — safe-outputs: step permissions (Spec 25)", () => {
  it("item 9: step with permissions.write deploy → SV_WRITE_DEPLOY variable set", () => {
    const graph = makeGraphWithPermissions([
      { kind: "deploy", target: "production" },
    ]);
    const result = compileGitlab(graph);
    const yaml = parse(result.artifacts[0]!.content);
    const job = yaml.deploy;
    expect(job.variables).toBeDefined();
    expect(job.variables.SV_WRITE_DEPLOY).toBe("true");
  });

  it("item 9b: step with permissions.write pull-request → SV_WRITE_PULL_REQUEST variable set", () => {
    const graph = makeGraphWithPermissions([
      { kind: "pull-request", target: "comment" },
    ]);
    const result = compileGitlab(graph);
    const yaml = parse(result.artifacts[0]!.content);
    const job = yaml.deploy;
    expect(job.variables.SV_WRITE_PULL_REQUEST).toBe("true");
  });

  it("item 9c: multiple write kinds → all corresponding variables present", () => {
    const graph = makeGraphWithPermissions([
      { kind: "deploy", target: "production" },
      { kind: "comment", target: "pr" },
      { kind: "push", target: "main" },
    ]);
    const result = compileGitlab(graph);
    const yaml = parse(result.artifacts[0]!.content);
    const job = yaml.deploy;
    expect(job.variables.SV_WRITE_DEPLOY).toBe("true");
    expect(job.variables.SV_WRITE_COMMENT).toBe("true");
    expect(job.variables.SV_WRITE_PUSH).toBe("true");
  });

  it("item 9d: step with no writes → no SV_WRITE_* variables present", () => {
    const graph = makeGraphWithNoPermissions();
    const result = compileGitlab(graph);
    const yaml = parse(result.artifacts[0]!.content);
    const job = yaml.build;
    if (job.variables) {
      for (const key of Object.keys(job.variables)) {
        expect(key.startsWith("SV_WRITE_")).toBe(false);
      }
    }
  });

  it("step with permissions set but empty write array → no SV_WRITE_* variables", () => {
    const proj = new Project("test");
    const p = new Pipeline(proj, "ci");
    new ShellStep(p, "build", {
      command: "npm run build",
      permissions: { write: [] },
    });
    new Entry(p, "on-push", { trigger: { kind: "push" }, roots: ["build"] });
    const graph = synthesize(proj);
    const result = compileGitlab(graph);
    const yaml = parse(result.artifacts[0]!.content);
    const job = yaml.build;
    if (job.variables) {
      for (const key of Object.keys(job.variables)) {
        expect(key.startsWith("SV_WRITE_")).toBe(false);
      }
    }
  });

  it("item 13: gitlab capability manifest declares step.permissions: native", () => {
    expect(gitlabCapabilities["step.permissions"]).toBe("native");
  });
});
