// SynthesisError — thrown during synthesis validation.
// Spec 05 — Error handling.

export type SynthesisErrorCode =
  | "CYCLE"
  | "UNKNOWN_PRODUCER"
  | "OUTPUT_COLLISION"
  | "INCOMPATIBLE_REFERENCE"
  | "INVALID_OUTPUT";

export class SynthesisError extends Error {
  override readonly cause: unknown;
  readonly code: SynthesisErrorCode;
  readonly stepId?: string;

  constructor(
    code: SynthesisErrorCode,
    message: string,
    stepId?: string,
    cause?: unknown,
  ) {
    super(message);
    this.name = "SynthesisError";
    this.code = code;
    if (stepId !== undefined) {
      this.stepId = stepId;
    }
    if (cause !== undefined) {
      this.cause = cause;
    }
  }
}
