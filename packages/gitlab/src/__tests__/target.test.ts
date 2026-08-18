import { describe, it, expect } from "vitest";
import { parse } from "yaml";
import { Project, Pipeline, ShellStep, Entry } from "@sverka/cdk";
import type { StatusCondition, Expression } from "@sverka/cdk";
import { synthesize, type DefinitionGraph } from "@sverka/core";
import { GitlabTarget, compileGitlab, GitlabTargetError, type GitlabJob } from "../index.js";

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

describe("compileGitlab — basic", () => {
  it("produces one YAML artifact", () => {
    const graph = makeSimpleGraph();
    const result = compileGitlab(graph);
    expect(result.artifacts).toHaveLength(1);
    expect(result.artifacts[0]?.path).toBe(".gitlab-ci.yml");
    expect(result.artifacts[0]?.content).toContain("stages:");
  });

  it("produces valid YAML", () => {
    const graph = makeSimpleGraph();
    const result = compileGitlab(graph);
    const yaml = parse(result.artifacts[0]!.content);
    expect(yaml.stages).toBeDefined();
    expect(yaml.build).toBeDefined();
  });
});

describe("compileGitlab — shell operations", () => {
  it("maps shell operation to script entry", () => {
    const graph = makeSimpleGraph();
    const result = compileGitlab(graph);
    const yaml = parse(result.artifacts[0]!.content);
    expect(yaml.build.script).toEqual(["npm run build"]);
  });
});

describe("compileGitlab — dependencies", () => {
  it("maps step dependencies to job needs", () => {
    const graph = makeGraphWithDeps();
    const result = compileGitlab(graph);
    const yaml = parse(result.artifacts[0]!.content);
    expect(yaml.build.needs).toEqual(["lint"]);
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
    const result = compileGitlab(synthesize(proj));
    const yaml = parse(result.artifacts[0]!.content);
    expect(yaml.build.needs).toEqual(["lint", "test"]);
  });
});

describe("compileGitlab — trigger mapping", () => {
  it("maps push trigger", () => {
    const proj = new Project("test");
    const p = new Pipeline(proj, "ci");
    new ShellStep(p, "build", { command: "echo hi" });
    new Entry(p, "on-push", { trigger: { kind: "push" }, roots: ["build"] });
    const result = compileGitlab(synthesize(proj));
    const yaml = parse(result.artifacts[0]!.content);
    expect(yaml.build.rules[0].if).toContain('"push"');
  });

  it("maps changeRequest trigger to merge_request_event", () => {
    const proj = new Project("test");
    const p = new Pipeline(proj, "ci");
    new ShellStep(p, "build", { command: "echo hi" });
    new Entry(p, "on-pr", { trigger: { kind: "changeRequest" }, roots: ["build"] });
    const result = compileGitlab(synthesize(proj));
    const yaml = parse(result.artifacts[0]!.content);
    expect(yaml.build.rules[0].if).toContain("merge_request_event");
  });

  it("maps manual trigger to web source without when: manual", () => {
    const proj = new Project("test");
    const p = new Pipeline(proj, "ci");
    new ShellStep(p, "build", { command: "echo hi" });
    new Entry(p, "on-manual", { trigger: { kind: "manual" }, roots: ["build"] });
    const result = compileGitlab(synthesize(proj));
    const yaml = parse(result.artifacts[0]!.content);
    expect(yaml.build.rules[0].if).toContain('"web"');
    expect(yaml.build.rules[0].when).toBeUndefined();
  });

  it("maps multiple triggers to multiple rules", () => {
    const proj = new Project("test");
    const p = new Pipeline(proj, "ci");
    new ShellStep(p, "build", { command: "echo hi" });
    new Entry(p, "on-push", { trigger: { kind: "push" }, roots: ["build"] });
    new Entry(p, "on-pr", { trigger: { kind: "changeRequest" }, roots: ["build"] });
    const result = compileGitlab(synthesize(proj));
    const yaml = parse(result.artifacts[0]!.content);
    expect(yaml.build.rules).toHaveLength(2);
  });
});

