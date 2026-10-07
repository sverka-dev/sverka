// engine.ts — preprocessCode scanner regression tests (Spec 53.4 review).
// The scanner rewrites module syntax for `new Function` eval; every case
// below was a review finding where valid code was corrupted.

import { describe, it, expect } from "vitest";
import { preprocessCode, evaluateUserCode } from "../src/engine.js";

describe("preprocessCode scanner", () => {
  it("keeps object keys named import/export", () => {
    const src = `const m = { import: 1, export: 2 };
export default m;`;
    const out = preprocessCode(src);
    expect(out).toContain("{ import: 1, export: 2 }");
    expect(out).toContain("return m");
  });

  it("survives a quoted backtick inside a template ${}", () => {
    const src = 'const t = `tick ${ x["`"] } end`;\nexport default 1;';
    const out = preprocessCode(src);
    expect(out).toContain("return 1");
  });

  it("handles export /* comment */ default", () => {
    const src = "const proj = 42;\nexport /* keep */ default proj;";
    const out = preprocessCode(src);
    expect(out).toContain("return proj");
    expect(out).not.toContain("default proj");
  });

  it("handles export\\ndefault split across lines", () => {
    const src = "const proj = 7;\nexport\ndefault proj;";
    const out = preprocessCode(src);
    expect(out).toContain("return proj");
  });

  it("joins `return` and the expression — no ASI on `export default\\nproj`", () => {
    const src = "export default\nproj;";
    const out = preprocessCode(src);
    expect(out).toMatch(/return\s+proj/);
    expect(out).not.toMatch(/return\s*\n\s*proj/);
  });

  it("keeps a dynamic import(…) at statement position", () => {
    const src = 'const m = import ("./x.js");\nexport default 1;';
    const out = preprocessCode(src);
    expect(out).toContain('import ("./x.js")');
  });

  it("keeps import.meta at statement position", () => {
    const src = "const u = import .meta.url;\nexport default 1;";
    const out = preprocessCode(src);
    expect(out).toContain("import .meta.url");
  });

  it("does not eat the statement after a semicolonless export list", () => {
    const src = `const a = 1;
export { a }
const proj = a;
export default proj;`;
    const out = preprocessCode(src);
    expect(out).toContain("const proj = a;");
    expect(out).toContain("return proj");
    expect(out).not.toContain("export { a }");
  });

  it("eats `export {…} from` including the specifier", () => {
    const src = `const a = 1;
export { a } from "./re-export.js";
export default 1;`;
    const out = preprocessCode(src);
    expect(out).not.toContain("from");
    expect(out).toContain("return 1");
  });

  it("handles a block containing statements", () => {
    const src = `{
  const inner = 1;
}
export default inner;`;
    // `inner` leaks past the block — preprocess only; eval correctness
    // isn't asserted, just that `export default` is still rewritten.
    const out = preprocessCode(src);
    expect(out).toContain("return inner");
  });
});

describe("evaluateUserCode end-to-end", () => {
  it("evaluates a config with an `export`-named object key", () => {
    const src = `import { Project } from "@sverka/playground";
const meta = { export: "key" };
export default new Project("p-" + meta.export);
`;
    const proj = evaluateUserCode(src);
    expect(proj).toBeDefined();
  });
});
