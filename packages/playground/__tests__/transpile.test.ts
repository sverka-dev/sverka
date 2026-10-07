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
    expect(out).toMatch(/new ShellStep\(pl, "a", \{ command: "echo 'TODO/);
    expect(out).toContain('dependsOn: ["a"]');
  });

  it("preserves the entry's trigger and roots verbatim", () => {
    const out = toSverkaConfig(DEFAULT_CODE);
    expect(out).toContain('new Entry(checks, "on-push"');
    expect(out).toContain('roots: ["test"]');
    expect(out).toContain('{ kind: "push" }');
  });

  it("does not let braces inside comments close the props object", () => {
    const src = `import { Project, Pipeline, FunctionStep, Entry } from "@sverka/playground";
const proj = new Project("p");
const pl = new Pipeline(proj, "checks");
new FunctionStep(pl, "a", {
  fn: () => {
    // } would close props if comments counted as syntax
    const x = { a: 1 }; // don't run /* } */
    return [];
  },
});
export default proj;
`;
    const out = toSverkaConfig(src);
    expect(out).toContain('new ShellStep(pl, "a"');
    expect(evalConfig(out)).toBeInstanceOf(Project);
  });

  it("keeps brackets inside strings when balancing prop values", () => {
    const src = `import { Project, Pipeline, FunctionStep, Entry } from "@sverka/playground";
const proj = new Project("p");
const pl = new Pipeline(proj, "checks");
new FunctionStep(pl, "a", { fn: () => [], dependencies: ["a]b", "c"] });
export default proj;
`;
    const out = toSverkaConfig(src);
    expect(out).toContain('dependsOn: ["a]b", "c"]');
  });

  it("rewrites aliased FunctionStep imports and their constructor calls", () => {
    const src = `import { Project, Pipeline, FunctionStep as Fn, Entry } from "@sverka/playground";
const proj = new Project("p");
const pl = new Pipeline(proj, "checks");
new Fn(pl, "a", { fn: () => [] });
export default proj;
`;
    const out = toSverkaConfig(src);
    expect(out).toContain("ShellStep as Fn");
    expect(out).toContain('new ShellStep(pl, "a"');
    expect(evalConfig(out)).toBeInstanceOf(Project);
  });

  it("never injects a step id into the shell command unquoted", () => {
    const src = `import { Project, Pipeline, FunctionStep } from "@sverka/playground";
const proj = new Project("p");
const pl = new Pipeline(proj, "checks");
new FunctionStep(pl, "a$(touch /tmp/pwned)b", { fn: () => [] });
export default proj;
`;
    const out = toSverkaConfig(src);
    // The id is wrapped in shell single quotes — $(…) stays literal.
    expect(out).toContain("port 'a$(touch /tmp/pwned)b'");
    expect(out).not.toMatch(/echo "TODO[^']*\$\(/);
  });

  it("throws TRANSPILE_FAILED on a template-literal step id", () => {
    const src = `import { Project, Pipeline, FunctionStep } from "@sverka/playground";
const proj = new Project("p");
const pl = new Pipeline(proj, "checks");
new FunctionStep(pl, \`step-\${name}\`, { fn: () => [] });
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
    try {
      toSverkaConfig(src);
      expect.unreachable();
    } catch (e) {
      expect(e).toBeInstanceOf(PlaygroundError);
      expect((e as PlaygroundError).code).toBe("TRANSPILE_FAILED");
    }
  });

  it("ignores a dependencies key nested inside fn", () => {
    const src = `import { Project, Pipeline, FunctionStep } from "@sverka/playground";
const proj = new Project("p");
const pl = new Pipeline(proj, "checks");
new FunctionStep(pl, "a", { fn: () => { const dependencies = ["z"]; return []; } });
export default proj;
`;
    const out = toSverkaConfig(src);
    expect(out).not.toContain("dependsOn");
  });

  it("keeps the newline after a semicolon-free import", () => {
    const src = `import { Project, Pipeline } from "@sverka/playground"
const proj = new Project("p");
export default proj;
`;
    const out = toSverkaConfig(src);
    expect(out).toContain('from "@sverka/workflow"\n');
    expect(out).not.toContain('"@sverka/workflow"const');
  });

  it("does not rewrite a FunctionStep call inside a comment or string", () => {
    const src = `import { Project, Pipeline, FunctionStep } from "@sverka/playground";
const proj = new Project("p");
const pl = new Pipeline(proj, "checks");
// new FunctionStep(pl, "doc-only", { fn: () => [] })
const doc = "new FunctionStep(pl, \\"in-string\\", { fn: () => [] })";
new FunctionStep(pl, "real", { fn: () => [] });
export default proj;
`;
    const out = toSverkaConfig(src);
    expect(out).toContain('new FunctionStep(pl, "doc-only"');
    // The string literal survives verbatim — quotes escaped as authored.
    expect(out).toContain('"new FunctionStep(pl, \\"in-string\\"');
    expect(out).toContain('new ShellStep(pl, "real"');
  });

  it("strips a tail comment after a final dependencies prop", () => {
    const src = `import { Project, Pipeline, FunctionStep } from "@sverka/playground";
const proj = new Project("p");
const pl = new Pipeline(proj, "checks");
new FunctionStep(pl, "a", { dependencies: [] // no deps
});
export default proj;
`;
    const out = toSverkaConfig(src);
    expect(out).toContain("dependsOn: [] }");
  });
});
