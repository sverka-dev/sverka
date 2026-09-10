// @sverka/sarif-viewer-web — input resolution. Spec 47.

import { readFileSync } from "node:fs";
import process from "node:process";
import {
  normalizeSarif,
  type Finding,
  type NormalizeContext,
  type SarifLog,
} from "@sverka/verification";
import type { SarifWebOptions } from "./types.js";

/** Default NormalizeContext for `normalizeSarif`. */
export const DEFAULT_NORMALIZE_CONTEXT: NormalizeContext = {
  root: process.cwd(),
  checkIdPrefix: "",
  defaultConfidence: 0.5,
};

/**
 * Resolve `SarifWebOptions` (minus `outputPath`) into a `Finding[]`. Exactly
 * one of `sarif`, `sarifPath`, `findings` must be provided.
 *
 * @throws {Error} when zero or more than one input is provided.
 * @throws {NormalizationError} when SARIF is invalid (propagated).
 * @throws {Error} when the file cannot be read or parsed.
 */
export function resolveFindings(options: Omit<SarifWebOptions, "outputPath">): Finding[] {
  const { sarif, sarifPath, findings, context } = options;
  const provided = [sarif, sarifPath, findings].filter((v) => v !== undefined);
  if (provided.length === 0) {
    throw new Error(
      "resolveFindings: provide exactly one of sarif, sarifPath, or findings",
    );
  }
  if (provided.length > 1) {
    throw new Error(
      "resolveFindings: provide only one of sarif, sarifPath, or findings",
    );
  }

  if (findings !== undefined) {
    return [...findings];
  }

  const ctx: NormalizeContext = context ?? DEFAULT_NORMALIZE_CONTEXT;

  if (sarif !== undefined) {
    return normalizeSarif(sarif, ctx);
  }

  // sarifPath is defined (only remaining option).
  const raw = readFileSync(sarifPath as string, "utf8");
  let parsed: SarifLog;
  try {
    parsed = JSON.parse(raw) as SarifLog;
  } catch {
    throw new Error(`resolveFindings: failed to parse SARIF JSON from ${sarifPath as string}`);
  }
  return normalizeSarif(parsed, ctx);
}
