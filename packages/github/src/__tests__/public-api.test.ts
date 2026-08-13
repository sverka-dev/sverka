import { describe, it, expect } from "vitest";
import {
  GithubTarget,
  compileGithub,
  githubCapabilities,
  GithubTargetError,
  type GithubTargetGraph,
  type GithubTriggers,
  type GithubJob,
  type GithubStep,
  type GeneratedArtifact,
  type TargetDiagnostic,
  type CompilationResult,
  type GithubTargetErrorCode,
} from "../index.js";

describe("public API — exports", () => {
  it("exports all functions and classes", () => {
    expect(typeof GithubTarget).toBe("function");
    expect(typeof compileGithub).toBe("function");
    expect(githubCapabilities).toBeDefined();
    expect(githubCapabilities["trigger.push"]).toBe("native");
  });

  it("exports GithubTargetError class", () => {
    const err = new GithubTargetError("msg", "INVALID_GRAPH");
    expect(err).toBeInstanceOf(Error);
    expect(err.name).toBe("GithubTargetError");
    expect(err.code).toBe("INVALID_GRAPH");
    expect(err.cause).toBeUndefined();
  });

  it("all types are importable (compile-time check)", () => {
    const _graph: GithubTargetGraph = {
      name: "ci",
      on: {},
      jobs: [],
      env: {},
    };
    const _triggers: GithubTriggers = { push: {} };
    const _job: GithubJob = {
      id: "build",
      name: "build",
      runsOn: "ubuntu-latest",
      needs: [],
      steps: [],
    };
    const _step: GithubStep = { run: "echo hi" };
    const _artifact: GeneratedArtifact = { path: "test.yml", content: "" };
    const _diag: TargetDiagnostic = {
      capability: "x",
      support: "native",
      severity: "info",
      message: "ok",
    };
    const _result: CompilationResult = { artifacts: [], diagnostics: [] };
    const _code: GithubTargetErrorCode = "INVALID_GRAPH";
    expect(_graph.name).toBe("ci");
    expect(_job.id).toBe("build");
    expect(_step.run).toBe("echo hi");
    expect(_artifact.path).toBe("test.yml");
    expect(_diag.capability).toBe("x");
    expect(_result.artifacts).toHaveLength(0);
    expect(_code).toBe("INVALID_GRAPH");
  });
});
