import { existsSync, readFileSync } from "node:fs";
import { join } from "node:path";
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
    const filePath = join(artifactDir, output.path);
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
