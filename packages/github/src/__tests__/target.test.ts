import { describe, it, expect } from "vitest";
import { parse } from "yaml";
import { Project, Pipeline, ShellStep, PipelineCallStep, ComponentStep, ChildPipelineStep, DownstreamStep, ReleaseStep, PagesStep, Entry } from "@sverka/cdk";
import { synthesize, type DefinitionGraph } from "@sverka/core";
import {
  GithubTarget,
  compileGithub,
  GithubTargetError,
  type GithubTargetGraph,
  type GithubJob,
} from "../index.js";

function makeSimpleGraph(): ReturnType<typeof synthesize> {
  const proj = new Project("test");
  const p = new Pipeline(proj, "ci");
  new ShellStep(p, "build", { command: "npm run build" });
  new Entry(p, "on-push", { trigger: { kind: "push" }, roots: ["build"] });
  return synthesize(proj);
}

function makeGraphWithDeps(): ReturnType<typeof synthesize> {
  const proj = new Project("test");
  const p = new Pipeline(proj, "ci");
  new ShellStep(p, "lint", { command: "npm run lint" });
  new ShellStep(p, "build", {
    command: "npm run build",
    dependsOn: ["lint"],
  });
  new Entry(p, "on-push", { trigger: { kind: "push" }, roots: ["build"] });
  return synthesize(proj);
}

describe("compileGithub — basic", () => {
  it("produces one YAML artifact", () => {
    const graph = makeSimpleGraph();
    const result = compileGithub(graph);
    expect(result.artifacts).toHaveLength(1);
    expect(result.artifacts[0]?.path).toBe(".github/workflows/ci.yml");
    expect(result.artifacts[0]?.content).toContain("name: ci");
  });

  it("produces valid YAML", () => {
    const graph = makeSimpleGraph();
    const result = compileGithub(graph);
    const yaml = parse(result.artifacts[0]!.content);
    expect(yaml.name).toBe("ci");
    expect(yaml.jobs).toBeDefined();
  });
});

describe("compileGithub — shell operations", () => {
  it("maps shell operation to run step", () => {
    const graph = makeSimpleGraph();
    const result = compileGithub(graph);
    const yaml = parse(result.artifacts[0]!.content);
    const buildJob = yaml.jobs.build;
    expect(buildJob).toBeDefined();
    const runStep = buildJob.steps.find((s: { run?: string }) => s.run);
    expect(runStep).toBeDefined();
    expect(runStep.run).toBe("npm run build");
  });
});

describe("compileGithub — dependencies", () => {
  it("maps step dependencies to job needs", () => {
    const graph = makeGraphWithDeps();
    const result = compileGithub(graph);
    const yaml = parse(result.artifacts[0]!.content);
    const buildJob = yaml.jobs.build;
    expect(buildJob.needs).toBe("lint");
  });

  it("maps multiple dependencies to needs array", () => {
    const proj = new Project("test");
    const p = new Pipeline(proj, "ci");
    new ShellStep(p, "lint", { command: "npm run lint" });
    new ShellStep(p, "test", { command: "npm run test" });
    new ShellStep(p, "build", {
      command: "npm run build",
      dependsOn: ["lint", "test"],
    });
    new Entry(p, "on-push", { trigger: { kind: "push" }, roots: ["build"] });
    const result = compileGithub(synthesize(proj));
    const yaml = parse(result.artifacts[0]!.content);
    expect(yaml.jobs.build.needs).toEqual(["lint", "test"]);
  });
});

describe("compileGithub — trigger mapping", () => {
  it("maps push trigger", () => {
    const proj = new Project("test");
    const p = new Pipeline(proj, "ci");
    new ShellStep(p, "build", { command: "echo hi" });
    new Entry(p, "on-push", { trigger: { kind: "push" }, roots: ["build"] });
    const result = compileGithub(synthesize(proj));
    const yaml = parse(result.artifacts[0]!.content);
    expect(yaml.on.push).toBeDefined();
  });

  it("maps changeRequest trigger to pull_request", () => {
    const proj = new Project("test");
    const p = new Pipeline(proj, "ci");
    new ShellStep(p, "build", { command: "echo hi" });
    new Entry(p, "on-pr", { trigger: { kind: "changeRequest" }, roots: ["build"] });
    const result = compileGithub(synthesize(proj));
    const yaml = parse(result.artifacts[0]!.content);
    expect(yaml.on.pull_request).toBeDefined();
  });

  it("maps manual trigger to workflow_dispatch", () => {
    const proj = new Project("test");
    const p = new Pipeline(proj, "ci");
    new ShellStep(p, "build", { command: "echo hi" });
    new Entry(p, "on-manual", { trigger: { kind: "manual" }, roots: ["build"] });
    const result = compileGithub(synthesize(proj));
    const yaml = parse(result.artifacts[0]!.content);
    expect(yaml.on.workflow_dispatch).toBeNull();
  });

  it("maps multiple triggers", () => {
    const proj = new Project("test");
    const p = new Pipeline(proj, "ci");
    new ShellStep(p, "build", { command: "echo hi" });
    new Entry(p, "on-push", { trigger: { kind: "push" }, roots: ["build"] });
    new Entry(p, "on-pr", { trigger: { kind: "changeRequest" }, roots: ["build"] });
    const result = compileGithub(synthesize(proj));
    const yaml = parse(result.artifacts[0]!.content);
    expect(yaml.on.push).toBeDefined();
    expect(yaml.on.pull_request).toBeDefined();
  });
});

describe("compileGithub — runtime mapping", () => {
  it("host runtime → ubuntu-latest", () => {
    const proj = new Project("test");
    const p = new Pipeline(proj, "ci");
    new ShellStep(p, "build", { command: "echo", runtime: { mode: "host" } });
    new Entry(p, "on-push", { trigger: { kind: "push" }, roots: ["build"] });
    const result = compileGithub(synthesize(proj));
    const yaml = parse(result.artifacts[0]!.content);
    expect(yaml.jobs.build["runs-on"]).toBe("ubuntu-latest");
  });

  it("container runtime → container field", () => {
    const proj = new Project("test");
    const p = new Pipeline(proj, "ci");
    new ShellStep(p, "build", {
      command: "echo",
      runtime: { mode: "container", image: "node:22" },
    });
    new Entry(p, "on-push", { trigger: { kind: "push" }, roots: ["build"] });
    const result = compileGithub(synthesize(proj));
    const yaml = parse(result.artifacts[0]!.content);
    expect(yaml.jobs.build.container).toBe("node:22");
  });
});

