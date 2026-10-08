// engine.ts — preprocessCode scanner regression tests (Spec 53.4 review).
// The scanner rewrites module syntax for `new Function` eval; every case
// below was a review finding where valid code was corrupted.
// cspell:ignore exporté

import { describe, it, expect } from "vitest";
import { preprocessCode, evaluateUserCode } from "../src/engine.js";
import { scanString } from "../src/scanner.js";

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

  it("keeps a dynamic import(…) mid-expression", () => {
    const src = 'const m = import ("./x.js");\nexport default 1;';
    const out = preprocessCode(src);
    expect(out).toContain('import ("./x.js")');
  });

  it("keeps a dynamic import(…) at statement position", () => {
    // The `nc === "("` guard in tryImport — `import (` opening a statement
    // must stay verbatim, not be eaten as a static import statement.
    const src = 'import ("./x.js");\nexport default 1;';
    const out = preprocessCode(src);
    expect(out).toContain('import ("./x.js")');
    expect(out).toContain("return 1");
  });

  it("keeps import.meta mid-expression", () => {
    const src = "const u = import .meta.url;\nexport default 1;";
    const out = preprocessCode(src);
    expect(out).toContain("import .meta.url");
  });

  it("keeps import.meta at statement position", () => {
    // Same for `nc === "."` — a statement starting `import .meta` is the
    // meta form, never a module specifier.
    const src = "import .meta.url;\nexport default 1;";
    const out = preprocessCode(src);
    expect(out).toContain("import .meta.url");
    expect(out).toContain("return 1");
  });

  it("does not eat the statement after a semicolon-less export list", () => {
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
    // Proves the `export` key survived preprocessing — the project's id
    // is built from it, so a stripped key would produce a different id.
    expect(proj.id).toBe("p-key");
  });
});

describe("scanner: regex literals and unicode (review findings)", () => {
  it("a regex literal containing braces does not unbalance the stack", () => {
    // `/[{]/` used to push an `expr` brace that never popped — the stack
    // stayed non-block so `export default` was never rewritten and eval
    // hit a SyntaxError.
    const src = "const r = /[{]/;\nexport default 1;";
    const out = preprocessCode(src);
    expect(out).toContain("/[{]/");
    expect(out).toContain("return 1");
  });

  it("a regex inside ${} does not swallow the rest of the template", () => {
    const src = 'const t = `a ${ /"/.test(x) } b`;\nexport default 1;';
    const out = preprocessCode(src);
    expect(out).toContain('`a ${ /"/.test(x) } b`');
    expect(out).toContain("return 1");
  });

  it("a ${} expression starting with a string scans every char", () => {
    // scanTemplateExpr started past the first expression char — `${ "x" }`
    // skipped the opening quote and mis-scanned the template.
    const src = 'const t = `pre ${ "mid" } post`;\nexport default 1;';
    const out = preprocessCode(src);
    expect(out).toContain('`pre ${ "mid" } post`');
    expect(out).toContain("return 1");
  });

  it("a division after an operand is not scanned as a regex", () => {
    const src = "const a = 8 / 2;\nexport default a;";
    const out = preprocessCode(src);
    expect(out).toContain("8 / 2");
    expect(out).toContain("return a");
  });

  it("unicode identifiers do not match keyword boundaries", () => {
    // `exporté` is a valid JS identifier — an ASCII-only boundary check
    // used to strip `export` and leave `é` behind as broken syntax.
    const src = "const exporté = 1;\nexport default exporté;";
    const out = preprocessCode(src);
    expect(out).toContain("exporté");
    expect(out).toContain("return exporté");
  });
});

describe("scanner: template nesting depth cap", () => {
  // n nested templates — each one sits inside the parent's `${ }`:
  // nest(2) = "`${`x`}`", nest(3) = "`${`${`x`}`}`", …
  const nest = (n: number) => "`${".repeat(n - 1) + "`x`" + "}`".repeat(n - 1);

  it("scans templates nested a few levels deep", () => {
    const src = "const t = `a ${ `b ${ `c` }` }`;\nexport default 1;";
    const out = preprocessCode(src);
    expect(out).toContain("`a ${ `b ${ `c` }` }`");
    expect(out).toContain("return 1");
  });

  it("bails past the depth cap instead of exhausting the stack", () => {
    // 500 nested `${` hops would overflow the browser call stack through
    // the scanString ↔ scanTemplateExpr recursion — a crafted share link.
    // The cap treats the tail as opaque: the scan completes and the
    // `export default` inside it is left verbatim, not rewritten.
    const src = "const t = " + nest(500) + ";\nexport default 1;";
    const out = preprocessCode(src);
    expect(out).toContain("export default 1;");
  });

  it("scanString returns code.length when the cap trips", () => {
    // Uncapped, the outer template would end at its closing backtick —
    // before the trailing text. The cap reports the whole tail as inside
    // the (unterminated-looking) template instead.
    const src = nest(500) + "; tail";
    expect(scanString(src, 0)).toBe(src.length);
  });
});
