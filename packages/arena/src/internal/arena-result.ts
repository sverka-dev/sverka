/**
 * `arena.result/v1` document — the published unit of the registry:
 * schema, validation, canonical path, and prompt comparability hash.
 * Re-exported through ../registry.js — not public on its own.
 */
import { createHash } from "node:crypto";
import { z } from "zod";

import { ArenaError } from "../config.js";

export interface TaskResult {
  readonly task: string;
  /** sha256 of the task prompt — a prompt edit breaks comparability. */
  readonly promptHash: string;
  readonly score: { readonly passed: boolean; readonly findings: number };
  readonly metrics: {
    readonly tokens?: number;
    readonly toolCalls?: number;
    readonly durationMs: number;
    readonly stopReason?: string;
  };
  readonly traceRef?: string;
}

export interface ArenaResultV1 {
  readonly schema: "arena.result/v1";
  readonly runId: string;
  readonly pack: string;
  readonly agent: string;
  readonly model: string;
  readonly plugins: readonly string[];
  readonly sverkaVersion: string;
  readonly startedAt: string;
  readonly tasks: readonly TaskResult[];
}

const taskResultSchema = z.object({
  task: z.string().min(1),
  promptHash: z.string().regex(/^[0-9a-f]{64}$/),
  score: z.object({
    passed: z.boolean(),
    findings: z.number().int().nonnegative(),
  }),
  metrics: z.object({
    tokens: z.number().optional(),
    toolCalls: z.number().optional(),
    durationMs: z.number(),
    stopReason: z.string().optional(),
  }),
  traceRef: z.string().optional(),
});

export const arenaResultV1Schema = z.object({
  schema: z.literal("arena.result/v1"),
  runId: z.string().min(1),
  pack: z.string().min(1),
  agent: z.string().min(1),
  model: z.string().min(1),
  plugins: z.array(z.string()),
  sverkaVersion: z.string().min(1),
  startedAt: z.iso.datetime(),
  tasks: z.array(taskResultSchema),
});

/** Validate a parsed value as arena.result/v1 — names failing fields. */
export function parseArenaResultV1(doc: unknown): ArenaResultV1 {
  const parsed = arenaResultV1Schema.safeParse(doc);
  if (!parsed.success) {
    const issues = parsed.error.issues
      .map((i) => `  ${i.path.join(".") || "(root)"}: ${i.message}`)
      .join("\n");
    throw new ArenaError(
      `invalid arena.result/v1 document:\n${issues}`,
      "SCHEMA_INVALID",
    );
  }
  return parsed.data as ArenaResultV1;
}

/** Parse raw text into a document — null for missing/corrupt input. */
export function tryParseResult(raw: string | null): ArenaResultV1 | null {
  if (raw === null) return null;
  try {
    const doc = JSON.parse(raw) as { schema?: string };
    if (doc?.schema !== "arena.result/v1") return null;
    return parseArenaResultV1(doc);
  } catch {
    return null; // a stray bad file must not break readers
  }
}

/** Registry path segments must not escape or nest the layout. */
export function checkSegment(value: string, field: string): void {
  if (
    !/^[a-zA-Z0-9][a-zA-Z0-9._-]*$/.test(value) || // nosemgrep: rules_lgpl_javascript_dos_rule-regex-dos
    value === "." ||
    value === ".."
  ) {
    throw new ArenaError(
      `invalid ${field} '${value}' — registry path segments must match [a-zA-Z0-9._-]+ and not start with a dot`,
      "SCHEMA_INVALID",
    );
  }
}

/** Canonical result path: results/<pack>/<agent>/<YYYY-MM-DD>/<runId>.json */
export function resultPath(doc: ArenaResultV1, date?: string): string {
  checkSegment(doc.pack, "pack");
  checkSegment(doc.agent, "agent");
  checkSegment(doc.runId, "runId");
  const day = date ?? doc.startedAt.slice(0, 10);
  // The partition lands inside a filesystem path — a date override must
  // be a strict YYYY-MM-DD, never a traversal like "../../tmp/out".
  if (!/^\d{4}-\d{2}-\d{2}$/.test(day)) {
    throw new ArenaError(
      `invalid date partition '${day}' — expected YYYY-MM-DD`,
      "SCHEMA_INVALID",
    );
  }
  return `results/${doc.pack}/${doc.agent}/${day}/${doc.runId}.json`;
}

/** sha256 of a task prompt — the comparability cohort key. */
export function promptHash(prompt: string): string {
  return createHash("sha256").update(prompt, "utf8").digest("hex");
}