describe("compileGithub — timeout", () => {
  it("maps timeout to timeout-minutes", () => {
    const proj = new Project("test");
    const p = new Pipeline(proj, "ci");
    new ShellStep(p, "build", { command: "echo", timeout: 600000 });
    new Entry(p, "on-push", { trigger: { kind: "push" }, roots: ["build"] });
    const result = compileGithub(synthesize(proj));
    const yaml = parse(result.artifacts[0]!.content);
    expect(yaml.jobs.build["timeout-minutes"]).toBe(10);
  });
});

describe("compileGithub — deterministic output", () => {
  it("same graph produces same YAML", () => {
    const g1 = makeSimpleGraph();
    const g2 = makeSimpleGraph();
    const r1 = compileGithub(g1);
    const r2 = compileGithub(g2);
    expect(r1.artifacts[0]?.content).toBe(r2.artifacts[0]?.content);
  });
});

describe("GithubTarget — analyze", () => {
  it("no diagnostics for all-native graph", () => {
    const graph = makeSimpleGraph();
    const target = new GithubTarget();
    const diags = target.analyze(graph);
    expect(diags).toHaveLength(0);
  });

  it("warning diagnostic for interruptible step (partial support)", () => {
    const proj = new Project("test");
    const p = new Pipeline(proj, "ci");
    new ShellStep(p, "build", { command: "echo", interruptible: true });
    new Entry(p, "on-push", { trigger: { kind: "push" }, roots: ["build"] });
    const target = new GithubTarget();
    const diags = target.analyze(synthesize(proj));
    const interruptibleDiag = diags.find((d) => d.capability === "concurrency.interruptible");
    expect(interruptibleDiag).toBeDefined();
    expect(interruptibleDiag?.support).toBe("partial");
    expect(interruptibleDiag?.severity).toBe("warning");
  });

  it("no interruptible diagnostic when step is not interruptible", () => {
    const graph = makeSimpleGraph();
    const target = new GithubTarget();
    const diags = target.analyze(graph);
    expect(diags.find((d) => d.capability === "concurrency.interruptible")).toBeUndefined();
  });
});

describe("compileGithub — interruptible", () => {
  it("does not emit per-job interruptible field (GitHub has no such construct)", () => {
    const proj = new Project("test");
    const p = new Pipeline(proj, "ci");
    new ShellStep(p, "build", { command: "echo", interruptible: true });
    new Entry(p, "on-push", { trigger: { kind: "push" }, roots: ["build"] });
    const result = compileGithub(synthesize(proj));
    const yaml = parse(result.artifacts[0]!.content);
    // GitHub has no per-job interruptible; the field is silently dropped.
    expect(yaml.jobs.build.interruptible).toBeUndefined();
    // No concurrency block is emitted (that is F-28's surface).
    expect(yaml.concurrency).toBeUndefined();
  });
});

describe("compileGithub — permissions", () => {
  it("emits permissions: map at workflow level", () => {
    const proj = new Project("test");
    const p = new Pipeline(proj, "ci", {
      permissions: { contents: "read", "id-token": "write" },
    });
    new ShellStep(p, "build", { command: "echo" });
    new Entry(p, "on-push", { trigger: { kind: "push" }, roots: ["build"] });
    const result = compileGithub(synthesize(proj));
    const yaml = parse(result.artifacts[0]!.content);
    expect(yaml.permissions).toBeDefined();
    expect(yaml.permissions.contents).toBe("read");
    expect(yaml.permissions["id-token"]).toBe("write");
  });

  it("omits permissions key when not set", () => {
    const graph = makeSimpleGraph();
    const result = compileGithub(graph);
    const yaml = parse(result.artifacts[0]!.content);
    expect(yaml.permissions).toBeUndefined();
  });
});

describe("compileGithub — defaults", () => {
  it("emits defaults.run with shell and working-directory", () => {
    const proj = new Project("test");
    const p = new Pipeline(proj, "ci", {
      defaults: { shell: "bash", workdir: "./src" },
    });
    new ShellStep(p, "build", { command: "echo" });
    new Entry(p, "on-push", { trigger: { kind: "push" }, roots: ["build"] });
    const result = compileGithub(synthesize(proj));
    const yaml = parse(result.artifacts[0]!.content);
    expect(yaml.defaults).toBeDefined();
    expect(yaml.defaults.run.shell).toBe("bash");
    expect(yaml.defaults.run["working-directory"]).toBe("./src");
  });

  it("omits defaults when not set", () => {
    const graph = makeSimpleGraph();
    const result = compileGithub(graph);
    const yaml = parse(result.artifacts[0]!.content);
    expect(yaml.defaults).toBeUndefined();
  });
});

describe("compileGithub — runner", () => {
  it("emits runs-on as string for single label", () => {
    const proj = new Project("test");
    const p = new Pipeline(proj, "ci");
    new ShellStep(p, "build", { command: "echo", runner: { labels: ["ubuntu-latest"] } });
    new Entry(p, "on-push", { trigger: { kind: "push" }, roots: ["build"] });
    const result = compileGithub(synthesize(proj));
    const yaml = parse(result.artifacts[0]!.content);
    expect(yaml.jobs.build["runs-on"]).toBe("ubuntu-latest");
  });

  it("emits runs-on as array for multiple labels", () => {
    const proj = new Project("test");
    const p = new Pipeline(proj, "ci");
    new ShellStep(p, "build", { command: "echo", runner: { labels: ["self-hosted", "linux"] } });
    new Entry(p, "on-push", { trigger: { kind: "push" }, roots: ["build"] });
    const result = compileGithub(synthesize(proj));
    const yaml = parse(result.artifacts[0]!.content);
    expect(yaml.jobs.build["runs-on"]).toEqual(["self-hosted", "linux"]);
  });

  it("emits runs-on as object with group and labels", () => {
    const proj = new Project("test");
    const p = new Pipeline(proj, "ci");
    new ShellStep(p, "build", {
      command: "echo",
      runner: { labels: ["self-hosted", "linux"], group: "my-group" },
    });
    new Entry(p, "on-push", { trigger: { kind: "push" }, roots: ["build"] });
    const result = compileGithub(synthesize(proj));
    const yaml = parse(result.artifacts[0]!.content);
    expect(yaml.jobs.build["runs-on"]).toEqual({
      group: "my-group",
      labels: ["self-hosted", "linux"],
    });
  });

  it("defaults to ubuntu-latest when no runner specified", () => {
    const graph = makeSimpleGraph();
    const result = compileGithub(graph);
    const yaml = parse(result.artifacts[0]!.content);
    expect(yaml.jobs.build["runs-on"]).toBe("ubuntu-latest");
  });
});

