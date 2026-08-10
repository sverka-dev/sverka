export interface GitlabRule {
  readonly if?: string;
  readonly when?: "on_success" | "never" | "always" | "manual";
}

/** Compiler configuration. All fields optional; sensible defaults apply. */
export interface GitlabCompilerConfig {
  /** Base image for the job. Defaults to "node:24". */
  readonly image?: string;
  /** Sverka version to install. Defaults to "latest". */
  readonly sverkaVersion?: string;
  /** Rules for when the pipeline should run. Defaults to push + merge request. */
  readonly rules?: readonly GitlabRule[];
}
