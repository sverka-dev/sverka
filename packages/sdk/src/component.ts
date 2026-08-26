// component() builder — invokes a versioned component as a step (F-32).
// Returns a builder that creates a ComponentStep when .build() is called.

import {
  ComponentStep,
  type Pipeline,
  type Reference,
  type InputLiteral,
  type ComponentRef,
  type Runtime,
  type OutputDeclaration,
} from "@sverka/cdk";

export interface ComponentBuilder {
  outputs(outputs: Readonly<Record<string, OutputDeclaration>>): ComponentBuilder;
  dependsOn(steps: readonly string[]): ComponentBuilder;
  runtime(runtime: Runtime): ComponentBuilder;
  timeout(ms: number): ComponentBuilder;
  condition(ref: Reference): ComponentBuilder;
  interruptible(value: boolean): ComponentBuilder;
  build(pipeline: Pipeline, id: string): ComponentStep;
}

interface ComponentBuilderState {
  component: ComponentRef;
  outputs?: Readonly<Record<string, OutputDeclaration>>;
  dependsOn?: readonly string[];
  runtime?: Runtime;
  timeout?: number;
  condition?: Reference;
  interruptible?: boolean;
}

function createComponentBuilder(state: ComponentBuilderState): ComponentBuilder {
  const builder: ComponentBuilder = {
    outputs(outputs: Readonly<Record<string, OutputDeclaration>>): ComponentBuilder {
      state.outputs = outputs;
      return builder;
    },
    dependsOn(steps: readonly string[]): ComponentBuilder {
      state.dependsOn = steps;
      return builder;
    },
    runtime(runtime: Runtime): ComponentBuilder {
      state.runtime = runtime;
      return builder;
    },
    timeout(ms: number): ComponentBuilder {
      state.timeout = ms;
      return builder;
    },
    condition(ref: Reference): ComponentBuilder {
      state.condition = ref;
      return builder;
    },
    interruptible(value: boolean): ComponentBuilder {
      state.interruptible = value;
      return builder;
    },
    build(pipeline: Pipeline, id: string): ComponentStep {
      return new ComponentStep(pipeline, id, {
        component: state.component,
        ...(state.outputs ? { outputs: state.outputs } : {}),
        ...(state.dependsOn ? { dependsOn: state.dependsOn } : {}),
        ...(state.runtime ? { runtime: state.runtime } : {}),
        ...(state.timeout !== undefined ? { timeout: state.timeout } : {}),
        ...(state.condition !== undefined ? { condition: state.condition } : {}),
        ...(state.interruptible !== undefined ? { interruptible: state.interruptible } : {}),
      });
    },
  };
  return builder;
}

/**
 * Create a component step builder.
 * @param name The component name (e.g. "deploy").
 * @param version The component version (e.g. "1.0.0").
 * @param inputs Bound inputs for the component.
 */
export function component(
  name: string,
  version: string,
  inputs?: Readonly<Record<string, Reference | InputLiteral>>,
): ComponentBuilder {
  return createComponentBuilder({
    component: {
      name,
      version,
      inputs: inputs ? { ...inputs } : {},
    },
  });
}
