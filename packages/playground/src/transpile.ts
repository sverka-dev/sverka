// @sverka/playground — toSverkaConfig (Spec 53): the "take it home" bridge.
// Converts playground source into a real sverka.config.ts: the authoring
// surface (Project/Pipeline/Entry/roots) transfers verbatim — only the step
// kind differs. FunctionStep bodies cannot run as shell commands, so each
// becomes a ShellStep carrying a TODO echo the user replaces.

import { PlaygroundError } from "./share.js";
import {
  isIdentChar,
  isOpaqueStart,
  isWsChar,
  keywordAt,
  matchBrace,
  operandAfterWord,
  scanOpaqueEnd,
  scanOperand,
  scanString,
  skipIdent,
} from "./scanner.js";

// --- local char helpers (only transpile needs these) ----------------------

function isOpenBracket(c: string | undefined): boolean {
  return c === "{" || c === "[" || c === "(";
}

function isCloseBracket(c: string | undefined): boolean {
  return c === "}" || c === "]" || c === ")";
}

function skipWs(code: string, i: number): number {
  while (i < code.length && isWsChar(code[i])) i++;
  return i;
}

// ---------------------------------------------------------------------------
// Every matcher below is string-, comment-, and regex-literal-aware via the
// shared scanner — braces inside `/[{]/` or quotes never count as syntax,
// and all scans are linear (no regexes over user source at all).
// ---------------------------------------------------------------------------

/**
 * Index of the `:` following a depth-0 `key` in a props object body, or -1.
 * A `dependencies` declared inside `fn` never counts — only top-level keys.
 */
function findPropKey(props: string, key: string): number {
  let depth = 0;
  let operandEnd = false;
  let i = 0;
  while (i < props.length) {
    const c = props[i];
    if (isIdentChar(c)) {
      const wend = skipIdent(props, i);
      const word = props.slice(i, wend);
      const hit = depth === 0 && word === key ? skipWs(props, wend) : -1;
      if (hit >= 0 && props[hit] === ":") return hit;
      operandEnd = operandAfterWord(word);
      i = wend;
      continue;
    }
    const op = scanOperand(props, i, operandEnd);
    if (op !== null) {
      operandEnd = op.operandEnd;
      i = op.end;
      continue;
    }
    if (isWsChar(c)) {
      i++;
      continue;
    }
    if (isOpenBracket(c)) {
      depth++;
      operandEnd = false;
    } else if (isCloseBracket(c)) {
      depth--;
      operandEnd = true;
    } else {
      operandEnd = false;
    }
    i++;
  }
  return -1;
}

/** True when the comment at `k` is a top-level tail comment — `deps: [] //
 *  note` — and therefore not part of the value. Emitting it would comment
 *  out the generated `}` after `dependsOn: <value>`. */
function isTailComment(props: string, k: number, after: number): boolean {
  const ahead = skipWs(props, after);
  return ahead >= props.length || props[ahead] === ",";
}

/** End index of a prop value starting at `j` — the next top-level comma
 *  or the end of the props body, with strings/comments/brackets balanced. */
function propValueEnd(props: string, j: number): number {
  let depth = 0;
  let operandEnd = false;
  let k = j;
  while (k < props.length) {
    const v = props[k];
    if (isOpaqueStart(props, k)) {
      const after = scanOpaqueEnd(props, k).end;
      if (depth === 0 && isTailComment(props, k, after)) return k;
      k = after;
      continue;
    }
    const op = scanOperand(props, k, operandEnd);
    if (op !== null) {
      operandEnd = op.operandEnd;
      k = op.end;
      continue;
    }
    if (isWsChar(v)) {
      k++;
      continue;
    }
    if (isOpenBracket(v)) {
      depth++;
      operandEnd = false;
    } else if (isCloseBracket(v)) {
      depth--;
      operandEnd = true;
    } else if (v === "," && depth === 0) {
      return k;
    } else {
      operandEnd = false;
    }
    k++;
  }
  return k;
}

