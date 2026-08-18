// sh tagged template — shell command step builder.
// Spec 03 — §9.2, §15. Architecture spec §9.2.

import {
  ShellStep,
  type Pipeline,
  type Reference,
  type Runtime,
  type OutputDeclaration,
  type MatrixSpec,
  type Condition,
  type ContinueOnError,
  type RetryPolicy,
} from "@sverka/cdk";
import { SdkError } from "./errors.js";
import { isReference } from "./internal/is-reference.js";

export interface StepBuilder {
  outputs(outputs: Readonly<Record<string, OutputDeclaration>>): StepBuilder;
  inputs(inputs: readonly Reference[]): StepBuilder;
  dependsOn(steps: readonly string[]): StepBuilder;
  runtime(runtime: Runtime): StepBuilder;
  timeout(ms: number): StepBuilder;
  condition(cond: Condition): StepBuilder;
  matrix(spec: MatrixSpec): StepBuilder;
  beforeScript(commands: readonly string[]): StepBuilder;
  afterScript(commands: readonly string[]): StepBuilder;
  continueOnError(value: ContinueOnError): StepBuilder;
  retry(policy: RetryPolicy): StepBuilder;
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
  condition?: Condition;
  matrix?: MatrixSpec;
  beforeScript?: readonly string[];
  afterScript?: readonly string[];
  continueOnError?: ContinueOnError;
  retry?: RetryPolicy;
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
    condition(cond: Condition): StepBuilder {
      state.condition = cond;
      return builder;
    },
    matrix(spec: MatrixSpec): StepBuilder {
      state.matrix = spec;
      return builder;
    },
    beforeScript(commands: readonly string[]): StepBuilder {
      state.beforeScript = commands;
      return builder;
    },
    afterScript(commands: readonly string[]): StepBuilder {
      state.afterScript = commands;
      return builder;
    },
    continueOnError(value: ContinueOnError): StepBuilder {
      state.continueOnError = value;
      return builder;
    },
    retry(policy: RetryPolicy): StepBuilder {
      state.retry = policy;
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
        ...(state.beforeScript ? { beforeScript: state.beforeScript } : {}),
        ...(state.afterScript ? { afterScript: state.afterScript } : {}),
        ...(state.continueOnError !== undefined ? { continueOnError: state.continueOnError } : {}),
        ...(state.retry !== undefined ? { retry: state.retry } : {}),
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