describe("compileGithub — identity (OIDC)", () => {
  it("emits job-level permissions with id-token: write", () => {
    const proj = new Project("test");
    const p = new Pipeline(proj, "ci");
    new ShellStep(p, "deploy", {
      command: "deploy",
      identity: { tokens: { AWS_TOKEN: { audience: "https://sts.amazonaws.com" } } },
    });
    new Entry(p, "on-push", { trigger: { kind: "push" }, roots: ["deploy"] });
    const result = compileGithub(synthesize(proj));
    const yaml = parse(result.artifacts[0]!.content);
    expect(yaml.jobs.deploy.permissions).toBeDefined();
    expect(yaml.jobs.deploy.permissions["id-token"]).toBe("write");
  });

  it("emits error diagnostic for multiAudience (unsupported on GitHub)", () => {
    const proj = new Project("test");
    const p = new Pipeline(proj, "ci");
    new ShellStep(p, "deploy", {
      command: "deploy",
      identity: {
        tokens: {
          AWS: { audience: "https://sts.amazonaws.com" },
          VAULT: { audience: "https://vault.example.com" },
        },
      },
    });
    new Entry(p, "on-push", { trigger: { kind: "push" }, roots: ["deploy"] });
    const target = new GithubTarget();
    const diags = target.analyze(synthesize(proj));
    const multiDiag = diags.find((d) => d.capability === "secrets.oidc.multiAudience");
    expect(multiDiag).toBeDefined();
    expect(multiDiag?.support).toBe("unsupported");
    expect(multiDiag?.severity).toBe("error");
  });

  it("omits job-level permissions when no identity", () => {
    const graph = makeSimpleGraph();
    const result = compileGithub(graph);
    const yaml = parse(result.artifacts[0]!.content);
    expect(yaml.jobs.build.permissions).toBeUndefined();
  });
});

describe("compileGithub — rules", () => {
  it("emits if: from first rule with if expression", () => {
    const proj = new Project("test");
    const p = new Pipeline(proj, "ci");
    new ShellStep(p, "build", {
      command: "echo",
      rules: [{ if: "github.ref == 'refs/heads/main'", changes: ["src/**"] }],
    });
    new Entry(p, "on-push", { trigger: { kind: "push" }, roots: ["build"] });
    const result = compileGithub(synthesize(proj));
    const yaml = parse(result.artifacts[0]!.content);
    expect(yaml.jobs.build.if).toBe("github.ref == 'refs/heads/main'");
  });

  it("emits if: false when first rule has when: never", () => {
    const proj = new Project("test");
    const p = new Pipeline(proj, "ci");
    new ShellStep(p, "build", {
      command: "echo",
      rules: [{ when: "never" }],
    });
    new Entry(p, "on-push", { trigger: { kind: "push" }, roots: ["build"] });
    const result = compileGithub(synthesize(proj));
    const yaml = parse(result.artifacts[0]!.content);
    expect(yaml.jobs.build.if).toBe("${{ false }}");
  });

  it("omits if: when no rules", () => {
    const graph = makeSimpleGraph();
    const result = compileGithub(graph);
    const yaml = parse(result.artifacts[0]!.content);
    expect(yaml.jobs.build.if).toBeUndefined();
  });

  it("emits error diagnostic for changes (unsupported on GitHub)", () => {
    const proj = new Project("test");
    const p = new Pipeline(proj, "ci");
    new ShellStep(p, "build", {
      command: "echo",
      rules: [{ if: "true", changes: ["src/**"] }],
    });
    new Entry(p, "on-push", { trigger: { kind: "push" }, roots: ["build"] });
    const target = new GithubTarget();
    const diags = target.analyze(synthesize(proj));
    const changesDiag = diags.find((d) => d.capability === "workflow.rules.changes");
    expect(changesDiag).toBeDefined();
    expect(changesDiag?.support).toBe("unsupported");
  });
});

describe("compileGithub — reports", () => {
  it("emits dorny/test-reporter for junit reports", () => {
    const proj = new Project("test");
    const p = new Pipeline(proj, "ci");
    new ShellStep(p, "test", {
      command: "make test",
      reports: [{ type: "junit", path: "test-results.xml" }],
    });
    new Entry(p, "on-push", { trigger: { kind: "push" }, roots: ["test"] });
    const result = compileGithub(synthesize(proj));
    const yaml = parse(result.artifacts[0]!.content);
    const steps = yaml.jobs.test.steps as Record<string, unknown>[];
    const reportStep = steps.find((s) => s.uses === "dorny/test-reporter@v1");
    expect(reportStep).toBeDefined();
    expect(reportStep?.with).toMatchObject({ path: "test-results.xml" });
  });

  it("emits upload-sarif for sarif reports", () => {
    const proj = new Project("test");
    const p = new Pipeline(proj, "ci");
    new ShellStep(p, "scan", {
      command: "echo scan",
      reports: [{ type: "sarif", path: "results.sarif" }],
    });
    new Entry(p, "on-push", { trigger: { kind: "push" }, roots: ["scan"] });
    const result = compileGithub(synthesize(proj));
    const yaml = parse(result.artifacts[0]!.content);
    const steps = yaml.jobs.scan.steps as Record<string, unknown>[];
    const reportStep = steps.find((s) => s.uses === "github/codeql-action/upload-sarif@v3");
    expect(reportStep).toBeDefined();
    expect(reportStep?.with).toMatchObject({ sarif_file: "results.sarif" });
  });

  it("emits upload-artifact for unknown report types", () => {
    const proj = new Project("test");
    const p = new Pipeline(proj, "ci");
    new ShellStep(p, "perf", {
      command: "echo perf",
      reports: [{ type: "performance", path: "perf.json" }],
    });
    new Entry(p, "on-push", { trigger: { kind: "push" }, roots: ["perf"] });
    const result = compileGithub(synthesize(proj));
    const yaml = parse(result.artifacts[0]!.content);
    const steps = yaml.jobs.perf.steps as Record<string, unknown>[];
    const reportStep = steps.find((s) => s.uses === "actions/upload-artifact@v4");
    expect(reportStep).toBeDefined();
  });
});

