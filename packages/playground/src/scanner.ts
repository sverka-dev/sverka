// @sverka/playground — shared mini-scanner primitives.
// Char-class checks instead of regexes (a pattern evaluated against user
// source is ReDoS surface); every helper is string/comment/regex aware so
// quoted or literal braces never count as syntax. All scans are linear.

// --- char classes --------------------------------------------------------

/** Non-ASCII whitespace code points beyond the Latin-1 range. */
const WS_POINTS = new Set([
  0xa0, 0x1680, 0x2028, 0x2029, 0x202f, 0x205f, 0x3000, 0xfeff,
]);

/** Whitespace per the JS grammar: \t \n \v \f \r space, NBSP, the unicode
 *  space separators (0x2000–0x200a), and ZWNBSP. */
export function isWsChar(c: string | undefined): boolean {
  if (c === undefined) return false;
  const n = c.codePointAt(0) ?? 0;
  if ((n >= 9 && n <= 13) || n === 32) return true;
  return (n >= 0x2000 && n <= 0x200a) || WS_POINTS.has(n);
}

/** ASCII letter-or-digit — digits and both letter cases. */
function isAsciiLetterOrDigit(n: number): boolean {
  return (n >= 48 && n <= 57) || (n >= 65 && n <= 90) || (n >= 97 && n <= 122);
}

/** Identifier-part chars, approximated: ASCII ident chars plus any
 *  non-ASCII char that isn't JS whitespace — `export` + a non-ASCII
 *  letter keeps its boundary. Over-approximation only ever suppresses
 *  a false keyword match — it never corrupts code. */
export function isIdentChar(c: string | undefined): boolean {
  if (c === undefined) return false;
  const n = c.codePointAt(0) ?? 0;
  if (n >= 0x80) return !isWsChar(c);
  return isAsciiLetterOrDigit(n) || c === "_" || c === "$";
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

/** Index just past the closing star-slash ending the block comment at
 *  `at` — the literal marker is never written inside this doc comment
 *  or it would terminate the comment itself. */
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

/** Bound on `${}`-in-template nesting. Each level costs a scanString ↔
 *  scanTemplateExpr recursion hop, so a crafted source (e.g. a share-link
 *  payload) with pathological nesting could exhaust the call stack. Past
 *  the cap the template is treated as unterminated — the tail is opaque
 *  and the scan degrades gracefully instead of crashing. */
const MAX_TEMPLATE_DEPTH = 200;

/** End index of the string literal starting at `at` (quote char).
 *  Template literals may nest `${}` expressions — tracked by brace depth
 *  up to MAX_TEMPLATE_DEPTH, where the scan bails to code.length. */
export function scanString(code: string, at: number, depth = 0): number {
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
      if (depth >= MAX_TEMPLATE_DEPTH) return code.length;
      i = scanTemplateExpr(code, i + 1, depth + 1);
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
  depth = 0,
): { end: number; isString: boolean } {
  const c = code[i];
  if (isQuote(c)) return { end: scanString(code, i, depth), isString: true };
  if (c === "/" && code[i + 1] === "/")
    return { end: lineCommentEnd(code, i), isString: false };
  if (c === "/" && code[i + 1] === "*")
    return { end: blockCommentEnd(code, i), isString: false };
  return { end: i + 1, isString: false };
}

/** Reserved words after which `/` opens a regex rather than divides —
 *  they can never end an operand. Contextual keywords (`of`, `as`,
 *  `from`, `get`, `set`, `type`, `async`, `declare`) are NOT listed:
 *  they act as ordinary identifiers in most positions, so a `/` after
 *  them divides. Everything else — plain identifiers plus literals such
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
]);

/** True when `word` ends an operand — a following `/` is division. */
export function operandAfterWord(word: string): boolean {
  return !NON_OPERAND_WORDS.has(word);
}

interface TokenStep {
  /** Index just past the consumed token. */
  end: number;
  /** Whether the token ends an operand — a following `/` divides. */
  operandEnd: boolean;
  /** +1 for `{`, −1 for `}`, 0 otherwise. */
  brace: -1 | 0 | 1;
}

/** Consume one token at `i` for the brace-matching scans: opaque regions
 *  and regex literals advance wholesale, identifiers update operand
 *  state from the keyword table, braces report a depth delta. */
function scanToken(
  code: string,
  i: number,
  operandEnd: boolean,
  depth = 0,
): TokenStep {
  const opaque = scanOpaqueEnd(code, i, depth);
  if (opaque.end > i + 1) {
    return {
      end: opaque.end,
      operandEnd: opaque.isString || operandEnd,
      brace: 0,
    };
  }
  const ch = code[i];
  if (ch === "/" && !operandEnd) {
    return { end: scanRegex(code, i), operandEnd: true, brace: 0 };
  }
  if (isWsChar(ch)) return { end: i + 1, operandEnd, brace: 0 };
  if (isIdentChar(ch)) {
    const wend = skipIdent(code, i);
    return {
      end: wend,
      operandEnd: operandAfterWord(code.slice(i, wend)),
      brace: 0,
    };
  }
  if (ch === "{") return { end: i + 1, operandEnd: false, brace: 1 };
  if (ch === "}") return { end: i + 1, operandEnd: true, brace: -1 };
  return { end: i + 1, operandEnd: false, brace: 0 };
}

/**
 * Scan one operand-context token — an opaque span, a regex-or-division,
 * or an identifier run — returning where it ends and whether it leaves
 * an operand behind. Comments are transparent (operand context passes
 * through unchanged). Returns null for punctuation/whitespace the
 * caller's own loop owns.
 */
export function scanOperand(
  code: string,
  i: number,
  operandEnd: boolean,
): { end: number; operandEnd: boolean } | null {
  const opaque = scanOpaqueEnd(code, i);
  if (opaque.end > i + 1)
    return { end: opaque.end, operandEnd: operandEnd || opaque.isString };
  const c = code[i];
  if (c === "/")
    return operandEnd
      ? { end: i + 1, operandEnd: false }
      : { end: scanRegex(code, i), operandEnd: true };
  if (isIdentChar(c)) {
    const wend = skipIdent(code, i);
    return {
      end: wend,
      operandEnd: operandAfterWord(code.slice(i, wend)),
    };
  }
  return null;
}

/**
 * End index of the `${` expression whose `{` is at `at`. Strings,
 *  comments, nested templates, and regex literals inside the expression
 *  are all skipped correctly: `` `${ x["`"] }` `` and `` `${ /"/ }` ``
 *  must not treat literal text as syntax.
 */
export function scanTemplateExpr(code: string, at: number, depth = 0): number {
  let braces = 1;
  let i = at + 1;
  let operandEnd = false;
  while (i < code.length && braces > 0) {
    const step = scanToken(code, i, operandEnd, depth);
    braces += step.brace;
    operandEnd = step.operandEnd;
    i = step.end;
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
    const step = scanToken(code, i, operandEnd);
    depth += step.brace;
    operandEnd = step.operandEnd;
    i = step.end;
    if (step.brace === -1 && depth === 0) return i - 1;
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
