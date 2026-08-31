// @sverka/findings — public API
export { type Finding, type Severity, type FindingSource,
         type NormalizeContext, type FingerprintInput } from "./types.js";
export { type Baseline, type Suppression, type BaselineDiff } from "./baseline.js";
export { type SarifLog, type SarifRun, type SarifRule,
         type SarifResult, type SarifLocation } from "./normalize.js";
export { normalizeSarif } from "./normalize.js";
export { computeFingerprint } from "./fingerprint.js";
export { createBaseline, updateBaseline, compareBaseline,
         loadBaseline, saveBaseline } from "./baseline.js";
export { isSuppressed, filterSuppressed, filterOnlyNew } from "./suppress.js";
export { NormalizationError, type NormalizationErrorCode,
         BaselineError, type BaselineErrorCode } from "./errors.js";