describe("compileGithub — typed inputs", () => {
  it("emits workflow_dispatch.inputs for manual trigger with inputs", () => {
    const proj = new Project("test");
    const p = new Pipeline(proj, "ci", {
      inputs: {
        environment: {
          type: "choice",
          options: ["staging", "production"],
          required: true,
          description: "Deployment environment",
        },
        debug: { type: "boolean", default: false },
      },
    });
    new ShellStep(p, "build", { command: "echo" });
    new Entry(p, "on-manual", { trigger: { kind: "manual" }, roots: ["build"] });
    const result = compileGithub(synthesize(proj));
    const yaml = parse(result.artifacts[0]!.content);
    expect(yaml.on.workflow_dispatch).toBeDefined();
    expect(yaml.on.workflow_dispatch.inputs).toBeDefined();
    expect(yaml.on.workflow_dispatch.inputs.environment.type).toBe("choice");
    expect(yaml.on.workflow_dispatch.inputs.environment.options).toEqual(["staging", "production"]);
    expect(yaml.on.workflow_dispatch.inputs.debug.type).toBe("boolean");
  });

  it("emits error diagnostic for array input (unsupported on GitHub)", () => {
    const proj = new Project("test");
    const p = new Pipeline(proj, "ci", {
      inputs: { targets: { type: "array" } },
    });
    new ShellStep(p, "build", { command: "echo" });
    new Entry(p, "on-manual", { trigger: { kind: "manual" }, roots: ["build"] });
    const target = new GithubTarget();
    const diags = target.analyze(synthesize(proj));
    const arrayDiag = diags.find((d) => d.capability === "workflow.inputs.array");
    expect(arrayDiag).toBeDefined();
    expect(arrayDiag?.support).toBe("unsupported");
  });
});

describe("compileGithub — services", () => {
  it("emits services map keyed by name", () => {
    const proj = new Project("test");
    const p = new Pipeline(proj, "ci");
    new ShellStep(p, "test", {
      command: "make test",
      services: [
        { name: "postgres", image: "postgres:16", env: { POSTGRES_PASSWORD: "secret" }, ports: [5432] },
        { name: "redis", image: "redis:7", ports: [6379] },
      ],
    });
    new Entry(p, "on-push", { trigger: { kind: "push" }, roots: ["test"] });
    const result = compileGithub(synthesize(proj));
    const yaml = parse(result.artifacts[0]!.content);
    expect(yaml.jobs.test.services).toBeDefined();
    expect(yaml.jobs.test.services.postgres.image).toBe("postgres:16");
    expect(yaml.jobs.test.services.postgres.env.POSTGRES_PASSWORD).toBe("secret");
    expect(yaml.jobs.test.services.postgres.ports).toEqual(["5432:5432"]);
    expect(yaml.jobs.test.services.redis.image).toBe("redis:7");
  });

  it("omits services when not set", () => {
    const proj = new Project("test");
    const p = new Pipeline(proj, "ci");
    new ShellStep(p, "build", { command: "echo" });
    new Entry(p, "on-push", { trigger: { kind: "push" }, roots: ["build"] });
    const result = compileGithub(synthesize(proj));
    const yaml = parse(result.artifacts[0]!.content);
    expect(yaml.jobs.build.services).toBeUndefined();
  });
});

describe("compileGithub — environment", () => {
  it("emits environment with name and url", () => {
    const proj = new Project("test");
    const p = new Pipeline(proj, "ci");
    new ShellStep(p, "deploy", {
      command: "deploy",
      environment: { name: "production", url: "https://app.example.com" },
    });
    new Entry(p, "on-push", { trigger: { kind: "push" }, roots: ["deploy"] });
    const result = compileGithub(synthesize(proj));
    const yaml = parse(result.artifacts[0]!.content);
    expect(yaml.jobs.deploy.environment).toBeDefined();
    expect(yaml.jobs.deploy.environment.name).toBe("production");
    expect(yaml.jobs.deploy.environment.url).toBe("https://app.example.com");
  });

  it("emits error diagnostic for action (unsupported on GitHub)", () => {
    const proj = new Project("test");
    const p = new Pipeline(proj, "ci");
    new ShellStep(p, "deploy", {
      command: "deploy",
      environment: { name: "production", action: "stop" },
    });
    new Entry(p, "on-push", { trigger: { kind: "push" }, roots: ["deploy"] });
    const target = new GithubTarget();
    const diags = target.analyze(synthesize(proj));
    const actionDiag = diags.find((d) => d.capability === "deployment.environment.action");
    expect(actionDiag).toBeDefined();
    expect(actionDiag?.support).toBe("unsupported");
  });
});

describe("compileGithub — artifact retention", () => {
  it("emits retention-days on upload-artifact", () => {
    const proj = new Project("test");
    const p = new Pipeline(proj, "ci");
    new ShellStep(p, "build", {
      command: "make build",
      outputs: { dist: { type: "artifact", path: "dist/", retention: "7d" } },
    });
    new Entry(p, "on-push", { trigger: { kind: "push" }, roots: ["build"] });
    const result = compileGithub(synthesize(proj));
    const yaml = parse(result.artifacts[0]!.content);
    const uploadStep = yaml.jobs.build.steps.find((s: { uses?: string }) => s.uses?.includes("upload-artifact"));
    expect(uploadStep.with["retention-days"]).toBe(7);
  });

  it("emits error diagnostic for artifact.access (unsupported on GitHub)", () => {
    const proj = new Project("test");
    const p = new Pipeline(proj, "ci");
    new ShellStep(p, "build", {
      command: "make build",
      outputs: { dist: { type: "artifact", path: "dist/", access: "developer" } },
    });
    new Entry(p, "on-push", { trigger: { kind: "push" }, roots: ["build"] });
    const target = new GithubTarget();
    const diags = target.analyze(synthesize(proj));
    const accessDiag = diags.find((d) => d.capability === "artifact.access");
    expect(accessDiag).toBeDefined();
    expect(accessDiag?.support).toBe("unsupported");
  });
});

