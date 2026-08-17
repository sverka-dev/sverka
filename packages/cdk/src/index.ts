// Public exports for @sverka/cdk. Spec 01.

export { Project, Pipeline, Step, ShellStep, Entry } from "./constructs.js";
export type { PipelineProps, StepProps, ShellStepProps, EntryProps } from "./constructs.js";

export type {
  Trigger,
  Push,
  ChangeRequest,
  Manual,
  Schedule,
  TriggerFilter,
} from "./model.js";
export { push, changeRequest, manual, schedule } from "./model.js";
export type {
  Reference,
  StepRef,
  ContextRef,
  ContextNamespace,
  Expression,
} from "./model.js";
export type { OutputType, OutputDeclaration, InputType, Input } from "./model.js";
export type { Runtime } from "./model.js";
export type { MatrixValue, MatrixSpec } from "./model.js";
export type { StepStatus, StatusCondition, Condition } from "./model.js";

export { ConstructError, type ConstructErrorCode } from "./errors.js";
