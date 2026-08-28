// ValueStore — in-memory scalar output transfer between Steps.
// Spec 10 — §22.1 component 7.

import type { InputValue } from "@sverka/workflow";
import type { ValueStore } from "./types.js";

/** Create an in-memory ValueStore for scalar output transfer. */
export function createValueStore(): ValueStore {
  const store = new Map<string, Map<string, InputValue>>();

  return {
    set(stepId: string, outputName: string, value: InputValue): void {
      let stepOutputs = store.get(stepId);
      if (!stepOutputs) {
        stepOutputs = new Map();
        store.set(stepId, stepOutputs);
      }
      stepOutputs.set(outputName, value);
    },
    get(stepId: string, outputName: string): InputValue | undefined {
      return store.get(stepId)?.get(outputName);
    },
  };
}
