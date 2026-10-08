// Markdown authoring (Spec 37) — `.sverka.md` files: YAML frontmatter
// (pipeline metadata, triggers, inputs, `extends`) + `## step` sections
// with `- command:` bullets. Compiles through the same Construct API as
// sverka.config.ts — the produced graph is identical, not approximate.
//
// Spec 54 extends the trigger set with `comment` and `issue` kinds and
// accepts gh-aw-style `on:` shorthand so the same frontmatter shape works
// for agentic GitLab workflows.
//
// Deliberate subset (per Spec 37 non-goals): shell steps only — agent
// steps, safe-outputs, matrices and conditions use `extends` + TS.

import { readFile } from "node:fs/promises";
import { existsSync } from "node:fs";
import { dirname, isAbsolute, resolve } from "node:path";
import { pathToFileURL } from "node:url";
import { parse as parseYaml } from "yaml";
import {
  Construct,
  Project,
  Pipeline,
  ShellStep,
  Entry,
} from "@sverka/workflow";
import type {
  Input,
  OutputDeclaration,
  Trigger,
  TriggerFilter,
} from "@sverka/workflow";
import { MarkdownParseError } from "./markdown-errors.js";

/** Frontmatter shape (Spec 37 + Spec 54 `on:` alias and event kinds). */
export interface MarkdownFrontmatter {
  readonly pipeline: string;
  readonly triggers?: readonly MarkdownTrigger[];
  /** gh-aw-style shorthand for `triggers`. */
  readonly on?: string | readonly string[] | Record<string, unknown>;
  readonly extends?: string;
  readonly inputs?: Readonly<Record<string, Input>>;
}

/** A single frontmatter trigger entry. */
export interface MarkdownTrigger {
  readonly kind:
    "push" | "changeRequest" | "manual" | "schedule" | "comment" | "issue";
  readonly branches?: readonly string[];
  readonly tags?: readonly string[];
  readonly paths?: readonly string[];
  readonly cron?: string;
  readonly timezone?: string;
  readonly mention?: string;
  readonly on?: "mergeRequest" | "issue" | "commit";
  readonly action?: "opened" | "reopened" | "labeled";
  readonly labels?: readonly string[];
}

interface ParsedStep {
  readonly id: string;
  readonly command: string;
  readonly dependsOn?: readonly string[];
  readonly image?: string;
  readonly timeout?: number;
  readonly outputs?: Readonly<Record<string, OutputDeclaration>>;
}

/**
 * Parse a `.sverka.md` source string into a Project construct.
 * `filePath` anchors `extends` resolution and error messages; without it
 * `extends` cannot resolve and throws EXTENDS_NOT_FOUND.
 */
export function parseMarkdown(source: string, filePath?: string): Project {
  const { frontmatter, body } = splitFrontmatter(source, filePath);
  const project = new Project(frontmatter.pipeline);
  buildMarkdownPipeline(project, frontmatter, body, filePath);
  return project;
}

/**
 * Read + parse a `.sverka.md` file. When frontmatter declares `extends`,
 * the referenced config module is imported and the markdown pipeline is
 * merged into that Project (Spec 37 escape hatch).
 */
export async function loadMarkdownFile(path: string): Promise<Project> {
  const abs = isAbsolute(path) ? path : resolve(process.cwd(), path);
  let source: string;
  try {
    source = await readFile(abs, "utf-8");
  } catch (e) {
    throw new MarkdownParseError(
      `cannot read markdown file: ${abs}`,
      "INVALID_FRONTMATTER",
      e,
    );
  }
  const { frontmatter, body } = splitFrontmatter(source, abs);

  if (frontmatter.extends !== undefined) {
    const base = await loadExtends(frontmatter.extends, abs);
    buildMarkdownPipeline(base, frontmatter, body, abs);
    return base;
  }

  const project = new Project(frontmatter.pipeline);
  buildMarkdownPipeline(project, frontmatter, body, abs);
  return project;
}

// ---------------------------------------------------------------------------
// Frontmatter
// ---------------------------------------------------------------------------

