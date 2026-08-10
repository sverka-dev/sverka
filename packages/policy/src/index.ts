// @sverka/policy — public API

/**
 * Base error class for the policy package. All policy errors extend this
 * so callers can catch the full family with a single `instanceof PolicyError`.
 */
export class PolicyError extends Error {
  constructor(
    message: string,
    readonly code: string,
    readonly context?: Record<string, unknown>,
  ) {
    super(message);
    this.name = "PolicyError";
  }
}
