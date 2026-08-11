import { existsSync, readFileSync } from "node:fs";
import { isAbsolute, relative, resolve } from "node:path";
import {
  normalizeSarif,
  type Finding,
  type NormalizeContext,
  type SarifLog,
} from "@sverka/findings";
import { CheckError } from "./errors.js";
import type { CheckOutput } from "./resolver.js";

/**
 * Extract findings from a check's output files. Reads each declared output
 * from `artifactDir`, parses SARIF via `@sverka/findings.normalizeSarif`,
 * and returns the combined findings.
 *
 * - Missing output file: skipped (no findings from that output).
 * - Non-SARIF format: skipped (deferred per findings non-goal).
 * - Invalid SARIF: throws CheckError(EXTRACTION_FAILED).
 *
 * @throws {CheckError} EXTRACTION_FAILED — SARIF file exists but is invalid.
 */
export async function extractFindings(
  outputs: readonly CheckOutput[],
  artifactDir: string,
  checkId: string,
): Promise<readonly Finding[]> {
  const findings: Finding[] = [];
  for (const output of outputs) {
    if (output.format !== "sarif") continue;
    if (isAbsolute(output.path)) {
      throw new CheckError(
        `absolute output path "${output.path}" is not allowed`,
        "EXTRACTION_FAILED",
      );
    }
    const filePath = resolve(artifactDir, output.path);
    const rel = relative(artifactDir, filePath);
    if (rel.startsWith("..")) {
      throw new CheckError(
        `output path "${output.path}" escapes artifactDir`,
        "EXTRACTION_FAILED",
      );
    }
    if (!existsSync(filePath)) continue;
    const raw = readFileSync(filePath, "utf8");
    let parsed: unknown;
    try {
      parsed = JSON.parse(raw);
    } catch (e) {
      throw new CheckError(
        `invalid JSON in ${output.path}`,
        "EXTRACTION_FAILED",
        e,
      );
    }
    try {
      const ctx: NormalizeContext = {
        root: artifactDir,
        checkIdPrefix: checkId,
        defaultConfidence: 0.5,
      };
      const result = normalizeSarif(parsed as SarifLog, ctx);
      findings.push(...result);
    } catch (e) {
      throw new CheckError(
        `SARIF normalization failed for ${output.path}`,
        "EXTRACTION_FAILED",
        e,
      );
    }
  }
  return findings;
}
