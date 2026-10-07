// @sverka/playground — shared mini-scanner primitives.
// Char-class checks instead of regexes (a pattern evaluated against user
// source is ReDoS surface); every helper is string/comment/regex aware so
// quoted or literal braces never count as syntax. All scans are linear.

// --- char classes --------------------------------------------------------

/** Whitespace per the JS grammar: \t \n \v \f \r space, NBSP, the unicode
 *  space separators, and ZWNBSP. */
export function isWsChar(c: string | undefined): boolean {
  if (c === undefined) return false;
  const n = c.charCodeAt(0);
  if ((n >= 9 && n <= 13) || n === 32) return true;
  return (
    n === 0xa0 ||
    n === 0x1680 ||
    (n >= 0x2000 && n <= 0x200a) ||
    n === 0x2028 ||
    n === 0x2029 ||
    n === 0x202f ||
    n === 0x205f ||
    n === 0x3000 ||
    n === 0xfeff
  );
}

/** Identifier-part chars, approximated: ASCII ident chars plus any
 *  non-ASCII char that isn't JS whitespace — `export` + a non-ASCII
 *  letter keeps its boundary. Over-approximation only ever suppresses
 *  a false keyword match — it never corrupts code. */
export function isIdentChar(c: string | undefined): boolean {
  if (c === undefined) return false;
  const n = c.charCodeAt(0);
  if (n >= 0x80) return !isWsChar(c);
  return (
    (n >= 48 && n <= 57) ||
    (n >= 65 && n <= 90) ||
    (n >= 97 && n <= 122) ||
    c === "_" ||
    c === "$"
  );
}

export function isQuote(c: string | undefined): boolean {
  return c === '"' || c === "'" || c === "`";
}

// --- skips ---------------------------------------------------------------

export function skipIdent(code: string, i: number): number {
  while (i < code.length && isIdentChar(code[i])) i++;
  return i;
}

/** Index of the `\n` ending the `//` comment at `at` (code.length if none). */
export function lineCommentEnd(code: string, at: number): number {
  const end = code.indexOf("\n", at + 2);
  return end === -1 ? code.length : end;
}

/** Index just past the `*/ ` ending the `; /*` comment at `at`. */
export function blockCommentEnd(code: string, at: number): number {
  const end = code.indexOf("*/", at + 2);
  return end === -1 ? code.length : end + 2;
}

/** True when `at` starts a `//` or `/*` comment. */
export function commentAt(code: string, at: number): boolean {
  return code[at] === "/" && (code[at + 1] === "/" || code[at + 1] === "*");
}

/** True when `at` opens a string literal or a comment. */
export function isOpaqueStart(code: string, at: number): boolean {
  return isQuote(code[at]) || commentAt(code, at);
}

/** End index of the string literal starting at `at` (quote char).
 *  Template literals may nest `${}` expressions — tracked by brace depth. */
export function scanString(code: string, at: number): number {
  const quote = code[at];
  let i = at + 1;
  while (i < code.length) {
    const c = code[i];
    if (c === "\\") {
      i += 2;
      continue;
    }
    if (c === quote) return i + 1;
    if (quote === "`" && c === "$" && code[i + 1] === "{") {
      i = scanTemplateExpr(code, i + 1);
      continue;
    }
    i++;
  }
  return i;
}

/** End index of a regex literal starting at `at` (`/`): closes at the
 *  first unescaped `/` outside a `[]` class, then consumes flags. Stops at
 *  a newline or EOF when unterminated — the evaluator reports the syntax. */
export function scanRegex(code: string, at: number): number {
  let i = at + 1;
  let inClass = false;
  while (i < code.length) {
    const c = code[i];
    if (c === "\\") {
      i += 2;
      continue;
    }
    if (c === "[") inClass = true;
    else if (c === "]") inClass = false;
    else if (c === "/" && !inClass) return skipIdent(code, i + 1);
    else if (c === "\n") return i;
    i++;
  }
  return i;
}

/** End index of the opaque region at `i`, or i+1 for ordinary chars —
 *  plus whether the region was a string literal (an operand). */
export function scanOpaqueEnd(
  code: string,
  i: number,
): { end: number; isString: boolean } {
  const c = code[i];
  if (isQuote(c)) return { end: scanString(code, i), isString: true };
  if (c === "/" && code[i + 1] === "/")
    return { end: lineCommentEnd(code, i), isString: false };
  if (c === "/" && code[i + 1] === "*")
    return { end: blockCommentEnd(code, i), isString: false };
  return { end: i + 1, isString: false };
}

