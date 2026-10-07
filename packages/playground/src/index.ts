// @sverka/playground — public API. Browser-safe.

// Pipeline model
export { Project, Pipeline, FunctionStep, Entry } from "./pipeline.js";
export type { Construct, Step } from "./pipeline.js";

// Runner
export { runPipeline } from "./runner.js";

// Types
export type {
  Finding,
  FindingSource,
  PlaygroundFinding,
  Severity,
  StepResult,
  PipelineResult,
} from "./types.js";

// Share links (Spec 53)
export {
  encodeShareLink,
  decodeShareLink,
  PlaygroundError,
  SHARE_PAYLOAD_WARN_BYTES,
} from "./share.js";
export type { ShareableRun, PlaygroundErrorCode } from "./share.js";

// Embed API (Spec 53)
export { mountRunner } from "./embed.js";
export type { MountRunnerOptions, MountedRunner } from "./embed.js";

// Engine plumbing shared by the app and embeds
export {
  DEFAULT_CODE,
  evaluateUserCode,
  runPipelineWithTimeout,
} from "./engine.js";

// Transpile playground source → sverka.config.ts (Spec 53)
export { toSverkaConfig } from "./transpile.js";
