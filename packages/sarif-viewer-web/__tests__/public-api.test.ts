import { describe, it, expect } from "vitest";
import * as api from "../src/index.js";

describe("public-api", () => {
  it("exports generateSarifHtml function", () => {
    expect(typeof api.generateSarifHtml).toBe("function");
  });

  it("exports renderSarifWeb function", () => {
    expect(typeof api.renderSarifWeb).toBe("function");
  });

  it("exports resolveFindings function", () => {
    expect(typeof api.resolveFindings).toBe("function");
  });

  it("exports DEFAULT_NORMALIZE_CONTEXT", () => {
    expect(api.DEFAULT_NORMALIZE_CONTEXT).toBeDefined();
    expect(api.DEFAULT_NORMALIZE_CONTEXT.checkIdPrefix).toBe("");
  });

  it("type exports: SarifWebOptions", () => {
    // Type-only export — verify the module compiles with the type.
    type T = import("../src/index.js").SarifWebOptions;
    const _t: T = { outputPath: "/tmp/x.html" };
    expect(_t.outputPath).toBe("/tmp/x.html");
  });
});
