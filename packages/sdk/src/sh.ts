// sh tagged template — shell command step builder.
// Spec 03 — §9.2, §15. Architecture spec §9.2.

import {
  ShellStep,
  type Pipeline,
  type Reference,
  type Runtime,
  type OutputDeclaration,
  type StepRef,
  type ContextRef,
  type MatrixSpec,
} from "@sverka/cdk";
import { SdkError } from "./errors.js";

export interface StepBuilder {
  outputs(outputs: Readonly<Record<string, OutputDeclaration>>): StepBuilder;
  inputs(inputs: readonly Reference[]): StepBuilder;
  dependsOn(steps: readonly string[]): StepBuilder;
  runtime(runtime: Runtime): StepBuilder;
  timeout(ms: number): StepBuilder;
  condition(ref: Reference): StepBuilder;
  matrix(spec: MatrixSpec): StepBuilder;
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
  condition?: Reference;
  matrix?: MatrixSpec;
}

function createBuilder(state: StepBuilderState): StepBuilder {
  const builder: StepBuilder = {
    outputs(outputs: Readonly<Record<string, OutputDeclaration>>): StepBuilder {
      state.outputs = outputs;
      return builder;
    },
    inputs(inputs: readonly Reference[]): StepBuilder {
      state.inputs = inputs;
      return builder;
    },
    dependsOn(steps: readonly string[]): StepBuilder {
      state.dependsOn = steps;
      return builder;
    },
    runtime(runtime: Runtime): StepBuilder {
      state.runtime = runtime;
      return builder;
    },
    timeout(ms: number): StepBuilder {
      state.timeout = ms;
      return builder;
    },
    condition(ref: Reference): StepBuilder {
      state.condition = ref;
      return builder;
    },
    matrix(spec: MatrixSpec): StepBuilder {
      state.matrix = spec;
      return builder;
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
        ...(state.condition !== undefined ? { condition: state.condition } : {}),
        ...(state.matrix !== undefined ? { matrix: state.matrix } : {}),
      });
    },
  };
  return builder;
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
      } else if (isReference(v)) {
        // It's a Reference — add to inputs and interpolate a placeholder.
        const ref = v;
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

function isReference(value: unknown): value is Reference {
  if (typeof value !== "object" || value === null || !("kind" in value)) {
    return false;
  }
  const ref = value as { kind: string };
  if (ref.kind === "step") {
    const s = value as Partial<StepRef>;
    return typeof s.step === "string" && typeof s.output === "string" && typeof s.type === "string";
  }
  if (ref.kind === "context") {
    const c = value as Partial<ContextRef>;
    return typeof c.namespace === "string" && typeof c.field === "string";
  }
  return false;
}
