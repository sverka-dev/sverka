// sh tagged template — shell command step builder.
// Spec 03 — §9.2, §15. Architecture spec §9.2.

import { ShellStep, type Pipeline, type Reference, type Runtime, type OutputDeclaration } from "@sverka/constructs";
import { SdkError } from "./errors.js";

export interface StepBuilder {
  outputs(outputs: Readonly<Record<string, OutputDeclaration>>): StepBuilder;
  inputs(inputs: readonly Reference[]): StepBuilder;
  dependsOn(steps: readonly string[]): StepBuilder;
  runtime(runtime: Runtime): StepBuilder;
  timeout(ms: number): StepBuilder;
  build(pipeline: Pipeline, id: string): ShellStep;
}

interface StepBuilderState {
  command: string;
  collectedInputs: Reference[];
  outputs?: Readonly<Record<string, OutputDeclaration>>;
  inputs?: readonly Reference[];
  dependsOn?: readonly string[];
  runtime?: Runtime;
  timeout?: number;
}

function createBuilder(state: StepBuilderState): StepBuilder {
  return {
    outputs(outputs: Readonly<Record<string, OutputDeclaration>>): StepBuilder {
      return createBuilder({ ...state, outputs });
    },
    inputs(inputs: readonly Reference[]): StepBuilder {
      return createBuilder({ ...state, inputs });
    },
    dependsOn(steps: readonly string[]): StepBuilder {
      return createBuilder({ ...state, dependsOn: steps });
    },
    runtime(runtime: Runtime): StepBuilder {
      return createBuilder({ ...state, runtime });
    },
    timeout(ms: number): StepBuilder {
      return createBuilder({ ...state, timeout: ms });
    },
    build(pipeline: Pipeline, id: string): ShellStep {
      // Merge collected inputs (from interpolation) with explicit inputs.
      const explicitInputs = state.inputs ? [...state.inputs] : [];
      const allInputs = [...explicitInputs, ...state.collectedInputs];
      return new ShellStep(pipeline, id, {
        command: state.command,
        ...(state.outputs ? { outputs: state.outputs } : {}),
        ...(allInputs.length > 0 ? { inputs: allInputs } : {}),
        ...(state.dependsOn ? { dependsOn: state.dependsOn } : {}),
        ...(state.runtime ? { runtime: state.runtime } : {}),
        ...(state.timeout !== undefined ? { timeout: state.timeout } : {}),
      });
    },
  };
}

/**
 * Create a shell command step builder from a tagged template.
 * References interpolated in the template are collected and added to the
 * step's inputs automatically.
 */
export function sh(
  strings: TemplateStringsArray,
  ...values: readonly (string | Reference)[]
): StepBuilder {
  let command = "";
  const collectedInputs: Reference[] = [];

  for (let i = 0; i < strings.length; i++) {
    command += strings[i];
    if (i < values.length) {
      const v = values[i]!;
      if (typeof v === "string") {
        command += v;
      } else if (typeof v === "object" && v !== null && "kind" in v) {
        // It's a Reference — add to inputs and interpolate a placeholder.
        const ref = v as Reference;
        collectedInputs.push(ref);
        if (ref.kind === "step") {
          command += `\${${ref.step}.${ref.output}}`;
        } else {
          command += `\${${ref.namespace}.${ref.field}}`;
        }
      } else {
        throw new SdkError(
          `invalid interpolation value at position ${i}: expected string or Reference`,
          "INVALID_INTERPOLATION",
        );
      }
    }
  }

  return createBuilder({ command, collectedInputs });
}