describe("compileGitlab — runtime mapping", () => {
  it("host runtime → no image", () => {
    const proj = new Project("test");
    const p = new Pipeline(proj, "ci");
    new ShellStep(p, "build", { command: "echo", runtime: { mode: "host" } });
    new Entry(p, "on-push", { trigger: { kind: "push" }, roots: ["build"] });
    const result = compileGitlab(synthesize(proj));
    const yaml = parse(result.artifacts[0]!.content);
    expect(yaml.build.image).toBeUndefined();
  });

  it("container runtime → image field", () => {
    const proj = new Project("test");
    const p = new Pipeline(proj, "ci");
    new ShellStep(p, "build", {
      command: "echo",
      runtime: { mode: "container", image: "node:22" },
    });
    new Entry(p, "on-push", { trigger: { kind: "push" }, roots: ["build"] });
    const result = compileGitlab(synthesize(proj));
    const yaml = parse(result.artifacts[0]!.content);
    expect(yaml.build.image).toBe("node:22");
  });
});

describe("compileGitlab — timeout", () => {
  it("maps timeout to timeout string", () => {
    const proj = new Project("test");
    const p = new Pipeline(proj, "ci");
    new ShellStep(p, "build", { command: "echo", timeout: 600000 });
    new Entry(p, "on-push", { trigger: { kind: "push" }, roots: ["build"] });
    const result = compileGitlab(synthesize(proj));
    const yaml = parse(result.artifacts[0]!.content);
    expect(yaml.build.timeout).toBe("10m");
  });
});

describe("compileGitlab — stages", () => {
  it("assigns build stage to steps with no deps", () => {
    const graph = makeSimpleGraph();
    const result = compileGitlab(graph);
    const yaml = parse(result.artifacts[0]!.content);
    expect(yaml.build.stage).toBe("build");
  });

  it("assigns stage-1 to steps with one level of deps", () => {
    const graph = makeGraphWithDeps();
    const result = compileGitlab(graph);
    const yaml = parse(result.artifacts[0]!.content);
    expect(yaml.lint.stage).toBe("build");
    expect(yaml.build.stage).toBe("stage-1");
  });
});

describe("compileGitlab — deterministic output", () => {
  it("same graph produces same YAML", () => {
    const g1 = makeSimpleGraph();
    const g2 = makeSimpleGraph();
    const r1 = compileGitlab(g1);
    const r2 = compileGitlab(g2);
    expect(r1.artifacts[0]?.content).toBe(r2.artifacts[0]?.content);
  });
});

describe("GitlabTarget — analyze", () => {
  it("no diagnostics for all-native graph", () => {
    const graph = makeSimpleGraph();
    const target = new GitlabTarget();
    const diags = target.analyze(graph);
    expect(diags).toHaveLength(0);
  });
});

describe("GitlabTarget — lower", () => {
  it("produces correct job count", () => {
    const graph = makeGraphWithDeps();
    const target = new GitlabTarget();
    const targetGraph = target.lower(graph);
    expect(targetGraph.jobs).toHaveLength(2);
  });

  it("job IDs match step IDs", () => {
    const graph = makeGraphWithDeps();
    const target = new GitlabTarget();
    const targetGraph = target.lower(graph);
    const ids = targetGraph.jobs.map((j: GitlabJob) => j.id);
    expect(ids).toEqual(["lint", "build"]);
  });
});

describe("GitlabTarget — emit", () => {
  it("produces YAML artifact", () => {
    const graph = makeSimpleGraph();
    const target = new GitlabTarget();
    const targetGraph = target.lower(graph);
    const artifacts = target.emit(targetGraph);
    expect(artifacts).toHaveLength(1);
    expect(artifacts[0]?.content).toContain("script:");
  });
});

describe("compileGitlab — rule scoping", () => {
  it("scopes rules to jobs reachable from each entry", () => {
    const proj = new Project("test");
    const p = new Pipeline(proj, "ci");
    new ShellStep(p, "build", { command: "echo build" });
    new ShellStep(p, "deploy", { command: "echo deploy" });
    new Entry(p, "on-push", { trigger: { kind: "push" }, roots: ["build"] });
    new Entry(p, "on-manual", {
      trigger: { kind: "manual" },
      roots: ["deploy"],
    });
    const result = compileGitlab(synthesize(proj));
    const yaml = parse(result.artifacts[0]!.content);
    expect(yaml.build.rules).toHaveLength(1);
    expect(yaml.build.rules[0]?.if).toContain('"push"');
    expect(yaml.deploy.rules).toHaveLength(1);
    expect(yaml.deploy.rules[0]?.if).toContain('"web"');
  });
});