/**
 * Extract a top-level `key: <value>` span from a props object body.
 * Only depth-0 keys match — a `dependencies` declared inside `fn` never
 * counts. The value runs to the next top-level `,`, with strings,
 * comments, and nested brackets all balanced.
 */
function extractProp(props: string, key: string): string | undefined {
  const colon = findPropKey(props, key);
  if (colon < 0) return undefined;
  const j = skipWs(props, colon + 1);
  return props.slice(j, propValueEnd(props, j)).trim();
}

/** Consume trailing spaces/tabs plus one optional `;` — never the newline.
 *  Eating it would fuse the emitted import with the next line
 *  (`from "@sverka/workflow"const x = …`). */
function stmtEndPos(source: string, i: number): number {
  let end = i;
  while (source[end] === " " || source[end] === "\t") end++;
  if (source[end] === ";") end++;
  return end;
}

/** Parse one import specifier: `Name` or `Name as alias`. */
function parseImportSpec(spec: string): { orig: string; local: string } {
  const a = skipWs(spec, 0);
  const wend = skipIdent(spec, a);
  const orig = spec.slice(a, wend);
  const asPos = skipWs(spec, wend);
  if (!spec.startsWith("as", asPos) || isIdentChar(spec[asPos + 2])) {
    return { orig, local: orig };
  }
  const b = skipWs(spec, asPos + 2);
  const local = spec.slice(b, skipIdent(spec, b));
  return local === "" ? { orig, local: orig } : { orig, local };
}

interface MappedImports {
  mapped: string;
  fnStepLocals: string[];
}

/** Map `{…}` import specifiers; FunctionStep becomes ShellStep (aliases
 *  survive: `FunctionStep as Fn` → `ShellStep as Fn`). */
function mapImportSpecifiers(inner: string): MappedImports {
  const mapped: string[] = [];
  const fnStepLocals: string[] = [];
  for (const spec of inner.split(",")) {
    const trimmed = spec.trim();
    if (trimmed === "") continue;
    const { orig, local } = parseImportSpec(trimmed);
    if (orig === "FunctionStep") {
      fnStepLocals.push(local);
      mapped.push(orig === local ? "ShellStep" : `ShellStep as ${local}`);
    } else {
      mapped.push(trimmed);
    }
  }
  return { mapped: mapped.join(", "), fnStepLocals };
}

interface PlaygroundImport {
  stmtEnd: number;
  mapped: string;
  fnStepLocals: string[];
}

/** Parse `import {…} from "@sverka/playground"` at `i`, or null when the
 *  statement has another shape/module. Caller guarantees "import" at `i`. */
function parsePlaygroundImport(
  source: string,
  i: number,
): PlaygroundImport | null {
  const j = skipWs(source, i + 6);
  if (source[j] !== "{") return null;
  const namesEnd = matchBrace(source, j);
  if (namesEnd < 0) return null;
  const fromKw = skipWs(source, namesEnd + 1);
  if (!keywordAt(source, fromKw, "from")) return null;
  const qPos = skipWs(source, fromKw + 4);
  const q = source[qPos];
  if (q !== '"' && q !== "'") return null;
  const specEnd = scanString(source, qPos);
  if (source.slice(qPos + 1, specEnd - 1) !== "@sverka/playground") return null;
  const { mapped, fnStepLocals } = mapImportSpecifiers(
    source.slice(j + 1, namesEnd),
  );
  return { stmtEnd: stmtEndPos(source, specEnd), mapped, fnStepLocals };
}

/**
 * Rewrite `import {…} from "@sverka/playground"` statements linearly.
 *
 * Returns the rewritten source plus every local name bound to
 * FunctionStep, so constructor calls under an alias are transpiled too.
 */
