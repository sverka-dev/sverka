import { describe, it, expect } from "vitest";
import { toSverkaConfig, PlaygroundError, DEFAULT_CODE } from "../src/index.js";
import { preprocessCode } from "../src/engine.js";
import { Project, Pipeline, ShellStep, Entry } from "@sverka/workflow";

/** Evaluate a transpiled config with the REAL @sverka/workflow constructs. */
function evalConfig(source: string): unknown {
  const processed = preprocessCode(source);
  const fn = new Function(
    "Project",
    "Pipeline",
    "ShellStep",
    "Entry",
    processed,
  );
  return fn(Project, Pipeline, ShellStep, Entry);
}

describe("toSverkaConfig (spec 53.5)", () => {
  it("rewrites the import to @sverka/workflow", () => {
    const out = toSverkaConfig(DEFAULT_CODE);
    expect(out).toContain('} from "@sverka/workflow"');
    expect(out).not.toContain("@sverka/playground");
    expect(out).toContain("ShellStep");
    expect(out).not.toContain("FunctionStep");
  });

  it("replaces fn bodies with TODO shell commands, keeps dependencies", () => {
    const src = `import { Project, Pipeline, FunctionStep, Entry } from "@sverka/playground";
const proj = new Project("p");
const pl = new Pipeline(proj, "checks");
new FunctionStep(pl, "a", { fn: () => [] });
new FunctionStep(pl, "b", { fn: () => [], dependencies: ["a"] });
export default proj;
`;
    const out = toSverkaConfig(src);
    expect(out).toMatch(/new ShellStep\(pl, "a", \{ command: "echo \\"TODO/);
    expect(out).toContain('dependsOn: ["a"]');
  });

  it("emitted config evaluates against the real constructs", () => {
    const out = toSverkaConfig(DEFAULT_CODE);
    const proj = evalConfig(out);
    expect(proj).toBeInstanceOf(Project);
    const pipeline = (proj as Project).node.children.find(
      (c) => c.node.id === "checks",
    );
    expect(pipeline).toBeDefined();
  });

  it("throws TRANSPILE_FAILED on an unparseable step", () => {
    const src = `import { Project, Pipeline, FunctionStep } from "@sverka/playground";
const proj = new Project("p");
const pl = new Pipeline(proj, "checks");
new FunctionStep(pl, dynamicId, { fn: () => [] });
export default proj;
`;
    try {
      toSverkaConfig(src);
      expect.unreachable();
    } catch (e) {
      expect(e).toBeInstanceOf(PlaygroundError);
      expect((e as PlaygroundError).code).toBe("TRANSPILE_FAILED");
    }
  });

  it("throws TRANSPILE_FAILED on unbalanced props", () => {
    const src = `new FunctionStep(pl, "x", { fn: () => [`;
    expect(() => toSverkaConfig(src)).toThrow(PlaygroundError);
  });
});