describe("compileGithub — cache", () => {
  it("emits actions/cache step with path, key, and restore-keys", () => {
    const proj = new Project("test");
    const p = new Pipeline(proj, "ci");
    new ShellStep(p, "build", {
      command: "make build",
      cache: {
        paths: ["node_modules", ".cache"],
        key: "node-${{ hashFiles('bun.lock') }}",
        restoreKeys: ["node-"],
      },
    });
    new Entry(p, "on-push", { trigger: { kind: "push" }, roots: ["build"] });
    const result = compileGithub(synthesize(proj));
    const yaml = parse(result.artifacts[0]!.content);
    const cacheStep = yaml.jobs.build.steps.find((s: { uses?: string }) => s.uses?.includes("actions/cache"));
    expect(cacheStep).toBeDefined();
    expect(cacheStep.uses).toBe("actions/cache@v4");
    expect(cacheStep.with.key).toBe("node-${{ hashFiles('bun.lock') }}");
    expect(cacheStep.with["restore-keys"]).toBe("node-");
  });

  it("uses actions/cache/restore for pull policy", () => {
    const proj = new Project("test");
    const p = new Pipeline(proj, "ci");
    new ShellStep(p, "build", {
      command: "make build",
      cache: { paths: ["node_modules"], key: "k", policy: "pull" },
    });
    new Entry(p, "on-push", { trigger: { kind: "push" }, roots: ["build"] });
    const result = compileGithub(synthesize(proj));
    const yaml = parse(result.artifacts[0]!.content);
    const cacheStep = yaml.jobs.build.steps.find((s: { uses?: string }) => s.uses?.includes("cache"));
    expect(cacheStep.uses).toBe("actions/cache/restore@v4");
  });

  it("uses actions/cache/save for push policy", () => {
    const proj = new Project("test");
    const p = new Pipeline(proj, "ci");
    new ShellStep(p, "build", {
      command: "make build",
      cache: { paths: ["node_modules"], key: "k", policy: "push" },
    });
    new Entry(p, "on-push", { trigger: { kind: "push" }, roots: ["build"] });
    const result = compileGithub(synthesize(proj));
    const yaml = parse(result.artifacts[0]!.content);
    const cacheStep = yaml.jobs.build.steps.find((s: { uses?: string }) => s.uses?.includes("cache"));
    expect(cacheStep.uses).toBe("actions/cache/save@v4");
  });
});

describe("compileGithub — concurrency", () => {
  it("emits workflow-level concurrency from pipeline-level setting", () => {
    const proj = new Project("test");
    const p = new Pipeline(proj, "ci", {
      concurrency: { group: "deploy-${{ github.ref }}", cancelInProgress: true },
    });
    new ShellStep(p, "build", { command: "echo" });
    new Entry(p, "on-push", { trigger: { kind: "push" }, roots: ["build"] });
    const result = compileGithub(synthesize(proj));
    const yaml = parse(result.artifacts[0]!.content);
    expect(yaml.concurrency).toBeDefined();
    expect(yaml.concurrency.group).toBe("deploy-${{ github.ref }}");
    expect(yaml.concurrency["cancel-in-progress"]).toBe(true);
  });

  it("emits job-level concurrency from step-level setting", () => {
    const proj = new Project("test");
    const p = new Pipeline(proj, "ci");
    new ShellStep(p, "deploy", {
      command: "deploy",
      concurrency: { group: "production" },
    });
    new Entry(p, "on-push", { trigger: { kind: "push" }, roots: ["deploy"] });
    const result = compileGithub(synthesize(proj));
    const yaml = parse(result.artifacts[0]!.content);
    expect(yaml.jobs.deploy.concurrency).toBeDefined();
    expect(yaml.jobs.deploy.concurrency.group).toBe("production");
  });
});

describe("GithubTarget — lower", () => {
  it("produces correct job count", () => {
    const graph = makeGraphWithDeps();
    const target = new GithubTarget();
    const result = target.lower(graph);
    const tg: GithubTargetGraph = Array.isArray(result) ? result[0]! : result;
    expect(tg.jobs).toHaveLength(2);
  });

  it("job IDs match step IDs", () => {
    const graph = makeGraphWithDeps();
    const target = new GithubTarget();
    const result = target.lower(graph);
    const tg: GithubTargetGraph = Array.isArray(result) ? result[0]! : result;
    const ids = tg.jobs.map((j: GithubJob) => j.id);
    expect(ids).toEqual(["lint", "build"]);
  });
});

describe("GithubTarget — emit", () => {
  it("produces YAML artifact", () => {
    const graph = makeSimpleGraph();
    const target = new GithubTarget();
    const targetGraph = target.lower(graph);
    const artifacts = target.emit(targetGraph);
    expect(artifacts).toHaveLength(1);
    expect(artifacts[0]?.content).toContain("jobs:");
  });
});

describe("compileGithub — invalid graph handling", () => {
  it("throws INVALID_GRAPH for unknown entry root", () => {
    const graph: DefinitionGraph = {
      project: {
        id: "test",
        pipelines: [{
          id: "ci",
          inputs: {},
          entries: [{ id: "on-push", trigger: { kind: "push" }, roots: ["missing"] }],
          steps: [],
          outputs: [],
        }],
      },
    };
    expect(() => compileGithub(graph)).toThrow(GithubTargetError);
    try {
      compileGithub(graph);
    } catch (err) {
      expect((err as GithubTargetError).code).toBe("INVALID_GRAPH");
    }
  });

  it("throws INVALID_GRAPH for unknown dependency producer", () => {
    const graph: DefinitionGraph = {
      project: {
        id: "test",
        pipelines: [{
          id: "ci",
          inputs: {},
          entries: [{ id: "on-push", trigger: { kind: "push" }, roots: ["build"] }],
          steps: [{
            id: "build",
            runtime: { mode: "host" },
            operations: [{ kind: "shell", command: "echo hi" }],
            inputs: [],
            outputs: [],
            dependencies: [{ kind: "control", producer: "missing" }],
          }],
          outputs: [],
        }],
      },
    };
    expect(() => compileGithub(graph)).toThrow(GithubTargetError);
    try {
      compileGithub(graph);
    } catch (err) {
      expect((err as GithubTargetError).code).toBe("INVALID_GRAPH");
    }
  });
});

describe("compileGithub — diagnostic operation", () => {
  it("passes diagnostic message through step env", () => {
    const graph: DefinitionGraph = {
      project: {
        id: "test",
        pipelines: [{
          id: "ci",
          inputs: {},
          entries: [{ id: "on-push", trigger: { kind: "push" }, roots: ["build"] }],
          steps: [{
            id: "build",
            runtime: { mode: "host" },
            operations: [{ kind: "diagnostic", message: "hello", severity: "error" }],
            inputs: [],
            outputs: [],
            dependencies: [],
          }],
          outputs: [],
        }],
      },
    };
    const result = compileGithub(graph);
    const yaml = parse(result.artifacts[0]!.content);
    const runStep = yaml.jobs.build.steps.find((s: { run?: string }) => s.run);
    expect(runStep.env).toBeDefined();
    expect(runStep.env.SVERKA_DIAGNOSTIC_MESSAGE).toBe("hello");
    expect(runStep.run).toContain("::error::");
    expect(runStep.run).toContain("$SVERKA_DIAGNOSTIC_MESSAGE");
  });

  it("escapes percent, newlines, and carriage returns in diagnostic message", () => {
    const message = "50%\nline\rmore";
    const graph: DefinitionGraph = {
      project: {
        id: "test",
        pipelines: [{
          id: "ci",
          inputs: {},
          entries: [{ id: "on-push", trigger: { kind: "push" }, roots: ["build"] }],
          steps: [{
            id: "build",
            runtime: { mode: "host" },
            operations: [{ kind: "diagnostic", message, severity: "warn" }],
            inputs: [],
            outputs: [],
            dependencies: [],
          }],
          outputs: [],
        }],
      },
    };
    const result = compileGithub(graph);
    const yaml = parse(result.artifacts[0]!.content);
    const runStep = yaml.jobs.build.steps.find((s: { run?: string }) => s.run);
    expect(runStep.env.SVERKA_DIAGNOSTIC_MESSAGE).toBe(
      "50%25%0Aline%0Dmore",
    );
    expect(runStep.run).toContain("::warning::");
  });
});

