import { createHash } from "node:crypto";
import type { FingerprintInput } from "./types.js";
import { NormalizationError } from "./errors.js";

/**
 * Compute a deterministic fingerprint for the given finding data.
 *
 * The fingerprint is insensitive to message wording and severity changes,
 * but sensitive to file, rule, and line range. It is a lowercase hex
 * SHA-256 string.
 *
 * @throws {NormalizationError} INVALID_FINGERPRINT_INPUT — `file` is empty
 *   or `startLine`/`endLine` are not positive. `rule` and `checkId` may be
 *   empty (SARIF edge case: a result with no ruleId and no ruleIndex).
 */
export function computeFingerprint(input: FingerprintInput): string {
  if (!input.file) {
    throw new NormalizationError(
      "file must be a non-empty string",
      "INVALID_FINGERPRINT_INPUT",
    );
  }
  if (input.startLine <= 0) {
    throw new NormalizationError(
      "startLine must be > 0",
      "INVALID_FINGERPRINT_INPUT",
    );
  }
  if (input.endLine <= 0) {
    throw new NormalizationError(
      "endLine must be > 0",
      "INVALID_FINGERPRINT_INPUT",
    );
  }

  const normalizedFile = input.file.split("\\").join("/");
  const payload = `${input.checkId}|${input.rule}|${normalizedFile}|${input.startLine}|${input.endLine}`;
  return createHash("sha256").update(payload).digest("hex");
}
