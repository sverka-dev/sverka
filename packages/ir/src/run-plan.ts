// Run Plan schema — the concrete execution graph consumed by the native engine.
// Spec 06 — §22.1, §16. Architecture spec §22.

import type { StepDefinition } from "@sverka/core";
import type { Trigger } from "@sverka/cdk";

export type InputValue = string | number | boolean | readonly string[];

export interface BoundEntry {
  readonly id: string;
  readonly trigger: Trigger;
}

export interface RunPlan {
  readonly apiVersion: "sverka.dev/v1run";
  readonly id: string;
  readonly graphId: string;
  readonly entry: BoundEntry;
  readonly inputs: Readonly<Record<string, InputValue>>;
  readonly steps: readonly StepDefinition[];
  readonly createdAt: string;
}
