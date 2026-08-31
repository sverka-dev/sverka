// agent tagged template — AI agent step builder.
// Spec 27 — §9.2 (SDK). Mirrors $ for shell, but creates an AgentStep.

import { AgentStep, Pipeline } from "@sverka/workflow";
import type { Reference, OutputDeclaration, AgentToolRef } from "@sverka/workflow";
import { SdkError } from "./errors.js";
import { isReference } from "./internal/is-reference.js";

export interface AgentStepBuilder {
  outputs(outputs: Readonly<Record<string, OutputDeclaration>>): AgentStepBuilder;
  inputs(inputs: readonly Reference[]): AgentStepBuilder;
  dependsOn(steps: readonly string[]): AgentStepBuilder;
  tools(...tools: readonly AgentToolRef[]): AgentStepBuilder;
  engine(engine: string): AgentStepBuilder;
  model(model: string): AgentStepBuilder;
  maxTokens(n: number): AgentStepBuilder;
  build(pipeline: Pipeline, id: string): AgentStep;
}

interface AgentBuilderState {
  prompt: string;
  engine: string;
  model?: string;
  tools: AgentToolRef[];
  collectedInputs: Reference[];
  outputs?: Readonly<Record<string, OutputDeclaration>>;
  inputs?: readonly Reference[];
  dependsOn?: readonly string[];
  maxTokens?: number;
}

function createAgentBuilder(state: AgentBuilderState): AgentStepBuilder {
  const builder: AgentStepBuilder = {
    outputs(outputs: Readonly<Record<string, OutputDeclaration>>): AgentStepBuilder {
      state.outputs = outputs;
      return builder;
    },
    inputs(inputs: readonly Reference[]): AgentStepBuilder {
      state.inputs = inputs;
      return builder;
    },
    dependsOn(steps: readonly string[]): AgentStepBuilder {
      state.dependsOn = steps;
      return builder;
    },
    tools(...tools: readonly AgentToolRef[]): AgentStepBuilder {
      state.tools = [...state.tools, ...tools];
      return builder;
    },
    engine(engine: string): AgentStepBuilder {
      state.engine = engine;
      return builder;
    },
    model(model: string): AgentStepBuilder {
      state.model = model;
      return builder;
    },
    maxTokens(n: number): AgentStepBuilder {
      state.maxTokens = n;
      return builder;
    },
    build(pipeline: Pipeline, id: string): AgentStep {
      const explicitInputs = state.inputs ? [...state.inputs] : [];
      const allInputs = [...explicitInputs, ...state.collectedInputs];
      return new AgentStep(pipeline, id, {
        engine: state.engine,
        prompt: state.prompt,
        ...(state.model !== undefined ? { model: state.model } : {}),
        ...(state.tools.length > 0 ? { tools: state.tools } : {}),
        ...(state.maxTokens !== undefined ? { maxTokens: state.maxTokens } : {}),
        ...(state.outputs ? { outputs: state.outputs } : {}),
        ...(allInputs.length > 0 ? { inputs: allInputs } : {}),
        ...(state.dependsOn ? { dependsOn: state.dependsOn } : {}),
      });
    },
  };
  return builder;
}

/**
 * Create an AI agent step builder from a tagged template.
 * `agent\`Build and test\`` creates a builder with `engine: "default"`.
 * References interpolated in the template are collected and added to the
 * step's inputs automatically (same as `$`).
 */
export function agent(
  strings: TemplateStringsArray,
  ...values: readonly (string | Reference)[]
): AgentStepBuilder {
  let prompt = "";
  const collectedInputs: Reference[] = [];

  for (let i = 0; i < strings.length; i++) {
    prompt += strings[i];
    if (i < values.length) {
      const v = values[i]!;
      if (typeof v === "string") {
        prompt += v;
      } else if (isReference(v)) {
        const ref = v;
        collectedInputs.push(ref);
        if (ref.kind === "step") {
          prompt += `\${${ref.step}.${ref.output}}`;
        } else {
          prompt += `\${${ref.namespace}.${ref.field}}`;
        }
      } else {
        throw new SdkError(
          `invalid interpolation value at position ${i}: expected string or Reference`,
          "INVALID_INTERPOLATION",
        );
      }
    }
  }

  return createAgentBuilder({ prompt, engine: "default", tools: [], collectedInputs });
}