function rewritePlaygroundImports(source: string): {
  code: string;
  fnStepNames: string[];
} {
  const fnStepNames: string[] = [];
  let out = "";
  let cursor = 0;
  let i = 0;
  while (i < source.length) {
    const end = scanOpaqueEnd(source, i).end;
    if (end > i + 1) {
      i = end;
      continue;
    }
    if (source.startsWith("import", i) && !isIdentChar(source[i + 6])) {
      const stmt = parsePlaygroundImport(source, i);
      if (stmt !== null) {
        out += source.slice(cursor, i);
        out += `import { ${stmt.mapped} } from "@sverka/workflow"`;
        if (source[stmt.stmtEnd - 1] === ";") out += ";";
        fnStepNames.push(...stmt.fnStepLocals);
        cursor = stmt.stmtEnd;
        i = stmt.stmtEnd;
        continue;
      }
    }
    i++;
  }
  return { code: out + source.slice(cursor), fnStepNames };
}

/** Index of `(` after `new <name>` where <name> ∈ names, or null. */
function stepCallParen(
  code: string,
  afterNew: number,
  names: readonly string[],
): number | null {
  const j = skipWs(code, afterNew);
  for (const name of names) {
    const next = code[j + name.length];
    if (code.startsWith(name, j) && !isIdentChar(next)) {
      const paren = skipWs(code, j + name.length);
      if (code[paren] === "(") return paren;
    }
  }
  return null;
}

/** Operand context after punctuation — closers end a value, everything
 *  else (openers, operators, separators) expects one. */
function punctuationOperandEnd(c: string | undefined): boolean {
  return c === ")" || c === "]" || c === "}";
}

/**
 * Locate the next `new <name>(` call where <name> ∈ names. Whole-word
 * scanning makes boundary checks free — `myNew` or `newer` never match.
 * Opaque regions and regex literals are skipped inline, so a
 * `new FunctionStep(` inside a comment, string, or `/new Fn(/` pattern
 * is documentation, not a call.
 */
function findStepCall(
  code: string,
  names: readonly string[],
  from: number,
): { start: number; paren: number } | null {
  let operandEnd = false;
  let i = from;
  while (i < code.length) {
    if (isIdentChar(code[i])) {
      const wend = skipIdent(code, i);
      const word = code.slice(i, wend);
      if (word === "new") {
        const paren = stepCallParen(code, wend, names);
        if (paren !== null) return { start: i, paren };
      }
      operandEnd = operandAfterWord(word);
      i = wend;
      continue;
    }
    const op = scanOperand(code, i, operandEnd);
    if (op !== null) {
      operandEnd = op.operandEnd;
      i = op.end;
      continue;
    }
    if (!isWsChar(code[i])) operandEnd = punctuationOperandEnd(code[i]);
    i++;
  }
  return null;
}

/** End of the scope expression — the first top-level comma after `from`,
 *  or -1 when the argument list closes/ends first. */
function scanScopeEnd(code: string, from: number): number {
  let depth = 0;
  let operandEnd = false;
  let k = from;
  while (k < code.length) {
    const op = scanOperand(code, k, operandEnd);
    if (op !== null) {
      operandEnd = op.operandEnd;
      k = op.end;
      continue;
    }
    const c = code[k];
    if (isWsChar(c)) {
      k++;
      continue;
    }
    if (isOpenBracket(c)) {
      depth++;
      operandEnd = false;
    } else if (isCloseBracket(c)) {
      if (depth === 0) return -1;
      depth--;
      operandEnd = true;
    } else if (c === "," && depth === 0) {
      return k;
    } else {
      operandEnd = false;
    }
    k++;
  }
  return -1;
}

interface StepArgs {
  scope: string;
  id: string;
  propsOpen: number;
}

/** Parse `(scope, "id", {` after the `(` at `paren`; null when the call
 *  shape differs. A template id throws immediately — never half-converts. */