// F-20: Environment variables — runtime.env → job env block
describe("compileGithub — environment variables (F-20)", () => {
  it("lowers runtime.env to job env block", () => {
    const proj = new Project("test");
    const p = new Pipeline(proj, "ci");
    new ShellStep(p, "build", {
      command: "echo $NODE_ENV",
      runtime: { env: { NODE_ENV: "production", CI: "true" } },
    });
    new Entry(p, "on-push", { trigger: { kind: "push" }, roots: ["build"] });
    const result = compileGithub(synthesize(proj));
    const yaml = parse(result.artifacts[0]!.content);
    expect(yaml.jobs.build.env).toEqual({ NODE_ENV: "production", CI: "true" });
  });

  it("lowers pipeline input defaults to workflow env", () => {
    const proj = new Project("test");
    const p = new Pipeline(proj, "ci", {
      inputs: { nodeVersion: { type: "string", default: "22" } },
    });
    new ShellStep(p, "build", { command: "echo build" });
    new Entry(p, "on-push", { trigger: { kind: "push" }, roots: ["build"] });
    const result = compileGithub(synthesize(proj));
    const yaml = parse(result.artifacts[0]!.content);
    expect(yaml.env).toEqual({ nodeVersion: "22" });
  });

  it("translates inputs.X refs to env.X in commands (inputs are in workflow env)", () => {
    const proj = new Project("test");
    const p = new Pipeline(proj, "ci", {
      inputs: { nodeVersion: { type: "string", default: "22" } },
    });
    new ShellStep(p, "build", {
      command: "echo ${inputs.nodeVersion}",
      inputs: [{ kind: "context", namespace: "inputs", field: "nodeVersion" }],
    });
    new Entry(p, "on-push", { trigger: { kind: "push" }, roots: ["build"] });
    const result = compileGithub(synthesize(proj));
    const yaml = parse(result.artifacts[0]!.content);
    const runStep = yaml.jobs.build.steps.find((s: { run?: string }) => s.run);
    expect(runStep.run).toContain("${{ env.nodeVersion }}");
  });
});

// F-21: Secrets — runtime.secrets → ${{ secrets.X }} in job env
describe("compileGithub — secrets (F-21)", () => {
  it("lowers runtime.secrets to ${{ secrets.X }} in job env", () => {
    const proj = new Project("test");
    const p = new Pipeline(proj, "ci");
    new ShellStep(p, "deploy", {
      command: "npm publish",
      runtime: { secrets: ["NPM_TOKEN", "GH_TOKEN"] },
    });
    new Entry(p, "on-push", { trigger: { kind: "push" }, roots: ["deploy"] });
    const result = compileGithub(synthesize(proj));
    const yaml = parse(result.artifacts[0]!.content);
    expect(yaml.jobs.deploy.env.NPM_TOKEN).toBe("${{ secrets.NPM_TOKEN }}");
    expect(yaml.jobs.deploy.env.GH_TOKEN).toBe("${{ secrets.GH_TOKEN }}");
  });

  it("lowers pipeline secret inputs to ${{ secrets.X }} in workflow env", () => {
    const proj = new Project("test");
    const p = new Pipeline(proj, "ci", {
      inputs: { npmToken: { type: "string", secret: true, required: true } },
    });
    new ShellStep(p, "deploy", { command: "npm publish" });
    new Entry(p, "on-push", { trigger: { kind: "push" }, roots: ["deploy"] });
    const result = compileGithub(synthesize(proj));
    const yaml = parse(result.artifacts[0]!.content);
    expect(yaml.env.npmToken).toBe("${{ secrets.npmToken }}");
  });
});

// F-23: Scalar outputs — exportOutput → $GITHUB_OUTPUT
describe("compileGithub — scalar outputs (F-23)", () => {
  it("lowers exportOutput to echo >> $GITHUB_OUTPUT", () => {
    const proj = new Project("test");
    const p = new Pipeline(proj, "ci");
    new ShellStep(p, "build", {
      command: 'echo "version=1.2.3" > $SVERKA_OUTPUT_DIR/version',
      outputs: { version: { type: "string" } },
    });
    new Entry(p, "on-push", { trigger: { kind: "push" }, roots: ["build"] });
    const result = compileGithub(synthesize(proj));
    const yaml = parse(result.artifacts[0]!.content);
    const runStep = yaml.jobs.build.steps.find((s: { run?: string }) => s.run);
    expect(runStep.run).toContain('echo "version=${version}" >> "$GITHUB_OUTPUT"');
  });
});

// F-24: Artifact outputs — exportArtifact → upload-artifact action
describe("compileGithub — artifact outputs (F-24)", () => {
  it("lowers exportArtifact to actions/upload-artifact@v4", () => {
    const proj = new Project("test");
    const p = new Pipeline(proj, "ci");
    new ShellStep(p, "build", {
      command: "mkdir dist && echo built > dist/output.txt",
      outputs: { dist: { type: "artifact", path: "dist/" } },
    });
    new Entry(p, "on-push", { trigger: { kind: "push" }, roots: ["build"] });
    const result = compileGithub(synthesize(proj));
    const yaml = parse(result.artifacts[0]!.content);
    const uploadStep = yaml.jobs.build.steps.find(
      (s: { uses?: string }) => s.uses?.startsWith("actions/upload-artifact"),
    );
    expect(uploadStep).toBeDefined();
    expect(uploadStep.uses).toBe("actions/upload-artifact@v4");
    expect(uploadStep.with.name).toBe("build-dist");
    expect(uploadStep.with.path).toBe("dist/");
  });
});