function splitFrontmatter(
  source: string,
  filePath?: string,
): { frontmatter: MarkdownFrontmatter; body: string } {
  const where = filePath !== undefined ? ` in ${filePath}` : "";
  const m = /^---\r?\n([\s\S]*?)\r?\n---\r?\n?([\s\S]*)$/.exec(source);
  if (m === null) {
    throw new MarkdownParseError(
      `invalid .sverka.md${where}: missing YAML frontmatter (expected '---' delimiters)`,
      "INVALID_FRONTMATTER",
    );
  }
  let parsed: unknown;
  try {
    parsed = parseYaml(m[1]!);
  } catch (e) {
    throw new MarkdownParseError(
      `invalid .sverka.md frontmatter${where}: ${e instanceof Error ? e.message : String(e)}`,
      "INVALID_FRONTMATTER",
      e,
    );
  }
  if (typeof parsed !== "object" || parsed === null || Array.isArray(parsed)) {
    throw new MarkdownParseError(
      `invalid .sverka.md frontmatter${where}: expected a mapping`,
      "INVALID_FRONTMATTER",
    );
  }
  const fm = parsed as Record<string, unknown>;
  if (typeof fm.pipeline !== "string" || fm.pipeline === "") {
    throw new MarkdownParseError(
      `invalid .sverka.md frontmatter${where}: missing required 'pipeline' field`,
      "INVALID_FRONTMATTER",
    );
  }
  return {
    frontmatter: fm as unknown as MarkdownFrontmatter,
    body: m[2]!,
  };
}

// ---------------------------------------------------------------------------
// Triggers
// ---------------------------------------------------------------------------

function frontmatterTriggers(fm: MarkdownFrontmatter): readonly Trigger[] {
  const raw = collectTriggerEntries(fm);
  return raw.map((entry, i) => toTrigger(entry, i));
}

interface TriggerEntry {
  readonly kind: string;
  readonly opts: Record<string, unknown>;
}

/**
 * Normalize `triggers:` (array of objects) and `on:` (gh-aw shorthand:
 * string, list of kind strings, or map of kind → options) into uniform
 * entries. `triggers` wins when both are present.
 */
function collectTriggerEntries(
  fm: MarkdownFrontmatter,
): readonly TriggerEntry[] {
  if (fm.triggers !== undefined) {
    if (!Array.isArray(fm.triggers)) {
      throw new MarkdownParseError(
        "invalid .sverka.md frontmatter: 'triggers' must be an array",
        "INVALID_TRIGGER",
      );
    }
    return (fm.triggers as readonly Record<string, unknown>[]).map((t) => {
      if (typeof t !== "object" || t === null || typeof t.kind !== "string") {
        throw new MarkdownParseError(
          "invalid .sverka.md trigger: each entry needs a string 'kind'",
          "INVALID_TRIGGER",
        );
      }
      const { kind, ...opts } = t;
      return { kind, opts };
    });
  }
  if (fm.on === undefined) return [];
  const on = fm.on;
  if (typeof on === "string") return [{ kind: on, opts: {} }];
  if (Array.isArray(on)) {
    return on.map((kind) => {
      if (typeof kind !== "string") {
        throw new MarkdownParseError(
          "invalid .sverka.md 'on': entries must be trigger kind strings",
          "INVALID_TRIGGER",
        );
      }
      return { kind, opts: {} };
    });
  }
  if (typeof on === "object" && on !== null) {
    return Object.entries(on).map(([kind, opts]) => ({
      kind,
      opts:
        typeof opts === "object" && opts !== null
          ? (opts as Record<string, unknown>)
          : {},
    }));
  }
  throw new MarkdownParseError(
    "invalid .sverka.md 'on': expected a trigger kind, list of kinds, or kind→options map",
    "INVALID_TRIGGER",
  );
}

const FILTER_KEYS = ["branches", "tags", "paths"] as const;

