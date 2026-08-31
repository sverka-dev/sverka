import { describe, it, expect } from "vitest";
import { parse } from "yaml";
import { Project, Pipeline, ShellStep, PagesStep, Entry } from "@sverka/workflow";
import { synthesize } from "@sverka/workflow";
import { compileGithub, githubCapabilities } from "../index.js";

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
  new ShellStep(p, "build", {
    command: "npm run build",
    permissions: { write: [] },
  });
  new Entry(p, "on-push", { trigger: { kind: "push" }, roots: ["build"] });
  return synthesize(proj);
}

function makeGraphWithPagesAndPermissions(): ReturnType<typeof synthesize> {
  const proj = new Project("test");
  const p = new Pipeline(proj, "ci");
  new PagesStep(p, "deploy-pages", {
    pages: { path: "./dist" },
    permissions: { write: [{ kind: "push", target: "main" }] },
  });
  new Entry(p, "on-push", { trigger: { kind: "push" }, roots: ["deploy-pages"] });
  return synthesize(proj);
}

describe("compileGithub — safe-outputs: step permissions (Spec 25)", () => {
  it("item 5: step with permissions.write pull-request → job permissions pull-requests: write", () => {
    const graph = makeGraphWithPermissions([
      { kind: "pull-request", target: "comment" },
    ]);
    const result = compileGithub(graph);
    const yaml = parse(result.artifacts[0]!.content);
    const job = yaml.jobs.deploy;
    expect(job.permissions).toBeDefined();
    expect(job.permissions["pull-requests"]).toBe("write");
  });

  it("item 5b: step with permissions.write deploy → job permissions deployments: write", () => {
    const graph = makeGraphWithPermissions([
      { kind: "deploy", target: "production" },
    ]);
    const result = compileGithub(graph);
    const yaml = parse(result.artifacts[0]!.content);
    const job = yaml.jobs.deploy;
    expect(job.permissions["deployments"]).toBe("write");
  });

  it("item 5c: step with permissions.write push → job permissions contents: write", () => {
    const graph = makeGraphWithPermissions([
      { kind: "push", target: "main" },
    ]);
    const result = compileGithub(graph);
    const yaml = parse(result.artifacts[0]!.content);
    const job = yaml.jobs.deploy;
    expect(job.permissions["contents"]).toBe("write");
  });

  it("item 5d: step with permissions.write comment → job permissions issues: write", () => {
    const graph = makeGraphWithPermissions([
      { kind: "comment", target: "pr" },
    ]);
    const result = compileGithub(graph);
    const yaml = parse(result.artifacts[0]!.content);
    const job = yaml.jobs.deploy;
    expect(job.permissions["issues"]).toBe("write");
  });

  it("item 5e: step with permissions.write id-token → job permissions id-token: write", () => {
    const graph = makeGraphWithPermissions([
      { kind: "id-token", target: "oidc" },
    ]);
    const result = compileGithub(graph);
    const yaml = parse(result.artifacts[0]!.content);
    const job = yaml.jobs.deploy;
    expect(job.permissions["id-token"]).toBe("write");
  });

  it("item 5f: step with permissions.write pages → job permissions pages: write", () => {
    const graph = makeGraphWithPermissions([
      { kind: "pages", target: "site" },
    ]);
    const result = compileGithub(graph);
    const yaml = parse(result.artifacts[0]!.content);
    const job = yaml.jobs.deploy;
    expect(job.permissions["pages"]).toBe("write");
  });

  it("item 6: step with no writes → job permissions: {} (read-only)", () => {
    const graph = makeGraphWithNoPermissions();
    const result = compileGithub(graph);
    const yaml = parse(result.artifacts[0]!.content);
    const job = yaml.jobs.build;
    expect(job.permissions).toBeDefined();
    expect(job.permissions).toEqual({});
  });

  it("item 7: step with unknown write kind foo → job permissions contents: read", () => {
    const graph = makeGraphWithPermissions([
      { kind: "foo", target: "bar" },
    ]);
    const result = compileGithub(graph);
    const yaml = parse(result.artifacts[0]!.content);
    const job = yaml.jobs.deploy;
    expect(job.permissions["contents"]).toBe("read");
  });

  it("item 8: step with deployPages AND permissions.write → deployPages permissions take precedence", () => {
    const graph = makeGraphWithPagesAndPermissions();
    const result = compileGithub(graph);
    const yaml = parse(result.artifacts[0]!.content);
    const job = yaml.jobs["deploy-pages"];
    // deployPages gets pages:write + id-token:write, NOT contents:write from push kind
    expect(job.permissions["pages"]).toBe("write");
    expect(job.permissions["id-token"]).toBe("write");
    // The push write kind should NOT override deployPages permissions
    expect(job.permissions["contents"]).toBeUndefined();
  });

  it("multiple write kinds → all mapped permissions present", () => {
    const graph = makeGraphWithPermissions([
      { kind: "pull-request", target: "comment" },
      { kind: "deploy", target: "production" },
    ]);
    const result = compileGithub(graph);
    const yaml = parse(result.artifacts[0]!.content);
    const job = yaml.jobs.deploy;
    expect(job.permissions["pull-requests"]).toBe("write");
    expect(job.permissions["deployments"]).toBe("write");
  });

  it("item 13: github capability manifest declares step.permissions: native", () => {
    expect(githubCapabilities["step.permissions"]).toBe("native");
  });
});
