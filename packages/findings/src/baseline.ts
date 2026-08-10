import { readFile, writeFile } from "node:fs/promises";
import type { Finding } from "./types.js";
import { BaselineError } from "./errors.js";

/**
 * A baseline of known findings.
 */
export interface Baseline {
  /** Schema version of the baseline file. */
  version: number;
  /** Fingerprints of known findings. */
  fingerprints: string[];
  /** Suppression entries. */
  suppressions: Suppression[];
  /** When the baseline was created (ISO 8601). */
  createdAt: string;
  /** When the baseline was last updated (ISO 8601). */
  updatedAt: string;
}

/**
 * A suppression entry that marks a finding as ignored.
 */
export interface Suppression {
  /** Fingerprint of the suppressed finding. */
  fingerprint: string;
  /** Reason for suppression. */
  reason: string;
  /** Who created the suppression. */
  author: string;
  /** When the suppression was created (ISO 8601). */
  createdAt: string;
  /** Optional expiry date (ISO 8601). Expired suppressions are skipped. */
  expiresAt?: string;
}

/**
 * Result of comparing findings against a baseline.
 */
export interface BaselineDiff {
  /** Findings not present in the baseline (new). */
  newFindings: Finding[];
  /** Fingerprints in the baseline but not in the current run (resolved). */
  resolvedFingerprints: string[];
  /** Findings present in both (unchanged). */
  unchangedFindings: Finding[];
}

const BASELINE_VERSION = 1;

/**
 * Create a new baseline from a set of findings.
 * All fingerprints are added (deduped). No suppressions.
 * Timestamps are set to the current time.
 */
export function createBaseline(findings: readonly Finding[]): Baseline {
  const now = new Date().toISOString();
  const fingerprints = dedupeSorted(findings.map((f) => f.fingerprint));
  return {
    version: BASELINE_VERSION,
    fingerprints,
    suppressions: [],
    createdAt: now,
    updatedAt: now,
  };
}

/**
 * Merge current findings into an existing baseline.
 * New fingerprints are added. Fingerprints no longer present are removed.
 * Suppressions for removed fingerprints are removed.
 * `updatedAt` is refreshed; `createdAt` is preserved.
 */
export function updateBaseline(
  current: readonly Finding[],
  existing: Baseline,
): Baseline {
  const currentFps = new Set(current.map((f) => f.fingerprint));
  const keptSuppressions = existing.suppressions.filter((s) =>
    currentFps.has(s.fingerprint),
  );
  return {
    version: existing.version,
    fingerprints: dedupeSorted([...currentFps]),
    suppressions: keptSuppressions,
    createdAt: existing.createdAt,
    updatedAt: new Date().toISOString(),
  };
}

/**
 * Compare current findings against a baseline.
 * A finding is "new" if its fingerprint is not in `baseline.fingerprints`.
 * A fingerprint is "resolved" if it is in the baseline but not in current.
 * Otherwise the finding is "unchanged".
 */
export function compareBaseline(
  current: readonly Finding[],
  baseline: Baseline,
): BaselineDiff {
  const baselineFps = new Set(baseline.fingerprints);
  const currentFps = new Set(current.map((f) => f.fingerprint));

  const newFindings: Finding[] = [];
  const unchangedFindings: Finding[] = [];
  for (const f of current) {
    if (baselineFps.has(f.fingerprint)) {
      unchangedFindings.push(f);
    } else {
      newFindings.push(f);
    }
  }

  const resolvedFingerprints = baseline.fingerprints.filter(
    (fp) => !currentFps.has(fp),
  );

  return { newFindings, resolvedFingerprints, unchangedFindings };
}

/**
 * Load a baseline from a JSON file.
 * @throws {BaselineError} BASELINE_NOT_FOUND — file does not exist.
 * @throws {BaselineError} BASELINE_INVALID — invalid JSON or wrong schema.
 */
export async function loadBaseline(path: string): Promise<Baseline> {
  let content: string;
  try {
    content = await readFile(path, "utf8");
  } catch (e) {
    const err = e as NodeJS.ErrnoException;
    if (err.code === "ENOENT") {
      throw new BaselineError(`baseline file not found: ${path}`, "BASELINE_NOT_FOUND", e);
    }
    throw new BaselineError(`cannot read baseline file: ${path}`, "BASELINE_INVALID", e);
  }

  let parsed: unknown;
  try {
    parsed = JSON.parse(content);
  } catch (e) {
    throw new BaselineError("baseline file is not valid JSON", "BASELINE_INVALID", e);
  }

  const obj = parsed as Record<string, unknown>;
  if (obj.version !== BASELINE_VERSION) {
    throw new BaselineError(
      `baseline version must be ${BASELINE_VERSION}, got ${String(obj.version)}`,
      "BASELINE_INVALID",
    );
  }
  if (!Array.isArray(obj.fingerprints)) {
    throw new BaselineError(
      "baseline.fingerprints must be an array",
      "BASELINE_INVALID",
    );
  }
  if (!Array.isArray(obj.suppressions)) {
    throw new BaselineError(
      "baseline.suppressions must be an array",
      "BASELINE_INVALID",
    );
  }

  return {
    version: obj.version as number,
    fingerprints: obj.fingerprints as string[],
    suppressions: obj.suppressions as Suppression[],
    createdAt: String(obj.createdAt ?? ""),
    updatedAt: String(obj.updatedAt ?? ""),
  };
}

/**
 * Save a baseline to a JSON file.
 * @throws {BaselineError} BASELINE_WRITE_FAILED — cannot write the file.
 */
export async function saveBaseline(
  baseline: Baseline,
  path: string,
): Promise<void> {
  const json = JSON.stringify(baseline, null, 2);
  try {
    await writeFile(path, json, "utf8");
  } catch (e) {
    throw new BaselineError(
      `cannot write baseline file: ${path}`,
      "BASELINE_WRITE_FAILED",
      e,
    );
  }
}

/**
 * Dedupe and sort an array of strings.
 */
function dedupeSorted(items: readonly string[]): string[] {
  return [...new Set(items)].sort();
}