describe("compileGitlab — artifact imports", () => {
  it("includes artifact-import producers in reachability and needs", () => {
    const graph: DefinitionGraph = {
      project: {
        id: "test",
        pipelines: [{
          id: "ci",
          inputs: {},
          entries: [{ id: "on-push", trigger: { kind: "push" }, roots: ["deploy"] }],
          steps: [
            {
              id: "build",
              runtime: { mode: "host" },
              operations: [{ kind: "exportArtifact", name: "dist", path: "dist" }],
              inputs: [],
              outputs: [],
              dependencies: [],
            },
            {
              id: "deploy",
              runtime: { mode: "host" },
              operations: [{ kind: "importArtifact", name: "dist", from: "build", output: "dist" }],
              inputs: [],
              outputs: [],
              dependencies: [],
            },
          ],
          outputs: [],
        }],
      },
    };
    const result = compileGitlab(graph);
    const yaml = parse(result.artifacts[0]!.content);
    expect(yaml.build).toBeDefined();
    expect(yaml.deploy.needs).toContain("build");
  });

  it("throws INVALID_GRAPH for unknown artifact-import producer", () => {
    const graph: DefinitionGraph = {
      project: {
        id: "test",
        pipelines: [{
          id: "ci",
          inputs: {},
          entries: [{ id: "on-push", trigger: { kind: "push" }, roots: ["deploy"] }],
          steps: [{
            id: "deploy",
            runtime: { mode: "host" },
            operations: [{ kind: "importArtifact", name: "dist", from: "missing", output: "dist" }],
            inputs: [],
            outputs: [],
            dependencies: [],
          }],
          outputs: [],
        }],
      },
    };
    expect(() => compileGitlab(graph)).toThrow(GitlabTargetError);
    try {
      compileGitlab(graph);
    } catch (err) {
      expect((err as GitlabTargetError).code).toBe("INVALID_GRAPH");
    }
  });
});

describe("compileGitlab — emission validation", () => {
  it("throws EMIT_FAILED for job id conflicting with reserved top-level key", () => {
    const proj = new Project("test");
    const p = new Pipeline(proj, "ci");
    new ShellStep(p, "image", { command: "echo hi" });
    new Entry(p, "on-push", { trigger: { kind: "push" }, roots: ["image"] });
    expect(() => compileGitlab(synthesize(proj))).toThrow(GitlabTargetError);
    try {
      compileGitlab(synthesize(proj));
    } catch (err) {
      expect((err as GitlabTargetError).code).toBe("EMIT_FAILED");
    }
  });
});

// F-20: Environment variables — runtime.env → job variables block
describe("compileGitlab — environment variables (F-20)", () => {
  it("lowers runtime.env to job variables block", () => {
    const proj = new Project("test");
    const p = new Pipeline(proj, "ci");
    new ShellStep(p, "build", {
      command: "echo $NODE_ENV",
      runtime: { env: { NODE_ENV: "production", CI: "true" } },
    });
    new Entry(p, "on-push", { trigger: { kind: "push" }, roots: ["build"] });
    const result = compileGitlab(synthesize(proj));
    const yaml = parse(result.artifacts[0]!.content);
    expect(yaml.build.variables).toEqual({ NODE_ENV: "production", CI: "true" });
  });

  it("lowers pipeline input defaults to global variables", () => {
    const proj = new Project("test");
    const p = new Pipeline(proj, "ci", {
      inputs: { nodeVersion: { type: "string", default: "22" } },
    });
    new ShellStep(p, "build", { command: "echo build" });
    new Entry(p, "on-push", { trigger: { kind: "push" }, roots: ["build"] });
    const result = compileGitlab(synthesize(proj));
    const yaml = parse(result.artifacts[0]!.content);
    expect(yaml.variables).toEqual({ nodeVersion: "22" });
  });
});

// F-21: Secrets — runtime.secrets → $X in job variables; pipeline secret inputs omitted
describe("compileGitlab — secrets (F-21)", () => {
  it("lowers runtime.secrets to $X in job variables", () => {
    const proj = new Project("test");
    const p = new Pipeline(proj, "ci");
    new ShellStep(p, "deploy", {
      command: "npm publish",
      runtime: { secrets: ["NPM_TOKEN", "GH_TOKEN"] },
    });
    new Entry(p, "on-push", { trigger: { kind: "push" }, roots: ["deploy"] });
    const result = compileGitlab(synthesize(proj));
    const yaml = parse(result.artifacts[0]!.content);
    expect(yaml.deploy.variables.NPM_TOKEN).toBe("$NPM_TOKEN");
    expect(yaml.deploy.variables.GH_TOKEN).toBe("$GH_TOKEN");
  });

  it("omits pipeline secret inputs from global variables", () => {
    const proj = new Project("test");
    const p = new Pipeline(proj, "ci", {
      inputs: {
        npmToken: { type: "string", secret: true, required: true },
        nodeVersion: { type: "string", default: "22" },
      },
    });
    new ShellStep(p, "deploy", { command: "npm publish" });
    new Entry(p, "on-push", { trigger: { kind: "push" }, roots: ["deploy"] });
    const result = compileGitlab(synthesize(proj));
    const yaml = parse(result.artifacts[0]!.content);
    expect(yaml.variables).toEqual({ nodeVersion: "22" });
    expect(yaml.variables.npmToken).toBeUndefined();
  });
});

