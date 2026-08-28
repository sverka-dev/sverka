// @sverka/checks — public API. Spec 14.

export type { CheckResolver, ResolvedCheck, CheckOutput } from "./resolver.js";
export { createBuiltinResolver } from "./resolver.js";
export { synthesizeCheckSteps } from "./synthesize.js";
export { extractFindings } from "./extract.js";
export { CheckError, type CheckErrorCode } from "./errors.js";
