export interface GitlabRule {
  readonly if?: string;
  readonly when?: "on_success" | "never" | "always" | "manual";
}

/** Compiler configuration. All fields optional; sensible defaults apply. */
export interface GitlabCompilerConfig {
  /**
   * Base image for the job. Defaults to "oven/bun:latest".
   * The image must provide the Bun runtime because the generated job runs
   * `bun install` in `before_script`.
   */
  readonly image?: string;
  /** Sverka version to install. Defaults to "latest". */
  readonly sverkaVersion?: string;
  /** Rules for when the pipeline should run. Defaults to push + merge request. */
  readonly rules?: readonly GitlabRule[];
}
