// Decorator types. Spec 04 — §9.3–9.8.

import type { Runtime, OutputDeclaration, Trigger, MatrixSpec } from "@sverka/cdk";

export interface StepOptions {
  readonly id?: string;
  readonly runtime?: Runtime;
  readonly timeout?: number;
  readonly outputs?: Readonly<Record<string, OutputDeclaration>>;
  readonly dependsOn?: readonly string[];
  readonly matrix?: MatrixSpec;
  readonly interruptible?: boolean;
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
  $(strings: TemplateStringsArray, ...values: readonly unknown[]): void;
}
