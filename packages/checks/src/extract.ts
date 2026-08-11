import { existsSync } from "node:fs";
import { readFile } from "node:fs/promises";
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
 * Validate that an output path stays inside the artifact directory and is
 * not absolute. Returns the resolved, safe file path.
 */
function resolveSafeOutputPath(
  outputPath: string,
  artifactDir: string,
): string {
  if (isAbsolute(outputPath)) {
    throw new CheckError(
      `absolute output path "${outputPath}" is not allowed`,
      "EXTRACTION_FAILED",
    );
  }
  const filePath = resolve(artifactDir, outputPath);
  const rel = relative(artifactDir, filePath);
  if (rel.startsWith("..")) {
    throw new CheckError(
      `output path "${outputPath}" escapes artifactDir`,
      "EXTRACTION_FAILED",
    );
  }
  return filePath;
}

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
    const filePath = resolveSafeOutputPath(output.path, artifactDir);
    if (!existsSync(filePath)) continue;
    const raw = await readFile(filePath, "utf8");
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
