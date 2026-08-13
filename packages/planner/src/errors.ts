/**
 * Base error class for the planner package. All discovery failures throw a
 * `DiscoveryError` with one of the four `DiscoveryErrorCode` values.
 */
export class DiscoveryError extends Error {
  readonly code: DiscoveryErrorCode;
  override readonly cause: unknown;
  constructor(message: string, code: DiscoveryErrorCode, cause?: unknown) {
    super(message);
    this.name = "DiscoveryError";
    this.code = code;
    this.cause = cause;
  }
}

export type DiscoveryErrorCode =
  | "ROOT_NOT_FOUND"
  | "GIT_UNAVAILABLE"
  | "GIT_NOT_A_REPO"
  | "TRAVERSAL_FAILED"
  | "INVALID_BASE_REF";

/**
 * Planner error for Run Plan binding failures. Spec 13 — Error handling.
 */
export class PlannerError extends Error {
  readonly code: PlannerErrorCode;
  override readonly cause: unknown;
  constructor(message: string, code: PlannerErrorCode, cause?: unknown) {
    super(message);
    this.name = "PlannerError";
    this.code = code;
    this.cause = cause;
  }
}

export type PlannerErrorCode =
  | "ENTRY_NOT_FOUND"
  | "ROOT_NOT_FOUND"
  | "MISSING_INPUT"
  | "INVALID_GRAPH";
