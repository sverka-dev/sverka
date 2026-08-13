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

export type Trigger = Push | ChangeRequest | Manual;

export function push(filter?: TriggerFilter): Push {
  return { kind: "push", ...(filter ? { filter } : {}) };
}

export function changeRequest(filter?: TriggerFilter): ChangeRequest {
  return { kind: "changeRequest", ...(filter ? { filter } : {}) };
}

export function manual(filter?: TriggerFilter): Manual {
  return { kind: "manual", ...(filter ? { filter } : {}) };
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
  | "inputs";

export interface ContextRef {
  readonly kind: "context";
  readonly namespace: ContextNamespace;
  readonly field: string;
}

export type Reference = StepRef | ContextRef;

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
}
