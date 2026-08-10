// @sverka/runtime — public API

/**
 * Base error class for the runtime package. All runtime errors extend this
 * so callers can catch the full family with a single `instanceof RuntimeError`.
 */
export class RuntimeError extends Error {
  constructor(
    message: string,
    readonly code: string,
    readonly context?: Record<string, unknown>,
  ) {
    super(message);
    this.name = "RuntimeError";
  }
}
