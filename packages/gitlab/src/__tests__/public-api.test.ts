import { describe, it, expect } from "vitest";
import {
  GitlabTarget,
  compileGitlab,
  gitlabCapabilities,
  GitlabTargetError,
  type GitlabTargetGraph,
  type GitlabJob,
  type GitlabRule,
  type GitlabArtifactSpec,
  type GeneratedArtifact,
  type TargetDiagnostic,
  type CompilationResult,
  type GitlabTargetErrorCode,
} from "../index.js";

describe("public API — exports", () => {
  it("exports all functions and classes", () => {
    expect(typeof GitlabTarget).toBe("function");
    expect(typeof compileGitlab).toBe("function");
    expect(gitlabCapabilities).toBeDefined();
    expect(gitlabCapabilities["trigger.push"]).toBe("native");
  });

  it("exports GitlabTargetError class", () => {
    const err = new GitlabTargetError("msg", "INVALID_GRAPH");
    expect(err).toBeInstanceOf(Error);
    expect(err.name).toBe("GitlabTargetError");
    expect(err.code).toBe("INVALID_GRAPH");
    expect(err.cause).toBeUndefined();
  });

  it("all types are importable (compile-time check)", () => {
    const _graph: GitlabTargetGraph = {
      name: "ci",
      stages: [],
      jobs: [],
      variables: {},
    };
    const _job: GitlabJob = {
      id: "build",
      stage: "build",
      needs: [],
      script: [],
    };
    const _rule: GitlabRule = { if: "true" };
    const _artifact: GitlabArtifactSpec = { paths: ["dist"] };
    const _generated: GeneratedArtifact = { path: "test.yml", content: "" };
    const _diag: TargetDiagnostic = {
      capability: "x",
      support: "native",
      severity: "info",
      message: "ok",
    };
    const _result: CompilationResult = { artifacts: [], diagnostics: [] };
    const _code: GitlabTargetErrorCode = "INVALID_GRAPH";
    expect(_graph.name).toBe("ci");
    expect(_job.id).toBe("build");
    expect(_rule.if).toBe("true");
    expect(_artifact.paths).toEqual(["dist"]);
    expect(_generated.path).toBe("test.yml");
    expect(_diag.capability).toBe("x");
    expect(_result.artifacts).toHaveLength(0);
    expect(_code).toBe("INVALID_GRAPH");
  });
});