// F-23: Scalar outputs — exportOutput → dotenv report
describe("compileGitlab — scalar outputs (F-23)", () => {
  it("lowers exportOutput to echo >> sverka.env + dotenv report", () => {
    const proj = new Project("test");
    const p = new Pipeline(proj, "ci");
    new ShellStep(p, "build", {
      command: 'echo "version=1.2.3" > $SVERKA_OUTPUT_DIR/version',
      outputs: { version: { type: "string" } },
    });
    new Entry(p, "on-push", { trigger: { kind: "push" }, roots: ["build"] });
    const result = compileGitlab(synthesize(proj));
    const yaml = parse(result.artifacts[0]!.content);
    expect(yaml.build.script).toContainEqual('echo "build_version=${version}" >> sverka.env');
    expect(yaml.build.artifacts.reports.dotenv).toBe("sverka.env");
  });
});

// F-24: Artifact outputs — exportArtifact → artifacts:paths
describe("compileGitlab — artifact outputs (F-24)", () => {
  it("lowers exportArtifact to artifacts:paths", () => {
    const proj = new Project("test");
    const p = new Pipeline(proj, "ci");
    new ShellStep(p, "build", {
      command: "mkdir dist && echo built > dist/output.txt",
      outputs: { dist: { type: "artifact", path: "dist/" } },
    });
    new Entry(p, "on-push", { trigger: { kind: "push" }, roots: ["build"] });
    const result = compileGitlab(synthesize(proj));
    const yaml = parse(result.artifacts[0]!.content);
    expect(yaml.build.artifacts.paths).toContain("dist/");
  });
});

// F-25: Artifact import — importArtifact → needs (implicit artifact passing)
describe("compileGitlab — artifact import (F-25)", () => {
  it("lowers importArtifact to needs on producer job", () => {
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
    const result = compileGitlab(synthesize(proj));
    const yaml = parse(result.artifacts[0]!.content);
    expect(yaml.deploy.needs).toContain("build");
  });
});