function toTrigger(entry: TriggerEntry, index: number): Trigger {
  const { kind, opts } = entry;
  const at = `trigger[${index}] (${kind})`;
  const filter = buildFilter(opts, at);
  switch (kind) {
    case "push":
      return filter !== undefined ? { kind: "push", filter } : { kind: "push" };
    case "changeRequest":
      return filter !== undefined
        ? { kind: "changeRequest", filter }
        : { kind: "changeRequest" };
    case "manual":
      return filter !== undefined
        ? { kind: "manual", filter }
        : { kind: "manual" };
    case "schedule":
      return toScheduleTrigger(opts, at);
    case "comment":
      return toCommentTrigger(opts, at);
    case "issue":
      return toIssueTrigger(opts, at);
    default:
      throw new MarkdownParseError(
        `invalid .sverka.md ${at}: unknown trigger kind '${kind}'`,
        "INVALID_TRIGGER",
      );
  }
}

function toScheduleTrigger(opts: Record<string, unknown>, at: string): Trigger {
  if (typeof opts.cron !== "string" || opts.cron === "") {
    throw new MarkdownParseError(
      `invalid .sverka.md ${at}: schedule trigger requires a 'cron' string`,
      "INVALID_TRIGGER",
    );
  }
  if (opts.timezone !== undefined && typeof opts.timezone !== "string") {
    throw new MarkdownParseError(
      `invalid .sverka.md ${at}: schedule 'timezone' must be a string`,
      "INVALID_TRIGGER",
    );
  }
  return {
    kind: "schedule",
    cron: opts.cron,
    ...(opts.timezone !== undefined ? { timezone: opts.timezone } : {}),
  };
}

function toCommentTrigger(opts: Record<string, unknown>, at: string): Trigger {
  const on = opts.on;
  if (
    on !== undefined &&
    on !== "mergeRequest" &&
    on !== "issue" &&
    on !== "commit"
  ) {
    throw new MarkdownParseError(
      `invalid .sverka.md ${at}: comment 'on' must be mergeRequest|issue|commit`,
      "INVALID_TRIGGER",
    );
  }
  // A dropped non-string mention silently widens a restricted trigger
  // into an unrestricted one — reject it instead.
  if (opts.mention !== undefined && typeof opts.mention !== "string") {
    throw new MarkdownParseError(
      `invalid .sverka.md ${at}: comment 'mention' must be a string`,
      "INVALID_TRIGGER",
    );
  }
  return {
    kind: "comment",
    ...(opts.mention !== undefined ? { mention: opts.mention } : {}),
    ...(on !== undefined ? { on } : {}),
  };
}

function toIssueTrigger(opts: Record<string, unknown>, at: string): Trigger {
  const action = opts.action;
  if (
    action !== undefined &&
    action !== "opened" &&
    action !== "reopened" &&
    action !== "labeled"
  ) {
    throw new MarkdownParseError(
      `invalid .sverka.md ${at}: issue 'action' must be opened|reopened|labeled`,
      "INVALID_TRIGGER",
    );
  }
  const labels = opts.labels;
  if (
    labels !== undefined &&
    (!Array.isArray(labels) || !labels.every((l) => typeof l === "string"))
  ) {
    throw new MarkdownParseError(
      `invalid .sverka.md ${at}: issue 'labels' must be an array of strings`,
      "INVALID_TRIGGER",
    );
  }
  return {
    kind: "issue",
    ...(action !== undefined ? { action } : {}),
    ...(labels !== undefined ? { labels: labels as readonly string[] } : {}),
  };
}

function buildFilter(
  opts: Record<string, unknown>,
  at: string,
): TriggerFilter | undefined {
  const filter: Record<string, readonly string[]> = {};
  for (const key of FILTER_KEYS) {
    const v = opts[key];
    if (v === undefined) continue;
    if (!Array.isArray(v) || !v.every((s) => typeof s === "string")) {
      throw new MarkdownParseError(
        `invalid .sverka.md ${at}: '${key}' must be an array of strings`,
        "INVALID_TRIGGER",
      );
    }
    filter[key] = v as readonly string[];
  }
  return Object.keys(filter).length > 0 ? (filter as TriggerFilter) : undefined;
}

// ---------------------------------------------------------------------------
// Steps
// ---------------------------------------------------------------------------

