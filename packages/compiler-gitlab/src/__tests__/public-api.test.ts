import { describe, it, expect } from "vitest";
import * as api from "../index.js";

describe("public API", () => {
  it("exports compileGitlabCi", () => {
    expect(typeof api.compileGitlabCi).toBe("function");
  });

  it("exports config types (type-only, checked via import)", () => {
    // Type-only exports are erased at runtime; verify the module loads.
    expect(api).toBeDefined();
  });

  it("does not export unexpected runtime values", () => {
    const runtimeKeys = Object.keys(api).sort();
    expect(runtimeKeys).toEqual(["compileGitlabCi"]);
  });
});
