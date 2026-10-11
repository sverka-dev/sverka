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
    // whitespace
    if (ch === " " || ch === "\t" || ch === "\n" || ch === "\r") {
      i++;
      continue;
    }
    // string literal
    if (ch === "'") {
      let j = i + 1;
      while (j < expr.length && expr[j] !== "'") j++;
      if (j >= expr.length) fail(expr, "unterminated string literal");
      tokens.push({ type: "string", value: expr.slice(i + 1, j) });
      i = j + 1;
      continue;
    }
    // number literal
    if (ch >= "0" && ch <= "9") {
      let j = i;
      while (j < expr.length && expr[j]! >= "0" && expr[j]! <= "9") j++;
      if (expr[j] === ".") {
        j++;
        while (j < expr.length && expr[j]! >= "0" && expr[j]! <= "9") j++;
      }
      tokens.push({ type: "number", value: Number(expr.slice(i, j)) });
      i = j;
      continue;
    }
    // identifier / keyword
    if (isIdentStart(ch)) {
      let j = i;
      while (j < expr.length && isIdentPart(expr[j]!)) j++;
      const word = expr.slice(i, j);
      if (word === "true") tokens.push({ type: "true" });
      else if (word === "false") tokens.push({ type: "false" });
      else tokens.push({ type: "ident", value: word });
      i = j;
      continue;
    }
    // operators
    if (ch === "!") {
      if (expr[i + 1] === "=") {
        tokens.push({ type: "op", value: "!=" });
        i += 2;
      } else {
        tokens.push({ type: "op", value: "!" });
        i += 1;
      }
      continue;
    }
    if (ch === "=" && expr[i + 1] === "=") {
      tokens.push({ type: "op", value: "==" });
      i += 2;
      continue;
    }
    if (ch === "&" && expr[i + 1] === "&") {
      tokens.push({ type: "op", value: "&&" });
      i += 2;
      continue;
    }
    if (ch === "|" && expr[i + 1] === "|") {
      tokens.push({ type: "op", value: "||" });
      i += 2;
      continue;
    }
    if (ch === "(") {
      tokens.push({ type: "lparen" });
      i++;
      continue;
    }
    if (ch === ")") {
      tokens.push({ type: "rparen" });
      i++;
      continue;
    }
    fail(expr, `unexpected character '${ch}'`);
  }
  return tokens;
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
        // Use own-property lookup to avoid inherited prototype properties
        // (e.g. `toString`, `constructor`) leaking into condition results.
        return Object.prototype.hasOwnProperty.call(this.context, t.value)
          ? this.context[t.value]
          : undefined;
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
  // Loose string/number coercion: compare numerically when one side is a
  // number and the other is a string, consistent with the spec loose
  // equality (string/number coercion).
  if (typeof a === "string" && typeof b === "number") {
    const na = Number(a);
    return Number.isFinite(na) && na === b;
  }
  if (typeof a === "number" && typeof b === "string") {
    const nb = Number(b);
    return Number.isFinite(nb) && a === nb;
  }
  if (typeof a === "boolean" || typeof b === "boolean") return a === b;
  return a === b;
}