const STEP_HEADING = /^##\s+(\S+)\s*$/;

function parseSteps(body: string): readonly ParsedStep[] {
  const steps: ParsedStep[] = [];
  const lines = body.split("\n");
  let i = 0;
  while (i < lines.length) {
    const heading = STEP_HEADING.exec(lines[i]!);
    if (heading === null) {
      i++;
      continue;
    }
    const id = heading[1]!;
    const section: string[] = [];
    let j = i + 1;
    while (j < lines.length && !STEP_HEADING.test(lines[j]!)) {
      section.push(lines[j]!);
      j++;
    }
    steps.push(parseStepSection(id, section));
    i = j;
  }
  return steps;
}

/**
 * Parse one `- key: value` bullet line. Hand-rolled linear scan — a regex
 * over uncontrolled markdown is a ReDoS vector.
 */
function parseBulletLine(
  line: string,
): { readonly key: string; readonly rest: string } | null {
  const isSpace = (c: string | undefined) => c !== undefined && /\s/.test(c);
  const isKeyChar = (c: string | undefined) =>
    c !== undefined && /[\w-]/.test(c);
  if (line[0] !== "-" || !isSpace(line[1])) return null;
  let i = skipWhile(line, 1, isSpace);
  if (!isKeyStart(line[i])) return null;
  const keyStart = i;
  i = skipWhile(line, i, isKeyChar);
  const key = line.slice(keyStart, i);
  i = skipWhile(line, i, isSpace);
  if (line[i] !== ":") return null;
  return { key, rest: line.slice(i + 1).trimStart() };
}

function skipWhile(
  line: string,
  from: number,
  pred: (c: string | undefined) => boolean,
): number {
  let i = from;
  while (i < line.length && pred(line[i])) i++;
  return i;
}

function isKeyStart(c: string | undefined): boolean {
  return c !== undefined && /[a-zA-Z_]/.test(c);
}

/**
 * Parse one `## step` section: `- key: value` bullets (indented blocks
 * belong to the preceding bullet). Non-bullet prose is ignored so a step
 * can carry documentation.
 */
function parseStepSection(id: string, lines: readonly string[]): ParsedStep {
  return toParsedStep(id, collectStepProps(id, lines));
}

/** Validate collected props and build the ParsedStep. */
function toParsedStep(id: string, props: Record<string, unknown>): ParsedStep {
  if (typeof props.command !== "string" || props.command === "") {
    throw new MarkdownParseError(
      `invalid .sverka.md step '${id}': missing required '- command:' line`,
      "INVALID_STEP",
    );
  }
  const dependsOn = props.dependsOn ?? props["depends_on"];
  if (
    dependsOn !== undefined &&
    (!Array.isArray(dependsOn) ||
      !dependsOn.every((d) => typeof d === "string"))
  ) {
    throw new MarkdownParseError(
      `invalid .sverka.md step '${id}': 'dependsOn' must be an array of step ids`,
      "INVALID_STEP",
    );
  }
  if (
    props.timeout !== undefined &&
    (typeof props.timeout !== "number" || !Number.isFinite(props.timeout))
  ) {
    throw new MarkdownParseError(
      `invalid .sverka.md step '${id}': 'timeout' must be a number (ms)`,
      "INVALID_STEP",
    );
  }
  if (props.image !== undefined && typeof props.image !== "string") {
    throw new MarkdownParseError(
      `invalid .sverka.md step '${id}': 'image' must be a string`,
      "INVALID_STEP",
    );
  }

  return {
    id,
    command: props.command,
    ...(dependsOn !== undefined
      ? { dependsOn: dependsOn as readonly string[] }
      : {}),
    ...(props.image !== undefined ? { image: props.image as string } : {}),
    ...(props.timeout !== undefined
      ? { timeout: props.timeout as number }
      : {}),
    ...(props.outputs !== undefined
      ? {
          outputs: props.outputs as Readonly<Record<string, OutputDeclaration>>,
        }
      : {}),
  };
}

/**
 * Collect `- key: value` bullets (with indented continuation blocks) into
 * a props map. Non-bullet prose is ignored.
 */
