// @sverka/checks — public API

export type { CheckResolver, ResolvedCheck, CheckOutput } from "./resolver.js";
export { createBuiltinResolver } from "./resolver.js";
export { extractFindings } from "./extract.js";
export { CheckError, type CheckErrorCode } from "./errors.js";
