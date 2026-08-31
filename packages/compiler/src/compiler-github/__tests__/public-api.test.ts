import { describe, it, expect } from "vitest";
import * as api from "../index.js";
import type { GithubCompilerConfig } from "../index.js";

type _TypeExportCheck = GithubCompilerConfig;

describe("public API", () => {
  it("exports compileGithubWorkflow", () => {
    expect(typeof api.compileGithubWorkflow).toBe("function");
  });

  it("exports config types (type-only, checked via import)", () => {
    // Type-only exports are erased at runtime; verify the module loads.
    expect(api).toBeDefined();
  });

  it("does not export unexpected runtime values", () => {
    const runtimeKeys = Object.keys(api).sort();
    expect(runtimeKeys).toEqual(["compileGithubWorkflow"]);
  });
});
