// Drone target error class. Spec 36.

export type DroneTargetErrorCode =
  | "INVALID_GRAPH"
  | "LOWER_FAILED"
  | "EMIT_FAILED";

export class DroneTargetError extends Error {
  readonly code: DroneTargetErrorCode;
  override readonly cause: unknown;

  constructor(message: string, code: DroneTargetErrorCode, cause?: unknown) {
    super(message);
    this.name = "DroneTargetError";
    this.code = code;
    this.cause = cause;
  }
}