// F-25: Artifact import — importArtifact → download-artifact action
describe("compileGithub — artifact import (F-25)", () => {
  it("lowers importArtifact to actions/download-artifact@v4", () => {
    const proj = new Project("test");
    const p = new Pipeline(proj, "ci");
    new ShellStep(p, "build", {
      command: "mkdir dist && echo built > dist/output.txt",
      outputs: { dist: { type: "artifact", path: "dist/" } },
    });
    new ShellStep(p, "deploy", {
      command: "ls dist/",
      inputs: [{ kind: "step", step: "build", output: "dist", type: "artifact" }],
    });
    new Entry(p, "on-push", { trigger: { kind: "push" }, roots: ["deploy"] });
    const result = compileGithub(synthesize(proj));
    const yaml = parse(result.artifacts[0]!.content);
    const downloadStep = yaml.jobs.deploy.steps.find(
      (s: { uses?: string }) => s.uses?.startsWith("actions/download-artifact"),
    );
    expect(downloadStep).toBeDefined();
    expect(downloadStep.uses).toBe("actions/download-artifact@v4");
    expect(downloadStep.with.name).toBe("build-dist");
    expect(downloadStep.with.path).toBe("dist");
  });
});

describe("compileGithub — reusable workflows (F-31)", () => {
  function makeReusableGraph(): DefinitionGraph {
    const proj = new Project("test");
    const deploy = new Pipeline(proj, "deploy", {
      inputs: { env: { type: "string", required: true } },
    });
    new ShellStep(deploy, "deploy", { command: "deploy" });
    const ci = new Pipeline(proj, "ci");
    new ShellStep(ci, "build", { command: "make build" });
    new PipelineCallStep(ci, "deploy-staging", {
      callee: "deploy",
      callInputs: { env: "staging" },
      dependsOn: ["build"],
    });
    // Root is the call step (terminal) — reachability follows deps backward.
    new Entry(ci, "on-push", { trigger: { kind: "push" }, roots: ["deploy-staging"] });
    return synthesize(proj);
  }

  it("produces 2 artifacts: ci.yml + deploy.yml", () => {
    const graph = makeReusableGraph();
    const result = compileGithub(graph);
    expect(result.artifacts).toHaveLength(2);
    const paths = result.artifacts.map((a) => a.path);
    expect(paths).toContain(".github/workflows/ci.yml");
    expect(paths).toContain(".github/workflows/deploy.yml");
  });

  it("deploy.yml has on: workflow_call with inputs", () => {
    const graph = makeReusableGraph();
    const result = compileGithub(graph);
    const deployArtifact = result.artifacts.find((a) => a.path.includes("deploy"))!;
    const yaml = parse(deployArtifact.content);
    expect(yaml.on.workflow_call).toBeDefined();
    expect(yaml.on.workflow_call.inputs.env).toBeDefined();
    expect(yaml.on.workflow_call.inputs.env.type).toBe("string");
    expect(yaml.on.workflow_call.inputs.env.required).toBe(true);
  });

  it("ci.yml has call job with uses + with + secrets: inherit", () => {
    const graph = makeReusableGraph();
    const result = compileGithub(graph);
    const ciArtifact = result.artifacts.find((a) => a.path.includes("ci.yml"))!;
    const yaml = parse(ciArtifact.content);
    const callJob = yaml.jobs["deploy-staging"];
    expect(callJob).toBeDefined();
    expect(callJob.uses).toBe("./.github/workflows/deploy.yml");
    expect(callJob.with.env).toBe("staging");
    expect(callJob.secrets).toBe("inherit");
    expect(callJob.needs).toBe("build");
  });

  it("single-pipeline graph (no calls) → unchanged output (backward compat)", () => {
    const graph = makeSimpleGraph();
    const result = compileGithub(graph);
    expect(result.artifacts).toHaveLength(1);
    expect(result.artifacts[0]?.path).toBe(".github/workflows/ci.yml");
  });

  it("pipeline with entries AND called → root workflow with both push and workflow_call", () => {
    const proj = new Project("test");
    const deploy = new Pipeline(proj, "deploy", {
      inputs: { env: { type: "string", required: true } },
    });
    new ShellStep(deploy, "deploy", { command: "deploy" });
    new Entry(deploy, "on-push", { trigger: { kind: "push" }, roots: ["deploy"] });
    const ci = new Pipeline(proj, "ci");
    new ShellStep(ci, "build", { command: "make build" });
    new PipelineCallStep(ci, "deploy-staging", {
      callee: "deploy",
      callInputs: { env: "staging" },
      dependsOn: ["build"],
    });
    new Entry(ci, "on-push", { trigger: { kind: "push" }, roots: ["deploy-staging"] });
    const graph = synthesize(proj);

    const result = compileGithub(graph);
    const deployArtifact = result.artifacts.find((a) => a.path.includes("deploy"))!;
    const yaml = parse(deployArtifact.content);
    expect(yaml.on.push).toBeDefined();
    expect(yaml.on.workflow_call).toBeDefined();
  });
});

describe("compileGithub — components (F-32)", () => {
  function makeComponentGraph(): DefinitionGraph {
    const proj = new Project("test");
    const ci = new Pipeline(proj, "ci");
    new ShellStep(ci, "build", { command: "make build" });
    new ComponentStep(ci, "deploy", {
      component: { name: "org/deploy-action", version: "v1", inputs: { env: "staging" } },
      dependsOn: ["build"],
    });
    new Entry(ci, "on-push", { trigger: { kind: "push" }, roots: ["deploy"] });
    return synthesize(proj);
  }

  it("produces one workflow with a composite action job", () => {
    const graph = makeComponentGraph();
    const result = compileGithub(graph);
    expect(result.artifacts).toHaveLength(1);
    const yaml = parse(result.artifacts[0]!.content);
    const deployJob = yaml.jobs.deploy;
    expect(deployJob).toBeDefined();
    // Action-like component references are emitted as normal jobs with action steps.
    expect(deployJob["runs-on"]).toBe("ubuntu-latest");
    expect(deployJob.needs).toBe("build");
    const actionStep = deployJob.steps.find((s: Record<string, unknown>) => s.uses === "org/deploy-action@v1");
    expect(actionStep).toBeDefined();
    expect(actionStep.with.env).toBe("staging");
  });

  it("single-pipeline graph with component → one artifact (backward compat)", () => {
    const graph = makeComponentGraph();
    const result = compileGithub(graph);
    expect(result.artifacts).toHaveLength(1);
    expect(result.artifacts[0]?.path).toBe(".github/workflows/ci.yml");
  });
});

