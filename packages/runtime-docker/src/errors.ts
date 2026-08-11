/**
 * Base error class for the runtime-docker package. All Docker executor errors
 * extend this so callers can catch the full family with a single
 * `instanceof DockerExecutorError`.
 */
export class DockerExecutorError extends Error {
  constructor(
    message: string,
    readonly code: string,
    readonly context?: Record<string, unknown>,
  ) {
    super(message);
    this.name = "DockerExecutorError";
  }
}

/** Raised when image digest verification fails. */
export class ImageDigestError extends DockerExecutorError {
  constructor(message: string, context?: Record<string, unknown>) {
    super(message, "IMAGE_DIGEST_MISMATCH", context);
    this.name = "ImageDigestError";
  }
}

/** Raised when a container policy violation is attempted. */
export class ContainerPolicyError extends DockerExecutorError {
  constructor(
    message: string,
    context?: Record<string, unknown>,
    code = "CONTAINER_POLICY_VIOLATION",
  ) {
    super(message, code, context);
    this.name = "ContainerPolicyError";
  }
}
