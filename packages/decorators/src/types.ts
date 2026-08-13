// Decorator types. Spec 04 — §9.3–9.8.

import type { Runtime, OutputDeclaration, Trigger } from "@sverka/constructs";

export interface StepOptions {
  readonly runtime?: Runtime;
  readonly timeout?: number;
  readonly outputs?: Readonly<Record<string, OutputDeclaration>>;
  readonly dependsOn?: readonly string[];
}

export type EntryTarget = readonly string[];

export type FieldKind = "step" | "entry" | "input";

export interface FieldMetadata {
  readonly kind: FieldKind;
  readonly options?: StepOptions;
  readonly trigger?: Trigger;
}

/**
 * Planning context passed as `this` to method-based `@step` planning methods.
 */
export interface PlanningContext {
  sh(strings: TemplateStringsArray, ...values: readonly unknown[]): void;
}
