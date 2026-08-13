// Compatibility re-exports — delegate to canonical error classes.
// This preserves instanceof checks across compat and canonical code paths.

export { IRError, ValidationError, SerializationError } from "../errors.js";
export type { IRErrorCode } from "../errors.js";
