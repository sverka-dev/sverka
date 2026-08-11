import { describe, it, expect } from "vitest";
import * as api from "../index.js";
import type { GitlabCompilerConfig, GitlabRule } from "../index.js";

describe("public API", () => {
  it("exports compileGitlabCi", () => {
    expect(typeof api.compileGitlabCi).toBe("function");
  });

  it("exports config types (type-only, checked via import)", () => {
    // Type-only exports are erased at runtime; verify the module loads.
    expect(api).toBeDefined();

    // Reference both types in a typed fixture so compilation fails if either
    // export is removed.
    const _config: GitlabCompilerConfig = { image: "oven/bun:latest" };
    const _rule: GitlabRule = { if: '$CI_PIPELINE_SOURCE == "push"' };
    void _config;
    void _rule;
  });

  it("does not export unexpected runtime values", () => {
    const runtimeKeys = Object.keys(api).sort();
    expect(runtimeKeys).toEqual(["compileGitlabCi"]);
  });
});
