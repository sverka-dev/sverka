import { describe, it, expect } from "vitest";
import * as api from "../src/index.js";

describe("public-api", () => {
  it("exports renderSarifTui function", () => {
    expect(typeof api.renderSarifTui).toBe("function");
  });

  it("exports SarifTuiApp component", () => {
    expect(typeof api.SarifTuiApp).toBe("function");
  });

  it("exports TuiStore class", () => {
    expect(typeof api.TuiStore).toBe("function");
  });

  it("exports resolveFindings function", () => {
    expect(typeof api.resolveFindings).toBe("function");
  });

  it("exports pure helpers", () => {
    expect(typeof api.filterBySeverity).toBe("function");
    expect(typeof api.searchFindings).toBe("function");
    expect(typeof api.sortFindings).toBe("function");
    expect(typeof api.severityRank).toBe("function");
    expect(Array.isArray(api.SEVERITY_FILTERS)).toBe(true);
  });

  it("exports DEFAULT_NORMALIZE_CONTEXT", () => {
    expect(api.DEFAULT_NORMALIZE_CONTEXT).toBeDefined();
    expect(api.DEFAULT_NORMALIZE_CONTEXT.checkIdPrefix).toBe("");
    expect(api.DEFAULT_NORMALIZE_CONTEXT.defaultConfidence).toBe(0.5);
  });

  it("type exports: SarifTuiOptions, ViewerFilter, SortMode", () => {
    // Type-only exports — verify they don't crash at runtime via the module.
    // The types are erased; we assert the module loaded without error.
    expect(api).toBeDefined();
  });
});
