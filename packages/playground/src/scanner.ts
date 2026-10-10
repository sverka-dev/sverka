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

/** ECMAScript LineTerminators: LF, CR, U+2028, U+2029. Line comments and
 *  unterminated regex literals end at any of them — not only at LF. */
export function isLineTerminator(c: string | undefined): boolean {
  return c === "\n" || c === "\r" || c === "\u2028" || c === "\u2029";
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

/** ASCII digit. */
export function isDigit(c: string | undefined): boolean {
  return c !== undefined && c >= "0" && c <= "9";
}

// --- skips ---------------------------------------------------------------

export function skipIdent(code: string, i: number): number {
  while (i < code.length && isIdentChar(code[i])) i++;
  return i;
}

/** Index of the first LineTerminator ending the `//` comment at `at`
 *  (code.length if none). CR, U+2028 and U+2029 terminate a line comment
 *  just like LF — a `//` note ending at `\r` must release the code that
 *  follows it. */
export function lineCommentEnd(code: string, at: number): number {
  let i = at + 2;
  while (i < code.length && !isLineTerminator(code[i])) i++;
  return i;
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

/** True when `at` begins a numeric literal — a digit, or `.` followed by
 *  a digit (`.5`). Member access never puts a digit right after the dot,
 *  so this is unambiguous at operand-scan positions. */
export function numberAt(code: string, at: number): boolean {
  return isDigit(code[at]) || (code[at] === "." && isDigit(code[at + 1]));
}

/** End of the digit run at `i` — digits and `_` separators. */
function skipDigits(code: string, i: number): number {
  while (isDigit(code[i]) || code[i] === "_") i++;
  return i;
}

/** End of a `e[+-]?digits` exponent at `i`, or `i` when absent. */
function scanExponent(code: string, i: number): number {
  if (code[i] !== "e" && code[i] !== "E") return i;
  let j = i + 1;
  if (code[j] === "+" || code[j] === "-") j++;
  return isDigit(code[j]) ? skipDigits(code, j) : i;
}

/** End index of the numeric literal at `at` — fraction, exponent, `_`
 *  separators, the bigint `n`, and radix digits (`0x`/`0o`/`0b`, which
 *  live in ident space) are all consumed, so `5. / 2` still ends the
 *  operand rather than leaving `/` to scan as a regex opener. */
export function scanNumber(code: string, at: number): number {
  let i = at;
  if (code[i] === "0" && "xXoObB".includes(code[i + 1] ?? "")) {
    return skipIdent(code, i + 2);
  }
  i = skipDigits(code, i);
  if (code[i] === ".") i = skipDigits(code, i + 1);
  i = scanExponent(code, i);
  if (code[i] === "n") i++;
  return i;
}

/** End index of a regex literal starting at `at` (`/`): closes at the
 *  first unescaped `/` outside a `[]` class, then consumes flags. Stops
 *  at any LineTerminator or EOF when unterminated — the evaluator
 *  reports the syntax. */
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
    else if (isLineTerminator(c)) return i;
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

/** Reserved words and true operators after which `/` opens a regex
 *  rather than divides. Everything else — plain identifiers, literals
 *  such as `this`/`true`, and the contextual keywords `async`/`get`/`set`/
 *  `of`/`from`/`as`/`type`/`declare`/`static` — ends an operand, making
 *  `/` a division: `async / 2` divides because `async` is a valid
 *  identifier. The only contextual exception lives one level up: `of`
 *  inside a `for (` header is the for-of keyword, handled by
 *  wordOperandEnd via the paren stack. */
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

/** Words whose `(` opens a control-flow header, not a grouping or call:
 *  after the matching `)` a statement follows, so a `/` may open a regex
 *  — `if (x) /re/`. `function` is deliberately absent: its `)` precedes
 *  the body `{`, and `function() {} / 2` divides. */
export const CONTROL_WORDS: ReadonlySet<string> = new Set([
  "catch",
  "for",
  "if",
  "switch",
  "while",
  "with",
]);

/** Operand-scan state for the regex-vs-division heuristic:
 *
 * - `operandEnd` — the previous token ended an operand, so `/` divides.
 * - `parens` — open `(` frames, innermost last: the control word that
 *   opened each, or null for grouping/call parens. `[`/`{` never enter
 *   here — `]` always ends an operand and `}` is caller-owned.
 * - `pendingCtl` — a control word awaiting its `(`; survives whitespace
 *   and comments between word and paren, cleared by any real token.
 *
 * This is a bounded heuristic, not a tokenizer. Known limits: `of` is
 * the for-of keyword only inside a `for (` header (elsewhere an
 * identifier — `of / 2` divides); `await`/`yield`/`let` stay keyword-
 * guessed; a `}` closing a statement block counts as an operand end, so
 * `while (c) {} /re/` divides inside the brace-matching scans. */
export interface OperandScan {
  operandEnd: boolean;
  parens: (string | null)[];
  pendingCtl: string | null;
}

/** Fresh operand-scan state starting in operand-expected position. */
export function newOperandScan(): OperandScan {
  return { operandEnd: false, parens: [], pendingCtl: null };
}

/** Operand context after `word`: `of` inside a `for (` header introduces
 *  the iterated expression (`for (x of /re/)`), everywhere else it's an
 *  identifier; all other words resolve through the keyword table. */
function wordOperandEnd(
  word: string,
  parens: readonly (string | null)[],
): boolean {
  if (word === "of" && parens.at(-1) === "for") return false;
  return operandAfterWord(word);
}

/** True when `i` starts a `++` or `--` pair — postfix ends the operand,
 *  prefix still expects one; either way the state survives. */
function doubleSignAt(code: string, i: number): boolean {
  const c = code[i];
  return (c === "+" || c === "-") && code[i + 1] === c;
}

/** `/` after an operand divides (one char); at operand-expected
 *  position it opens a regex literal, consumed whole. */
function slashTokenEnd(code: string, i: number, st: OperandScan): number {
  st.pendingCtl = null;
  if (st.operandEnd) {
    st.operandEnd = false;
    return i + 1;
  }
  st.operandEnd = true;
  return scanRegex(code, i);
}

/** End of a `.prop` member access at the `.` — skips trivia, then the
 *  property ident when one follows. `?.` chains and each `.` of `...`
 *  land here too, where the leading pair simply finds no ident. */
function memberPropEnd(code: string, i: number): number {
  const prop = skipTrivia(code, i + 1);
  return isIdentChar(code[prop]) && !isDigit(code[prop])
    ? skipIdent(code, prop)
    : i + 1;
}

/** End of the identifier/keyword run at `i`, updating operand state:
 *  keyword-ness decides whether a following `/` divides, and control
 *  words arm `pendingCtl` for their header `(`. `await` is the one word
 *  allowed between `for` and its `(` — `for await (x of y)` keeps the
 *  control context. */
function wordTokenEnd(code: string, i: number, st: OperandScan): number {
  const wend = skipIdent(code, i);
  const word = code.slice(i, wend);
  st.operandEnd = wordOperandEnd(word, st.parens);
  st.pendingCtl =
    word === "await" && st.pendingCtl === "for"
      ? "for"
      : CONTROL_WORDS.has(word)
        ? word
        : null;
  return wend;
}

/** Shared operand-token scan: opaque spans (strings end operands,
 *  comments pass context through), `++`/`--` pairs, `/` (regex unless an
 *  operand just ended), numbers, identifier runs, and whitespace
 *  (consume-and-preserve). Returns the token end, or null for
 *  bracket/separator punctuation the caller's own loop owns. */
function operandToken(
  code: string,
  i: number,
  st: OperandScan,
  depth: number,
): number | null {
  const opaque = scanOpaqueEnd(code, i, depth);
  if (opaque.end > i + 1) {
    if (opaque.isString) {
      st.operandEnd = true;
      st.pendingCtl = null;
    }
    return opaque.end;
  }
  const c = code[i];
  if (doubleSignAt(code, i)) {
    st.pendingCtl = null;
    return i + 2;
  }
  if (c === "/") return slashTokenEnd(code, i, st);
  if (isWsChar(c)) return i + 1;
  if (numberAt(code, i)) {
    st.operandEnd = true;
    st.pendingCtl = null;
    return scanNumber(code, i);
  }
  if (c === ".") {
    // Member access: a word after `.` is a property name, never a
    // keyword — `obj.return / 2` divides. `.5` was taken by numberAt.
    st.pendingCtl = null;
    st.operandEnd = true;
    return memberPropEnd(code, i);
  }
  if (isIdentChar(c)) return wordTokenEnd(code, i, st);
  return null;
}

interface TokenStep {
  /** Index just past the consumed token. */
  end: number;
  /** +1 for `{`, −1 for `}`, 0 otherwise. */
  brace: -1 | 0 | 1;
}

/** Consume one token at `i` for the brace-matching scans, mutating `st`:
 *  operand tokens defer to operandToken, `(` pushes its control context,
 *  `)` reports operand-expected when it closed a control header, and
 *  braces report a depth delta. */
function scanToken(
  code: string,
  i: number,
  st: OperandScan,
  depth = 0,
): TokenStep {
  const end = operandToken(code, i, st, depth);
  if (end !== null) return { end, brace: 0 };
  const ch = code[i];
  const ctl = st.pendingCtl;
  st.pendingCtl = null;
  if (ch === "(") {
    st.parens.push(ctl);
    st.operandEnd = false;
    return { end: i + 1, brace: 0 };
  }
  if (ch === ")") {
    // A control-header `)` precedes a statement — `/` may open a regex;
    // a grouping or call `)` ends the operand, so `/` divides.
    const kind = st.parens.pop();
    st.operandEnd = kind === undefined || kind === null;
    return { end: i + 1, brace: 0 };
  }
  if (ch === "{") {
    st.operandEnd = false;
    return { end: i + 1, brace: 1 };
  }
  if (ch === "}") {
    st.operandEnd = true;
    return { end: i + 1, brace: -1 };
  }
  st.operandEnd = ch === "]";
  return { end: i + 1, brace: 0 };
}

/**
 * Scan one operand-context token — an opaque span, a `++`/`--` pair, a
 *  regex-or-division, a number, or an identifier run — mutating `st` and
 *  returning where the token ends. Comments are transparent (operand
 *  context and a pending control word pass through unchanged). Returns
 *  null for punctuation the caller's own loop owns.
 */
export function scanOperand(
  code: string,
  i: number,
  st: OperandScan,
): number | null {
  return operandToken(code, i, st, 0);
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
  const st = newOperandScan();
  while (i < code.length && braces > 0) {
    const step = scanToken(code, i, st, depth);
    braces += step.brace;
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
  const st = newOperandScan();
  while (i < code.length) {
    const step = scanToken(code, i, st);
    depth += step.brace;
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
