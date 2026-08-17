// Model types shared between the construct tree and the Definition Graph.
// Spec 01 — §12, §13, §14.

// ---------------------------------------------------------------------------
// Triggers (§13)
// ---------------------------------------------------------------------------

export interface TriggerFilter {
  readonly branches?: readonly string[];
  readonly tags?: readonly string[];
  readonly paths?: readonly string[];
}

export interface Push {
  readonly kind: "push";
  readonly filter?: TriggerFilter;
}

export interface ChangeRequest {
  readonly kind: "changeRequest";
  readonly filter?: TriggerFilter;
}

export interface Manual {
  readonly kind: "manual";
  readonly filter?: TriggerFilter;
}

// F-05: Schedule trigger
export interface Schedule {
  readonly kind: "schedule";
  readonly cron: string;
  readonly timezone?: string;
}

export type Trigger = Push | ChangeRequest | Manual | Schedule;

export function push(filter?: TriggerFilter): Push {
  return { kind: "push", ...(filter ? { filter } : {}) };
}

export function changeRequest(filter?: TriggerFilter): ChangeRequest {
  return { kind: "changeRequest", ...(filter ? { filter } : {}) };
}

export function manual(filter?: TriggerFilter): Manual {
  return { kind: "manual", ...(filter ? { filter } : {}) };
}

// F-05: Schedule trigger helper
export function schedule(cron: string, timezone?: string): Schedule {
  return { kind: "schedule", cron, ...(timezone ? { timezone } : {}) };
}

// ---------------------------------------------------------------------------
// References (§11.1, §12.3)
// ---------------------------------------------------------------------------

export type OutputType = "string" | "number" | "boolean" | "artifact";

export interface StepRef {
  readonly kind: "step";
  readonly step: string;
  readonly output: string;
  readonly type: OutputType;
}

export type ContextNamespace =
  | "env"
  | "secrets"
  | "git"
  | "change"
  | "event"
  | "run"
  | "inputs"
  | "matrix";

export interface ContextRef {
  readonly kind: "context";
  readonly namespace: ContextNamespace;
  readonly field: string;
}

export type Reference = StepRef | ContextRef;

// ---------------------------------------------------------------------------
// Expressions (F-35) — symbolic expressions with context references
// ---------------------------------------------------------------------------

export interface Expression {
  readonly kind: "expression";
  readonly template: string;
  readonly refs: readonly Reference[];
}

// ---------------------------------------------------------------------------
// Outputs (§12.2)
// ---------------------------------------------------------------------------

export interface OutputDeclaration {
  readonly type: OutputType;
  readonly path?: string;
  readonly description?: string;
}

// ---------------------------------------------------------------------------
// Inputs (§12.1)
// ---------------------------------------------------------------------------

export type InputType = "string" | "number" | "boolean";

export interface Input {
  readonly type: InputType;
  readonly required?: boolean;
  readonly default?: string | number | boolean;
  readonly description?: string;
  readonly secret?: boolean;
}

// ---------------------------------------------------------------------------
// Runtime (§14.1)
// ---------------------------------------------------------------------------

export interface Runtime {
  readonly mode?: "host" | "container";
  readonly image?: string;
  readonly env?: Readonly<Record<string, string>>;
  readonly secrets?: readonly string[];
  readonly workingDir?: string;
  readonly shell?: string;
}

// ---------------------------------------------------------------------------
// Matrix expansion (F-15, F-16)
// ---------------------------------------------------------------------------

export type MatrixValue = string | number;

export interface MatrixSpec {
  readonly dimensions: Readonly<Record<string, readonly MatrixValue[]>>;
  readonly include?: readonly Readonly<Record<string, MatrixValue>>[];
  readonly exclude?: readonly Readonly<Record<string, MatrixValue>>[];
  readonly failFast?: boolean;
  readonly maxParallel?: number;
}

// ---------------------------------------------------------------------------
// Step conditions (F-11)
// ---------------------------------------------------------------------------

export type StepStatus = "success" | "failure" | "always" | "never";

export interface StatusCondition {
  readonly kind: "status";
  readonly status: StepStatus;
}

export type Condition = Reference | Expression | StatusCondition;