describe("compileGithub — child pipelines (F-33)", () => {
  it("emits a warning job for child pipeline (unsupported on GitHub)", () => {
    const proj = new Project("test");
    const ci = new Pipeline(proj, "ci");
    new ShellStep(ci, "generate", {
      command: "generate-pipeline > child.yml",
      outputs: { "child-pipeline": { type: "artifact", path: "child.yml" } },
    });
    new ChildPipelineStep(ci, "trigger-child", {
      childPipeline: { generator: "generate", artifact: "child-pipeline" },
      dependsOn: ["generate"],
    });
    new Entry(ci, "on-push", { trigger: { kind: "push" }, roots: ["trigger-child"] });
    const graph = synthesize(proj);

    const result = compileGithub(graph);
    expect(result.artifacts).toHaveLength(1);
    const yaml = parse(result.artifacts[0]!.content);
    const triggerJob = yaml.jobs["trigger-child"];
    expect(triggerJob).toBeDefined();
    expect(triggerJob.needs).toBe("generate");
    // Should have a warning step.
    expect(triggerJob.steps[0].run).toContain("WARNING");
  });
});

describe("compileGithub — downstream projects (F-34)", () => {
  it("emits repository_dispatch API call", () => {
    const proj = new Project("test");
    const ci = new Pipeline(proj, "ci");
    new ShellStep(ci, "build", { command: "make build" });
    new DownstreamStep(ci, "trigger-downstream", {
      downstream: { project: "group/other-project", branch: "main", inputs: { env: "staging" } },
      dependsOn: ["build"],
    });
    new Entry(ci, "on-push", { trigger: { kind: "push" }, roots: ["trigger-downstream"] });
    const graph = synthesize(proj);

    const result = compileGithub(graph);
    expect(result.artifacts).toHaveLength(1);
    const yaml = parse(result.artifacts[0]!.content);
    const dsJob = yaml.jobs["trigger-downstream"];
    expect(dsJob).toBeDefined();
    expect(dsJob.needs).toBe("build");
    expect(dsJob.steps[0].run).toContain("gh api repos/group/other-project/dispatches");
    expect(dsJob.steps[0].run).toContain("sverka-trigger");
    // Payload is passed through an env var to avoid shell injection from
    // single quotes in runtime values (CodeRabbit finding).
    expect(dsJob.steps[0].env.CLIENT_PAYLOAD).toContain("staging");
    expect(dsJob.steps[0].run).toContain("$CLIENT_PAYLOAD");
    expect(dsJob.steps[0].env.DOWNSTREAM_BRANCH).toBe("main");
    expect(dsJob.steps[0].run).toContain("$DOWNSTREAM_BRANCH");
  });
});

describe("compileGithub — release (F-39)", () => {
  it("emits softprops/action-gh-release step", () => {
    const proj = new Project("test");
    const ci = new Pipeline(proj, "ci");
    new ShellStep(ci, "build", { command: "make build" });
    new ReleaseStep(ci, "release", {
      release: {
        tag: "v1.0.0",
        name: "Release v1.0.0",
        description: "Release notes",
        assets: ["dist/bin.tar.gz"],
        draft: false,
        prerelease: false,
      },
      dependsOn: ["build"],
    });
    new Entry(ci, "on-push", { trigger: { kind: "push" }, roots: ["release"] });
    const graph = synthesize(proj);

    const result = compileGithub(graph);
    const yaml = parse(result.artifacts[0]!.content);
    const releaseJob = yaml.jobs.release;
    expect(releaseJob).toBeDefined();
    // Find the release step (not checkout).
    const releaseStep = releaseJob.steps.find((s: { uses?: string }) => s.uses?.includes("action-gh-release"));
    expect(releaseStep).toBeDefined();
    expect(releaseStep.uses).toBe("softprops/action-gh-release@v2");
    expect(releaseStep.with.tag_name).toBe("v1.0.0");
    expect(releaseStep.with.name).toBe("Release v1.0.0");
    expect(releaseStep.with.body).toBe("Release notes");
    expect(releaseStep.with.files).toBe("dist/bin.tar.gz");
  });
});

describe("compileGithub — pages (F-40)", () => {
  it("emits upload-pages-artifact and deploy-pages steps", () => {
    const proj = new Project("test");
    const ci = new Pipeline(proj, "ci");
    new ShellStep(ci, "build", { command: "make build" });
    new PagesStep(ci, "deploy-pages", {
      pages: { path: "dist/" },
      dependsOn: ["build"],
    });
    new Entry(ci, "on-push", { trigger: { kind: "push" }, roots: ["deploy-pages"] });
    const graph = synthesize(proj);

    const result = compileGithub(graph);
    const yaml = parse(result.artifacts[0]!.content);
    const pagesJob = yaml.jobs["deploy-pages"];
    expect(pagesJob).toBeDefined();
    const uploadStep = pagesJob.steps.find((s: { uses?: string }) => s.uses?.includes("upload-pages-artifact"));
    expect(uploadStep).toBeDefined();
    expect(uploadStep.with.path).toBe("dist/");
    const deployStep = pagesJob.steps.find((s: { uses?: string }) => s.uses?.includes("deploy-pages"));
    expect(deployStep).toBeDefined();
  });
});

describe("compileGithub — delayed execution (F-48)", () => {
  it("emits a sleep step for delay", () => {
    const proj = new Project("test");
    const ci = new Pipeline(proj, "ci");
    new ShellStep(ci, "deploy", { command: "make deploy", delay: "5m" });
    new Entry(ci, "on-push", { trigger: { kind: "push" }, roots: ["deploy"] });
    const graph = synthesize(proj);

    const result = compileGithub(graph);
    const yaml = parse(result.artifacts[0]!.content);
    const deployJob = yaml.jobs.deploy;
    expect(deployJob).toBeDefined();
    const sleepStep = deployJob.steps.find((s: { run?: string }) => s.run?.startsWith("sleep"));
    expect(sleepStep).toBeDefined();
    expect(sleepStep.run).toBe("sleep 300");
  });
});

describe("compileGithub — background execution (F-49)", () => {
  it("appends & to background shell commands", () => {
    const proj = new Project("test");
    const ci = new Pipeline(proj, "ci");
    new ShellStep(ci, "start-server", { command: "npm start", background: true });
    new Entry(ci, "on-push", { trigger: { kind: "push" }, roots: ["start-server"] });
    const graph = synthesize(proj);

    const result = compileGithub(graph);
    const yaml = parse(result.artifacts[0]!.content);
    const serverJob = yaml.jobs["start-server"];
    expect(serverJob).toBeDefined();
    // Find the run step (not checkout).
    const runStep = serverJob.steps.find((s: { run?: string }) => s.run?.includes("npm start"));
    expect(runStep).toBeDefined();
    expect(runStep.run).toContain("&");
    expect(runStep.run).toBe("npm start &");
  });
});
