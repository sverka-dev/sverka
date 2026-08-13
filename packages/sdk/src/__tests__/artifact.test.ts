import { describe, it, expect } from "vitest";
import { artifact } from "../artifact.js";

describe("artifact", () => {
  it("creates an artifact output declaration with path", () => {
    expect(artifact("./dist")).toEqual({ type: "artifact", path: "./dist" });
  });

  it("creates an artifact with absolute path", () => {
    expect(artifact("/build/output")).toEqual({ type: "artifact", path: "/build/output" });
  });
});