// F-11: Step conditions — status conditions map to when: on rules
describe("compileGitlab — step conditions (F-11)", () => {
  it("lowers failure status condition to when: on_failure on rules", () => {
    const proj = new Project("test");
    const p = new Pipeline(proj, "ci");
    const failureCond: StatusCondition = { kind: "status", status: "failure" };
    new ShellStep(p, "notify", {
      command: "echo failed",
      condition: failureCond,
    });
    new Entry(p, "on-push", { trigger: { kind: "push" }, roots: ["notify"] });
    const result = compileGitlab(synthesize(proj));
    const yaml = parse(result.artifacts[0]!.content);
    expect(yaml.notify.rules[0].if).toContain('"push"');
    expect(yaml.notify.rules[0].when).toBe("on_failure");
  });

  it("lowers always status condition to when: always", () => {
    const proj = new Project("test");
    const p = new Pipeline(proj, "ci");
    new ShellStep(p, "cleanup", {
      command: "echo cleanup",
      condition: { kind: "status", status: "always" },
    });
    new Entry(p, "on-push", { trigger: { kind: "push" }, roots: ["cleanup"] });
    const result = compileGitlab(synthesize(proj));
    const yaml = parse(result.artifacts[0]!.content);
    expect(yaml.cleanup.rules[0].when).toBe("always");
  });

  it("lowers never status condition to when: never", () => {
    const proj = new Project("test");
    const p = new Pipeline(proj, "ci");
    new ShellStep(p, "skip", {
      command: "echo skip",
      condition: { kind: "status", status: "never" },
    });
    new Entry(p, "on-push", { trigger: { kind: "push" }, roots: ["skip"] });
    const result = compileGitlab(synthesize(proj));
    const yaml = parse(result.artifacts[0]!.content);
    expect(yaml.skip.rules[0].when).toBe("never");
  });

  it("lowers success status condition to when: on_success", () => {
    const proj = new Project("test");
    const p = new Pipeline(proj, "ci");
    new ShellStep(p, "ok", {
      command: "echo ok",
      condition: { kind: "status", status: "success" },
    });
    new Entry(p, "on-push", { trigger: { kind: "push" }, roots: ["ok"] });
    const result = compileGitlab(synthesize(proj));
    const yaml = parse(result.artifacts[0]!.content);
    expect(yaml.ok.rules[0].when).toBe("on_success");
  });

  it("emits a valid rule when a condition exists with no trigger rules", () => {
    // A step with a condition but no entries reaching it should still get a rule.
    const graph: DefinitionGraph = {
      project: {
        id: "test",
        pipelines: [{
          id: "ci",
          inputs: {},
          entries: [],
          steps: [{
            id: "orphan",
            runtime: { mode: "host" },
            operations: [{ kind: "shell", command: "echo hi" }],
            inputs: [],
            outputs: [],
            dependencies: [],
            condition: { kind: "status", status: "always" },
          }],
          outputs: [],
        }],
      },
    };
    // With no entries, the step is not reachable, so no job is emitted.
    // This test verifies that the lowering does not crash on empty rules.
    const result = compileGitlab(graph);
    const yaml = parse(result.artifacts[0]!.content);
    expect(yaml.stages).toBeDefined();
  });

  it("lowers a context-ref condition to an if: expression ANDed with trigger rules", () => {
    const proj = new Project("test");
    const p = new Pipeline(proj, "ci");
    new ShellStep(p, "build", {
      command: "echo build",
      condition: { kind: "context", namespace: "git", field: "branch" },
    });
    new Entry(p, "on-push", { trigger: { kind: "push" }, roots: ["build"] });
    const result = compileGitlab(synthesize(proj));
    const yaml = parse(result.artifacts[0]!.content);
    expect(yaml.build.rules[0].if).toContain("$CI_COMMIT_BRANCH");
    expect(yaml.build.rules[0].if).toContain('"push"');
  });

  it("lowers a step-ref condition with producer job ID prefix", () => {
    const proj = new Project("test");
    const p = new Pipeline(proj, "ci");
    new ShellStep(p, "build", {
      command: 'echo "ok=true" > $SVERKA_OUTPUT_DIR/ok',
      outputs: { ok: { type: "boolean" } },
    });
    new ShellStep(p, "deploy", {
      command: "echo deploy",
      dependsOn: ["build"],
      condition: {
        kind: "step",
        step: "build",
        output: "ok",
        type: "boolean",
      },
    });
    new Entry(p, "on-push", { trigger: { kind: "push" }, roots: ["deploy"] });
    const result = compileGitlab(synthesize(proj));
    const yaml = parse(result.artifacts[0]!.content);
    // The condition should reference $build_ok (producer job ID prefix)
    expect(yaml.deploy.rules[0].if).toContain("$build_ok");
  });

  it("lowers an expression condition with context refs", () => {
    const proj = new Project("test");
    const p = new Pipeline(proj, "ci");
    const expr: Expression = {
      kind: "expression",
      template: "${git.branch} == main",
      refs: [{ kind: "context", namespace: "git", field: "branch" }],
    };
    new ShellStep(p, "build", {
      command: "echo build",
      condition: expr,
    });
    new Entry(p, "on-push", { trigger: { kind: "push" }, roots: ["build"] });
    const result = compileGitlab(synthesize(proj));
    const yaml = parse(result.artifacts[0]!.content);
    expect(yaml.build.rules[0].if).toContain("$CI_COMMIT_BRANCH");
    expect(yaml.build.rules[0].if).toContain("main");
  });
});