function collectStepProps(
  id: string,
  lines: readonly string[],
): Record<string, unknown> {
  const props: Record<string, unknown> = {};
  let i = 0;
  while (i < lines.length) {
    const bullet = parseBulletLine(lines[i]!);
    if (bullet === null) {
      i++;
      continue;
    }
    const { key, rest } = bullet;
    if (rest === "") {
      // Nested block: collect the indented continuation lines.
      const block: string[] = [];
      let j = i + 1;
      while (j < lines.length && /^\s+\S/.test(lines[j]!)) {
        block.push(lines[j]!);
        j++;
      }
      props[key] =
        block.length > 0 ? parseYamlScalar(block.join("\n"), id, key) : null;
      i = j;
    } else {
      props[key] = parseYamlScalar(rest, id, key);
      i++;
    }
  }
  return props;
}

function parseYamlScalar(rest: string, stepId: string, key: string): unknown {
  try {
    return parseYaml(rest);
  } catch (e) {
    throw new MarkdownParseError(
      `invalid .sverka.md step '${stepId}': cannot parse '${key}' value: ${e instanceof Error ? e.message : String(e)}`,
      "INVALID_STEP",
      e,
    );
  }
}

// ---------------------------------------------------------------------------
// Construct assembly
// ---------------------------------------------------------------------------

function buildMarkdownPipeline(
  scope: Project,
  fm: MarkdownFrontmatter,
  body: string,
  _filePath?: string,
): void {
  const pipeline = new Pipeline(scope, fm.pipeline, {
    ...(fm.inputs !== undefined ? { inputs: fm.inputs } : {}),
  });
  const steps = parseSteps(body);
  for (const step of steps) {
    // Construct registers into `pipeline` on construction — no value used.
    void new ShellStep(pipeline, step.id, {
      command: step.command,
      ...(step.dependsOn !== undefined ? { dependsOn: step.dependsOn } : {}),
      ...(step.image !== undefined
        ? { runtime: { mode: "container", image: step.image } }
        : {}),
      ...(step.timeout !== undefined ? { timeout: step.timeout } : {}),
      ...(step.outputs !== undefined ? { outputs: step.outputs } : {}),
    });
  }
  // Entry roots: every step — `on:` triggers the whole pipeline, matching
  // gh-aw semantics (reachability walks dependencies back to producers).
  const roots = steps.map((s) => s.id);
  const triggers = frontmatterTriggers(fm);
  const usedIds = new Set<string>();
  for (const trigger of triggers) {
    const base = `on-${trigger.kind}`;
    let id = base;
    let n = 2;
    while (usedIds.has(id)) {
      id = `${base}-${n}`;
      n++;
    }
    usedIds.add(id);
    void new Entry(pipeline, id, { trigger, roots });
  }
}

// ---------------------------------------------------------------------------
// extends
// ---------------------------------------------------------------------------

async function loadExtends(
  extendsPath: string,
  mdPath: string,
): Promise<Project> {
  const resolved = resolve(dirname(mdPath), extendsPath);
  if (!existsSync(resolved)) {
    throw new MarkdownParseError(
      `extends path does not resolve: ${extendsPath} (from ${mdPath})`,
      "EXTENDS_NOT_FOUND",
    );
  }
  let mod: Record<string, unknown>;
  try {
    mod = await import(pathToFileURL(resolved).href);
  } catch (e) {
    throw new MarkdownParseError(
      `failed to load extends config ${extendsPath}: ${e instanceof Error ? e.message : String(e)}`,
      "EXTENDS_NOT_FOUND",
      e,
    );
  }
  const construct = mod.project ?? mod.default;
  if (
    typeof construct !== "object" ||
    construct === null ||
    !("node" in construct)
  ) {
    throw new MarkdownParseError(
      `extends config ${extendsPath} must export a Project or Pipeline`,
      "EXTENDS_NOT_FOUND",
    );
  }
  const node = (construct as Construct).node;
  // A bare Pipeline's scope is its implicitly-created Project — add the
  // markdown pipeline alongside it.
  return (node.scope ?? construct) as unknown as Project;
}
