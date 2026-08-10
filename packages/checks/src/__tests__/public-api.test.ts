import { describe, it, expect } from "vitest";
import * as api from "../index.js";

describe("public API", () => {
  it("exports CheckResolver type (type-only, not a runtime value)", () => {
    // Type-only exports are not present as runtime values; verify the module
    // compiles with the import. We check runtime exports below.
    expect(typeof api).toBe("object");
  });

  it("exports createBuiltinResolver function", () => {
    expect(typeof api.createBuiltinResolver).toBe("function");
  });

  it("exports extractFindings function", () => {
    expect(typeof api.extractFindings).toBe("function");
  });

  it("exports CheckError class", () => {
    expect(typeof api.CheckError).toBe("function");
    expect(new api.CheckError("x", "RESOLUTION_FAILED")).toBeInstanceOf(Error);
  });

  it("does not export unexpected runtime values", () => {
    const runtimeKeys = Object.keys(api).sort();
    expect(runtimeKeys).toEqual(["CheckError", "createBuiltinResolver", "extractFindings"]);
  });
});