function parseStepArgs(code: string, paren: number): StepArgs | null {
  const scopeStart = skipWs(code, paren + 1);
  const comma = scanScopeEnd(code, scopeStart);
  if (comma < 0) return null;
  const qPos = skipWs(code, comma + 1);
  const q = code[qPos];
  if (q === "`")
    throw new PlaygroundError(
      "TRANSPILE_FAILED",
      "cannot parse FunctionStep — template-literal step id",
    );
  if (q !== '"' && q !== "'") return null;
  const idEnd = scanString(code, qPos);
  const afterId = skipWs(code, idEnd);
  if (code[afterId] !== ",") return null;
  const propsOpen = skipWs(code, afterId + 1);
  if (code[propsOpen] !== "{") return null;
  return {
    scope: code.slice(scopeStart, comma).trim(),
    id: code.slice(qPos + 1, idEnd - 1),
    propsOpen,
  };
}

/** Emit the ShellStep placeholder replacing one FunctionStep call. */
function shellStepCall(args: StepArgs, dependencies: string | undefined) {
  // The id lands inside shell single quotes — $()/backticks can never
  // expand. `'` is already impossible (the id is a plain string literal).
  return (
    `new ShellStep(${args.scope}, "${args.id}", ` +
    `{ command: "echo 'TODO: port '${args.id}' — replace with the real shell command'"` +
    `${dependencies !== undefined ? `, dependsOn: ${dependencies}` : ""} }`
  );
}

/** Rewrite every `new Fn(scope, "id", {…})` call under the given local
 *  names into ShellStep placeholders; `dependencies` → `dependsOn`. */
function rewriteStepCalls(code: string, names: readonly string[]): string {
  let result = "";
  let cursor = 0;
  for (;;) {
    const call = findStepCall(code, names, cursor);
    if (call === null) break;
    const args = parseStepArgs(code, call.paren);
    if (args === null) {
      // A `new Fn(` whose shape we don't own — skip `new` and let the
      // leftover check name it, rather than silently dropping it.
      result += code.slice(cursor, call.start + 3);
      cursor = call.start + 3;
      continue;
    }
    const propsClose = matchBrace(code, args.propsOpen);
    if (propsClose < 0)
      throw new PlaygroundError(
        "TRANSPILE_FAILED",
        `cannot parse FunctionStep "${args.id}" — unbalanced props object`,
      );
    const dependencies = extractProp(
      code.slice(args.propsOpen + 1, propsClose),
      "dependencies",
    );
    result +=
      code.slice(cursor, call.start) + shellStepCall(args, dependencies);
    cursor = propsClose + 1;
  }
  return result + code.slice(cursor);
}

/** A surviving step call means a shape we could not convert — computed
 *  scope/id or a malformed alias call. Fail loud rather than emit a
 *  half-converted file. */
function assertNoLeftoverSteps(code: string, names: readonly string[]): void {
  let i = 0;
  for (;;) {
    const call = findStepCall(code, names, i);
    if (call === null) return;
    const scopeStart = skipWs(code, call.paren + 1);
    const scopeEnd = scanScopeEnd(code, scopeStart);
    const scope =
      scopeEnd < 0 ? "?" : code.slice(scopeStart, scopeEnd).trim() || "?";
    throw new PlaygroundError(
      "TRANSPILE_FAILED",
      `cannot parse FunctionStep with scope '${scope}' — unsupported expression`,
    );
  }
}

/**
 * Transpile playground source into `sverka.config.ts`.
 *
 * Rewrites the `@sverka/playground` import to `@sverka/workflow` and each
 * `new FunctionStep(scope, "id", { fn, dependencies })` into a ShellStep
 * whose command echoes a TODO — the function body has no shell equivalent.
 * `dependencies` maps onto `dependsOn`. Aliased FunctionStep imports
 * (`FunctionStep as Fn`) are followed too.
 *
 * Throws `PlaygroundError(TRANSPILE_FAILED)` naming the offending step when
 * a FunctionStep cannot be parsed — a half-converted file is never emitted.
 */
export function toSverkaConfig(source: string): string {
  const { code, fnStepNames } = rewritePlaygroundImports(source);
  if (fnStepNames.length === 0) fnStepNames.push("FunctionStep");
  const out = rewriteStepCalls(code, fnStepNames);
  assertNoLeftoverSteps(out, fnStepNames);
  return out;
}