/** Keywords and contextual keywords after which `/` opens a regex rather
 *  than divides. Everything else — plain identifiers plus literals such
 *  as `this`/`true` — ends an operand, making `/` a division. */
const NON_OPERAND_WORDS = new Set([
  "await",
  "break",
  "case",
  "catch",
  "class",
  "const",
  "continue",
  "debugger",
  "default",
  "delete",
  "do",
  "else",
  "enum",
  "export",
  "extends",
  "finally",
  "for",
  "function",
  "if",
  "implements",
  "import",
  "in",
  "instanceof",
  "interface",
  "let",
  "new",
  "package",
  "private",
  "protected",
  "public",
  "return",
  "static",
  "switch",
  "throw",
  "try",
  "typeof",
  "var",
  "void",
  "while",
  "with",
  "yield",
  "as",
  "async",
  "from",
  "get",
  "of",
  "set",
  "type",
  "declare",
]);

/** True when `word` ends an operand — a following `/` is division. */
export function operandAfterWord(word: string): boolean {
  return !NON_OPERAND_WORDS.has(word);
}

/**
 * End index of the `${` expression whose `{` is at `at`. Strings,
 *  comments, nested templates, and regex literals inside the expression
 *  are all skipped correctly: `` `${ x["`"] }` `` and `` `${ /"/ }` ``
 *  must not treat literal text as syntax.
 */
export function scanTemplateExpr(code: string, at: number): number {
  let depth = 1;
  let i = at + 1;
  let operandEnd = false;
  while (i < code.length && depth > 0) {
    const ch = code[i];
    const opaque = scanOpaqueEnd(code, i);
    if (opaque.end > i + 1) {
      if (opaque.isString) operandEnd = true;
      i = opaque.end;
      continue;
    }
    if (ch === "/" && !operandEnd) {
      i = scanRegex(code, i);
      operandEnd = true;
      continue;
    }
    if (isWsChar(ch)) {
      i++;
      continue;
    }
    if (isIdentChar(ch)) {
      const wend = skipIdent(code, i);
      operandEnd = operandAfterWord(code.slice(i, wend));
      i = wend;
      continue;
    }
    if (ch === "{") {
      depth++;
      operandEnd = false;
    } else if (ch === "}") {
      depth--;
      operandEnd = true;
    } else {
      operandEnd = false;
    }
    i++;
  }
  return i;
}

/**
 * Index of the `}` matching the `{` at `open`; -1 when unbalanced.
 *  Operand tracking decides whether a `/` divides or opens a regex —
 *  braces inside `/[{]/` never reach the depth counter.
 */
export function matchBrace(code: string, open: number): number {
  let depth = 0;
  let i = open;
  let operandEnd = false;
  while (i < code.length) {
    const c = code[i];
    if (isOpaqueStart(code, i)) {
      const opaque = scanOpaqueEnd(code, i);
      if (opaque.isString) operandEnd = true;
      i = opaque.end;
      continue;
    }
    if (c === "/" && !operandEnd) {
      i = scanRegex(code, i);
      operandEnd = true;
      continue;
    }
    if (isWsChar(c)) {
      i++;
      continue;
    }
    if (isIdentChar(c)) {
      const wend = skipIdent(code, i);
      operandEnd = operandAfterWord(code.slice(i, wend));
      i = wend;
      continue;
    }
    if (c === "{") {
      depth++;
      operandEnd = false;
    } else if (c === "}") {
      depth--;
      operandEnd = true;
      if (depth === 0) return i;
    } else {
      operandEnd = false;
    }
    i++;
  }
  return -1;
}

/** `word` starting at `at` with an identifier boundary on the right. */
export function keywordAt(code: string, at: number, word: string): boolean {
  return code.startsWith(word, at) && !isIdentChar(code[at + word.length]);
}

/** Skip whitespace and comments (including newlines). */
export function skipTrivia(code: string, at: number): number {
  let i = at;
  for (;;) {
    const c = code[i];
    if (isWsChar(c)) {
      i++;
      continue;
    }
    if (c === "/" && code[i + 1] === "/") {
      i = lineCommentEnd(code, i);
      continue;
    }
    if (c === "/" && code[i + 1] === "*") {
      i = blockCommentEnd(code, i);
      continue;
    }
    return i;
  }
}
