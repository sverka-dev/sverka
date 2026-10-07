import { describe, it, expect } from "vitest";
import { listExamples, evaluateUserCode, runPipeline } from "../src/index.js";

// Vitest runs under vite — import.meta.glob resolves here the same way
// app.ts uses it in the web build.
const examples = listExamples(
  import.meta.glob("../../../examples/*/sverka.config.ts", {
    query: "?raw",
    import: "default",
    eager: true,
  }) as Record<string, string>,
);

describe("examples gallery (spec 53.6)", () => {
  it("every examples/*/ entry appears in the picker list", () => {
    expect(examples.length).toBeGreaterThanOrEqual(3);
    for (const ex of examples) {
      expect(ex.id.length).toBeGreaterThan(0);
      expect(ex.code).toContain("sverka/workflow");
    }
    // Known examples shipped with the repo
    const ids = examples.map((e) => e.id);
    expect(ids).toContain("all-green");
    expect(ids).toContain("failing-checks");
    expect(ids).toContain("sarif-findings");
  });

  it("a gallery config evaluates and runs — shell steps surface demo findings", async () => {
    const allGreen = examples.find((e) => e.id === "all-green");
    expect(allGreen).toBeDefined();
    const proj = evaluateUserCode(allGreen!.code);
    const result = await runPipeline(proj);
    expect(result.steps.length).toBeGreaterThan(0);
    // Shell steps report an info finding instead of executing.
    expect(result.findings.length).toBeGreaterThan(0);
    expect(
      result.findings.every((f) => f.rule === "playground/shell-step"),
    ).toBe(true);
    // The demo finding never echoes the shell command — it may carry
    // inline secrets, and findings end up in share links. The example's
    // commands are `bun run …`.
    expect(
      result.findings.some((f) => f.message.includes("bun run")),
    ).toBe(false);
  });
});