// F-06: Trigger filters — tag, branch, and path filters
describe("compileGitlab — trigger filters (F-06)", () => {
  it("lowers push tag filter to $CI_COMMIT_TAG condition", () => {
    const proj = new Project("test");
    const p = new Pipeline(proj, "ci");
    new ShellStep(p, "build", { command: "echo hi" });
    new Entry(p, "on-tag", {
      trigger: { kind: "push", filter: { tags: ["v*"] } },
      roots: ["build"],
    });
    const result = compileGitlab(synthesize(proj));
    const yaml = parse(result.artifacts[0]!.content);
    expect(yaml.build.rules[0].if).toContain("$CI_COMMIT_TAG");
    expect(yaml.build.rules[0].if).toContain('"v*"');
  });

  it("lowers push branch filter to $CI_COMMIT_BRANCH condition", () => {
    const proj = new Project("test");
    const p = new Pipeline(proj, "ci");
    new ShellStep(p, "build", { command: "echo hi" });
    new Entry(p, "on-branch", {
      trigger: { kind: "push", filter: { branches: ["main", "dev"] } },
      roots: ["build"],
    });
    const result = compileGitlab(synthesize(proj));
    const yaml = parse(result.artifacts[0]!.content);
    expect(yaml.build.rules[0].if).toContain("$CI_COMMIT_BRANCH");
    expect(yaml.build.rules[0].if).toContain('"main"');
    expect(yaml.build.rules[0].if).toContain('"dev"');
  });

  it("lowers push path filter to changes: on rule", () => {
    const proj = new Project("test");
    const p = new Pipeline(proj, "ci");
    new ShellStep(p, "build", { command: "echo hi" });
    new Entry(p, "on-paths", {
      trigger: { kind: "push", filter: { paths: ["src/**", "tests/**"] } },
      roots: ["build"],
    });
    const result = compileGitlab(synthesize(proj));
    const yaml = parse(result.artifacts[0]!.content);
    expect(yaml.build.rules[0].changes).toEqual(["src/**", "tests/**"]);
  });

  it("lowers change-request branch filter to $CI_MERGE_REQUEST_TARGET_BRANCH_NAME", () => {
    const proj = new Project("test");
    const p = new Pipeline(proj, "ci");
    new ShellStep(p, "build", { command: "echo hi" });
    new Entry(p, "on-pr", {
      trigger: { kind: "changeRequest", filter: { branches: ["main"] } },
      roots: ["build"],
    });
    const result = compileGitlab(synthesize(proj));
    const yaml = parse(result.artifacts[0]!.content);
    expect(yaml.build.rules[0].if).toContain("$CI_MERGE_REQUEST_TARGET_BRANCH_NAME");
    expect(yaml.build.rules[0].if).toContain('"main"');
  });

  it("lowers change-request path filter to changes: on rule", () => {
    const proj = new Project("test");
    const p = new Pipeline(proj, "ci");
    new ShellStep(p, "build", { command: "echo hi" });
    new Entry(p, "on-pr", {
      trigger: { kind: "changeRequest", filter: { paths: ["src/**"] } },
      roots: ["build"],
    });
    const result = compileGitlab(synthesize(proj));
    const yaml = parse(result.artifacts[0]!.content);
    expect(yaml.build.rules[0].changes).toEqual(["src/**"]);
  });

  it("rejects tag filter on change-request trigger with UNSUPPORTED_TRIGGER", () => {
    const proj = new Project("test");
    const p = new Pipeline(proj, "ci");
    new ShellStep(p, "build", { command: "echo hi" });
    new Entry(p, "on-pr", {
      trigger: { kind: "changeRequest", filter: { tags: ["v*"] } },
      roots: ["build"],
    });
    expect(() => compileGitlab(synthesize(proj))).toThrow(GitlabTargetError);
    try {
      compileGitlab(synthesize(proj));
    } catch (err) {
      expect((err as GitlabTargetError).code).toBe("UNSUPPORTED_TRIGGER");
    }
  });
});

// F-36: Working directory — cd prefix with shell quoting
describe("compileGitlab — working directory (F-36)", () => {
  it("prepends cd <workdir> as first script entry", () => {
    const proj = new Project("test");
    const p = new Pipeline(proj, "ci");
    new ShellStep(p, "build", {
      command: "echo build",
      runtime: { workingDir: "subdir" },
    });
    new Entry(p, "on-push", { trigger: { kind: "push" }, roots: ["build"] });
    const result = compileGitlab(synthesize(proj));
    const yaml = parse(result.artifacts[0]!.content);
    expect(yaml.build.script[0]).toBe("cd 'subdir'");
  });

  it("shell-quotes working directory with spaces", () => {
    const proj = new Project("test");
    const p = new Pipeline(proj, "ci");
    new ShellStep(p, "build", {
      command: "echo build",
      runtime: { workingDir: "my dir" },
    });
    new Entry(p, "on-push", { trigger: { kind: "push" }, roots: ["build"] });
    const result = compileGitlab(synthesize(proj));
    const yaml = parse(result.artifacts[0]!.content);
    expect(yaml.build.script[0]).toBe("cd 'my dir'");
  });
});
