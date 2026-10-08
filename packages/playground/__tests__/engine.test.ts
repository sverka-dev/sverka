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
    // `export default` shares the `/` line: a `/` mis-scanned as a regex
    // eats the statement whole (unterminated regex to EOL), so `return`
    // would vanish — the test actually fails on a regression.
    const src = "const a = 8 / 2; export default a;";
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

describe("scanner: contextual keywords as identifiers (review findings)", () => {
  // `of`/`as`/`from`/`get`/`set`/`type`/`async`/`declare` act as ordinary
  // identifiers in most positions — a `/` after them divides. While they
  // sat in NON_OPERAND_WORDS the `/` opened a regex scan that ran to the
  // next `/` or newline, swallowing a `}` on the same line: the block
  // never popped, `export default` stayed a keyword, and eval threw.
  for (const word of [
    "of",
    "as",
    "from",
    "get",
    "set",
    "type",
    "async",
    "declare",
  ]) {
    it(`division after an identifier named ${word} is not a regex`, () => {
      const src = `const ${word} = 4;\nfunction f() { return ${word} / 2; }\nexport default f;`;
      const out = preprocessCode(src);
      expect(out).toContain(`return ${word} / 2; }`);
      expect(out).toContain("return f");
    });
  }

  it("a division chain after `of` scans all three operands", () => {
    const src = "const of = 4;\nconst r = of / 2 / 1;\nexport default r;";
    const out = preprocessCode(src);
    expect(out).toContain("of / 2 / 1");
    expect(out).toContain("return r");
  });

  it("evaluates code that divides by an `of` variable", () => {
    // The false regex used to swallow the `}` closing `f`, so `export`
    // stayed a keyword and `new Function` threw SyntaxError. The id
    // proves `of / 2` actually divided.
    const src = `import { Project } from "@sverka/playground";
const of = 4;
function f() { return of / 2; }
export default new Project("p-" + f());`;
    expect(evaluateUserCode(src).id).toBe("p-2");
  });
});

describe("scanner: operand-tracking edges (PR #320/#321 review debt)", () => {
  it("`if (x) /re/` opens a regex after the control `)`", () => {
    // A `)` closing a control-flow header precedes a statement — the
    // `/` is not division. `/[{]/` carries a brace: scanned as division
    // it pushes an expr frame that `export default` then sits inside.
    const src = "const y = true; if (y) /[{]/g; export default y;";
    const out = preprocessCode(src);
    expect(out).toContain("/[{]/g");
    expect(out).toContain("return y");
  });

  it("`while (x) /re/` and `for (x) /re/` open regexes too", () => {
    const src =
      "let y = 0; while (y < 0) /a/; for (let i = 0; i < 1; i++) /[{]/; export default y;";
    const out = preprocessCode(src);
    expect(out).toContain("return y");
  });

  it("a `/` after a grouping `)` or call `)` still divides", () => {
    const src =
      "const f = () => 8; const a = (4) / 2; const b = f() / 2; export default a + b;";
    const out = preprocessCode(src);
    expect(out).toContain("return a + b");
  });

  it("postfix `++`/`--` end the operand — `i++ / 2` divides", () => {
    const src = "let i = 4; i++ / 2; let j = i-- / 2; export default i;";
    const out = preprocessCode(src);
    expect(out).toContain("return i");
  });

  it("numeric literals end the operand — `1.5 / 2` and `5. / 2` divide", () => {
    // `5.` is a complete numeric literal: its trailing `.` is not member
    // access, so the `/` after it divides.
    const src = "const a = 1.5 / 2; const b = 5. / 2; export default a + b;";
    const out = preprocessCode(src);
    expect(out).toContain("return a + b");
  });

  it("`of` is an identifier outside `for (` headers — `of / 2` divides", () => {
    const src = "const of = 8; const b = of / 2; export default b;";
    const out = preprocessCode(src);
    expect(out).toContain("return b");
  });

  it("`for (x of /re/)` still scans a regex, not division", () => {
    const src = "for (const x of /[{]/) { x; } export default 1;";
    const out = preprocessCode(src);
    expect(out).toContain("return 1");
  });

  it("`for await (x of /re/)` keeps the for-header context", () => {
    const src = "for await (const x of /[{]/) { x; } export default 1;";
    const out = preprocessCode(src);
    expect(out).toContain("return 1");
  });

  it("contextual words are identifiers — `async / 2` divides", () => {
    const src =
      "const async = 8; const b = async / 2; const get = 4; const c = get / 2; export default b + c;";
    const out = preprocessCode(src);
    expect(out).toContain("return b + c");
  });

  it("a `//` comment ends at CR, U+2028 and U+2029, not only LF", () => {
    // Each terminator must release the code after it — a comment that
    // only stops at LF would swallow `export default` into the comment.
    for (const lt of ["\r", "\u2028", "\u2029"]) {
      const out = preprocessCode(`// note${lt}export default 1;`);
      expect(out).toContain("return 1");
    }
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
