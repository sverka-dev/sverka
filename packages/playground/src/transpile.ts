// @sverka/playground — toSverkaConfig (Spec 53): the "take it home" bridge.
// Converts playground source into a real sverka.config.ts: the authoring
// surface (Project/Pipeline/Entry/roots) transfers verbatim — only the step
// kind differs. FunctionStep bodies cannot run as shell commands, so each
// becomes a ShellStep carrying a placeholder echo the user replaces.

import { PlaygroundError } from "./share.js";
import {
  isIdentChar,
  isOpaqueStart,
  isQuote,
  isWsChar,
  keywordAt,
  matchBrace,
  newOperandScan,
  scanOpaqueEnd,
  scanOperand,
  scanString,
  skipIdent,
  type OperandScan,
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

/** Scan state for the prop scans: the shared operand context plus the
 *  bracket depth that scopes keys, commas, and prop values. */
type PropScan = OperandScan & { depth: number };

/** One token of an operand-tracking scan — identifiers (with `word`),
 *  opaque spans, `++`/`--`, numbers, and regex-vs-division resolve
 *  through the shared scanner; whitespace passes through. Null when `i`
 *  sits on punctuation the caller's own depth/branch logic owns. */
function propToken(
  s: string,
  i: number,
  st: PropScan,
): { end: number; word?: string } | null {
  const end = scanOperand(s, i, st);
  if (end === null) return null;
  if (isIdentChar(s[i])) return { end, word: s.slice(i, end) };
  return { end };
}

/** Apply a bracket/other punctuation char to depth + operand state.
 *  `(` records whether a control word opened it — `if (x) /re/` may
 *  open a regex after `)` while `(x) / 2` divides. */
function applyPunctuation(c: string | undefined, st: PropScan): void {
  if (isOpenBracket(c)) {
    st.depth++;
    if (c === "(") st.parens.push(st.pendingCtl);
    st.pendingCtl = null;
    st.operandEnd = false;
  } else if (isCloseBracket(c)) {
    st.depth--;
    st.pendingCtl = null;
    if (c === ")") {
      const kind = st.parens.pop();
      st.operandEnd = kind === undefined || kind === null;
    } else {
      st.operandEnd = true;
    }
  } else {
    st.pendingCtl = null;
    st.operandEnd = false;
  }
}

/**
 * Index of the `:` following a depth-0 `key` in a props object body, or -1.
 * A `dependencies` declared inside `fn` never counts — only top-level keys.
 */
function findPropKey(props: string, key: string): number {
  const st: PropScan = { ...newOperandScan(), depth: 0 };
  let i = 0;
  while (i < props.length) {
    const tok = propToken(props, i, st);
    if (tok === null) {
      applyPunctuation(props[i], st);
      i++;
      continue;
    }
    if (st.depth === 0 && tok.word === key) {
      const hit = skipWs(props, tok.end);
      if (props[hit] === ":") return hit;
    }
    i = tok.end;
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
  const st: PropScan = { ...newOperandScan(), depth: 0 };
  let k = j;
  while (k < props.length) {
    if (isOpaqueStart(props, k)) {
      const after = scanOpaqueEnd(props, k).end;
      if (st.depth === 0 && isTailComment(props, k, after)) return k;
      // A string ends the operand — `"a" / 2` divides; comments pass
      // the operand context through untouched.
      if (isQuote(props[k])) {
        st.operandEnd = true;
        st.pendingCtl = null;
      }
      k = after;
      continue;
    }
    const tok = propToken(props, k, st);
    if (tok !== null) {
      k = tok.end;
      continue;
    }
    if (props[k] === "," && st.depth === 0) return k;
    applyPunctuation(props[k], st);
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

/** JS line terminators — whitespace a statement tail must not consume. */
function isLineBreak(c: string | undefined): boolean {
  return c === "\n" || c === "\r" || c === "\u2028" || c === "\u2029";
}

/** Consume trailing non-line whitespace plus one optional `;` — never a
 *  line break. Eating it would fuse the emitted import with the next
 *  line (`from "@sverka/workflow"const x = …`). */
function stmtEndPos(source: string, i: number): number {
  let end = i;
  while (isWsChar(source[end]) && !isLineBreak(source[end])) end++;
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
  const st: PropScan = { ...newOperandScan(), depth: 0 };
  let i = from;
  while (i < code.length) {
    const tok = propToken(code, i, st);
    if (tok !== null) {
      if (tok.word === "new") {
        const paren = stepCallParen(code, tok.end, names);
        if (paren !== null) return { start: i, paren };
      }
      i = tok.end;
      continue;
    }
    applyPunctuation(code[i], st);
    i++;
  }
  return null;
}

/** End of the scope expression — the first top-level comma after `from`,
 *  or -1 when the argument list closes/ends first. */
function scanScopeEnd(code: string, from: number): number {
  const st: PropScan = { ...newOperandScan(), depth: 0 };
  let k = from;
  while (k < code.length) {
    const tok = propToken(code, k, st);
    if (tok !== null) {
      k = tok.end;
      continue;
    }
    const c = code[k];
    if (c === "," && st.depth === 0) return k;
    if (isCloseBracket(c) && st.depth === 0) return -1;
    applyPunctuation(c, st);
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
    (dependencies !== undefined ? ", dependsOn: " + dependencies : "") +
    " }"
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
    // Fail fast on a shape we don't own: the leftover check throws on it
    // anyway, and continuing past `new` re-scans the nested suffix once
    // per nested `new Fn(` — quadratic on malformed input.
    if (args === null) throw unsupportedStepError(code, call.paren);
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

/** TRANSPILE_FAILED naming the scope of the step call whose `(` is at
 *  `paren` — `?` when even the scope won't scan. */
function unsupportedStepError(code: string, paren: number): PlaygroundError {
  const scopeStart = skipWs(code, paren + 1);
  const scopeEnd = scanScopeEnd(code, scopeStart);
  const scope =
    scopeEnd < 0 ? "?" : code.slice(scopeStart, scopeEnd).trim() || "?";
  return new PlaygroundError(
    "TRANSPILE_FAILED",
    `cannot parse FunctionStep with scope '${scope}' — unsupported expression`,
  );
}

/** A surviving step call means a shape we could not convert — computed
 *  scope/id or a malformed alias call. Fail loud rather than emit a
 *  half-converted file. */
function assertNoLeftoverSteps(code: string, names: readonly string[]): void {
  const call = findStepCall(code, names, 0);
  if (call !== null) throw unsupportedStepError(code, call.paren);
}

/**
 * Transpile playground source into `sverka.config.ts`.
 *
 * Rewrites the `@sverka/playground` import to `@sverka/workflow` and each
 * `new FunctionStep(scope, "id", { fn, dependencies })` into a ShellStep
 * whose command echoes a placeholder — the function body has no shell
 * equivalent.
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
