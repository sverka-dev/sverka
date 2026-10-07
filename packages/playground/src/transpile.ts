// @sverka/playground — toSverkaConfig (Spec 53): the "take it home" bridge.
// Transpiles playground source into a real sverka.config.ts: the authoring
// surface (Project/Pipeline/Entry/roots) transfers verbatim — only the step
// kind differs. FunctionStep bodies cannot run as shell commands, so each
// becomes a ShellStep carrying a TODO echo the user replaces.

import { PlaygroundError } from "./share.js";

/** Find the index of the `}` matching the `{` at `open`. -1 when unbalanced. */
function matchBrace(source: string, open: number): number {
  let depth = 0;
  let inString: string | null = null;
  for (let i = open; i < source.length; i++) {
    const ch = source[i];
    if (inString !== null) {
      if (ch === "\\") i++;
      else if (ch === inString) inString = null;
      continue;
    }
    if (ch === '"' || ch === "'" || ch === "`") {
      inString = ch;
    } else if (ch === "{") {
      depth++;
    } else if (ch === "}") {
      depth--;
      if (depth === 0) return i;
    }
  }
  return -1;
}

/** Extract a `key: <balanced>` value span from a props object body. */
function extractProp(props: string, key: string): string | undefined {
  const m = new RegExp(`\\b${key}\\s*:\\s*`).exec(props);
  if (!m) return undefined;
  const start = m.index + m[0].length;
  const opener = props[start];
  if (opener === "[" || opener === "{") {
    const closer = opener === "[" ? "]" : "}";
    let depth = 0;
    for (let i = start; i < props.length; i++) {
      if (props[i] === opener) depth++;
      else if (props[i] === closer) {
        depth--;
        if (depth === 0) return props.slice(start, i + 1);
      }
    }
    return undefined;
  }
  // Scalar — read to the next top-level comma or end of props.
  const rest = props.slice(start);
  const cut = rest.search(/,\s*(?:\w|$)/);
  return cut >= 0 ? rest.slice(0, cut).trim() : rest.trim();
}

/**
 * Transpile playground source into `sverka.config.ts`.
 *
 * Rewrites the `@sverka/playground` import to `@sverka/workflow` and each
 * `new FunctionStep(scope, "id", { fn, dependencies })` into a ShellStep
 * whose command echoes a TODO — the function body has no shell equivalent.
 * `dependencies` maps onto `dependsOn`.
 *
 * Throws `PlaygroundError(TRANSPILE_FAILED)` naming the offending step when
 * a FunctionStep cannot be parsed — a half-converted file is never emitted.
 */
export function toSverkaConfig(source: string): string {
  // 1. Import rewrite.
  let out = source.replace(
    /import\s*\{([^}]*)\}\s*from\s*["']@sverka\/playground["']/g,
    (_m, names: string) => {
      const mapped = names
        .split(",")
        .map((n) => n.trim())
        .filter(Boolean)
        .map((n) => (n === "FunctionStep" ? "ShellStep" : n));
      return `import { ${mapped.join(", ")} } from "@sverka/workflow"`;
    },
  );

  // 2. FunctionStep → ShellStep, props rewritten.
  const stepRe =
    /new\s+FunctionStep\s*\(\s*([^,]+?)\s*,\s*(["'`])([^"'`]+)\2\s*,\s*\{/g;
  let result = "";
  let cursor = 0;
  for (;;) {
    const m = stepRe.exec(out);
    if (!m) break;
    const [full, scope, , id] = m;
    const propsOpen = m.index + full.length - 1; // index of '{'
    const propsClose = matchBrace(out, propsOpen);
    if (propsClose < 0) {
      throw new PlaygroundError(
        "TRANSPILE_FAILED",
        `cannot parse FunctionStep "${id}" — unbalanced props object`,
      );
    }
    const props = out.slice(propsOpen + 1, propsClose);
    const dependencies = extractProp(props, "dependencies");
    // Original `)` after the props `}` closes the call — emit without it.
    const todo = `new ShellStep(${scope}, "${id}", { command: "echo \\"TODO: port '${id}' — replace with the real shell command\\""${dependencies ? `, dependsOn: ${dependencies}` : ""} }`;
    result += out.slice(cursor, m.index) + todo;
    cursor = propsClose + 1;
    stepRe.lastIndex = cursor;
  }
  out = result + out.slice(cursor);

  // A surviving FunctionStep means the step regex matched nothing usable —
  // e.g. computed scope/id. Fail loud rather than emit a half-converted file.
  const leftover = /new\s+FunctionStep\s*\(\s*([^,\n]*)/.exec(out);
  if (leftover) {
    throw new PlaygroundError(
      "TRANSPILE_FAILED",
      `cannot parse FunctionStep with scope '${leftover[1]?.trim() ?? "?"}' — unsupported expression`,
    );
  }

  return out;
}
