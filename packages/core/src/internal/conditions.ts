import { CompositionError } from "../errors.js";
import type { PlanContext } from "../runtime.js";

/**
 * Evaluate a plan-time condition expression against a context. Safe subset:
 * no `eval`, no `Function` constructor. Hand-rolled tokenizer + recursive
 * descent parser.
 *
 * If `context` is `undefined`, returns `true` (operations included by default).
 */
export function evaluateCondition(
  expr: string,
  context: PlanContext | undefined,
): boolean {
  if (context === undefined) return true;
  const tokens = tokenize(expr);
  const parser = new Parser(tokens, expr, context);
  const result = parser.parseExpression();
  parser.expectEnd();
  return result;
}

type Token =
  | { type: "ident"; value: string }
  | { type: "string"; value: string }
  | { type: "number"; value: number }
  | { type: "true" }
  | { type: "false" }
  | { type: "op"; value: "!" | "&&" | "||" | "==" | "!=" }
  | { type: "lparen" }
  | { type: "rparen" };

function fail(expr: string, reason: string): never {
  throw new CompositionError(`Invalid condition expression: ${reason}`, {
    reason,
    expr,
  });
}

function tokenize(expr: string): Token[] {
  const tokens: Token[] = [];
  let i = 0;
  while (i < expr.length) {
    const ch = expr[i]!;
    if (isWhitespace(ch)) {
      i++;
      continue;
    }
    if (ch === "'") {
      i = tokenizeString(expr, i, tokens);
      continue;
    }
    if (ch >= "0" && ch <= "9") {
      i = tokenizeNumber(expr, i, tokens);
      continue;
    }
    if (isIdentStart(ch)) {
      i = tokenizeIdent(expr, i, tokens);
      continue;
    }
    const opLen = tokenizeOperator(expr, i, tokens);
    if (opLen > 0) {
      i += opLen;
      continue;
    }
    fail(expr, `unexpected character '${ch}'`);
  }
  return tokens;
}

function isWhitespace(ch: string): boolean {
  return ch === " " || ch === "\t" || ch === "\n" || ch === "\r";
}

function tokenizeString(expr: string, start: number, out: Token[]): number {
  let j = start + 1;
  while (j < expr.length && expr[j] !== "'") j++;
  if (j >= expr.length) fail(expr, "unterminated string literal");
  out.push({ type: "string", value: expr.slice(start + 1, j) });
  return j + 1;
}

function tokenizeNumber(expr: string, start: number, out: Token[]): number {
  let j = start;
  while (j < expr.length && expr[j]! >= "0" && expr[j]! <= "9") j++;
  if (expr[j] === ".") {
    j++;
    while (j < expr.length && expr[j]! >= "0" && expr[j]! <= "9") j++;
  }
  out.push({ type: "number", value: Number(expr.slice(start, j)) });
  return j;
}

function tokenizeIdent(expr: string, start: number, out: Token[]): number {
  let j = start;
  while (j < expr.length && isIdentPart(expr[j]!)) j++;
  const word = expr.slice(start, j);
  if (word === "true") out.push({ type: "true" });
  else if (word === "false") out.push({ type: "false" });
  else out.push({ type: "ident", value: word });
  return j;
}

const TWO_CHAR_OPS: Record<string, Token> = {
  "!=": { type: "op", value: "!=" },
  "==": { type: "op", value: "==" },
  "&&": { type: "op", value: "&&" },
  "||": { type: "op", value: "||" },
};

const SINGLE_CHAR_OPS: Record<string, Token> = {
  "!": { type: "op", value: "!" },
  "(": { type: "lparen" },
  ")": { type: "rparen" },
};

function tokenizeOperator(expr: string, i: number, out: Token[]): number {
  const two = expr.slice(i, i + 2);
  const twoChar = TWO_CHAR_OPS[two];
  if (twoChar !== undefined) {
    out.push(twoChar);
    return 2;
  }
  const single = SINGLE_CHAR_OPS[expr[i]!];
  if (single !== undefined) {
    out.push(single);
    return 1;
  }
  return 0;
}

function isIdentStart(ch: string): boolean {
  return (ch >= "a" && ch <= "z") || (ch >= "A" && ch <= "Z") || ch === "_";
}
function isIdentPart(ch: string): boolean {
  return isIdentStart(ch) || (ch >= "0" && ch <= "9") || ch === ".";
}

type OperandValue = string | number | boolean | readonly string[] | undefined;

class Parser {
  private pos = 0;
  constructor(
    private readonly tokens: Token[],
    private readonly expr: string,
    private readonly context: PlanContext,
  ) {}

  parseExpression(): boolean {
    return this.parseOr();
  }

  expectEnd(): void {
    if (this.pos < this.tokens.length) {
      const t = this.tokens[this.pos]!;
      fail(this.expr, `unexpected trailing token ${describe(t)}`);
    }
  }

  private peek(): Token | undefined {
    return this.tokens[this.pos];
  }
  private next(): Token {
    const t = this.tokens[this.pos];
    if (!t) fail(this.expr, "unexpected end of expression");
    this.pos++;
    return t;
  }

  private parseOr(): boolean {
    let left = this.parseAnd();
    while (this.peek()?.type === "op" && (this.peek() as { value: string }).value === "||") {
      this.next();
      const right = this.parseAnd();
      left = left || right;
    }
    return left;
  }

  private parseAnd(): boolean {
    let left = this.parseNot();
    while (this.peek()?.type === "op" && (this.peek() as { value: string }).value === "&&") {
      this.next();
      const right = this.parseNot();
      left = left && right;
    }
    return left;
  }

  private parseNot(): boolean {
    const t = this.peek();
    if (t?.type === "op" && t.value === "!") {
      this.next();
      return !this.parseNot();
    }
    return this.parseComparison();
  }

  private parseComparison(): boolean {
    const t = this.peek();
    if (t?.type === "lparen") {
      this.next();
      const inner = this.parseOr();
      const close = this.next();
      if (close.type !== "rparen") fail(this.expr, "expected ')'");
      return inner;
    }
    const left = this.parseOperand();
    const op = this.peek();
    if (op?.type === "op" && (op.value === "==" || op.value === "!=")) {
      this.next();
      const right = this.parseOperand();
      const eq = looseEqual(left, right);
      return op.value === "==" ? eq : !eq;
    }
    // bare operand: truthy check
    return isTruthy(left);
  }

  private parseOperand(): OperandValue {
    const t = this.next();
    switch (t.type) {
      case "ident":
        return this.context[t.value];
      case "string":
        return t.value;
      case "number":
        return t.value;
      case "true":
        return true;
      case "false":
        return false;
      default:
        fail(this.expr, `expected operand, got ${describe(t)}`);
    }
  }
}

function describe(t: Token): string {
  return t.type === "op" ? `'${t.value}'` : t.type;
}

function isTruthy(v: OperandValue): boolean {
  if (v === undefined || v === null) return false;
  if (typeof v === "boolean") return v;
  if (typeof v === "string") return v.length > 0;
  if (typeof v === "number") return v !== 0;
  if (Array.isArray(v)) return v.length > 0;
  return Boolean(v);
}

function looseEqual(a: OperandValue, b: OperandValue): boolean {
  if (a === b) return true;
  if (a == null || b == null) return a == b;
  if (typeof a === "string" && typeof b === "number") return a === String(b);
  if (typeof a === "number" && typeof b === "string") return String(a) === b;
  if (typeof a === "boolean" || typeof b === "boolean") return a === b;
  return a === b;
}
