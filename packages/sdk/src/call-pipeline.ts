// callPipeline() builder — invokes a callee pipeline as a step (F-31).
// Returns a builder that creates a PipelineCallStep when .build() is called.

import { PipelineCallStep, Pipeline } from "@sverka/workflow";
import type { Reference, InputLiteral, Runtime, OutputDeclaration } from "@sverka/workflow";

export interface CallPipelineBuilder {
  outputs(outputs: Readonly<Record<string, OutputDeclaration>>): CallPipelineBuilder;
  dependsOn(steps: readonly string[]): CallPipelineBuilder;
  runtime(runtime: Runtime): CallPipelineBuilder;
  timeout(ms: number): CallPipelineBuilder;
  condition(ref: Reference): CallPipelineBuilder;
  interruptible(value: boolean): CallPipelineBuilder;
  build(pipeline: Pipeline, id: string): PipelineCallStep;
}

interface CallBuilderState {
  callee: string;
  callInputs: Record<string, Reference | InputLiteral>;
  outputs?: Readonly<Record<string, OutputDeclaration>>;
  dependsOn?: readonly string[];
  runtime?: Runtime;
  timeout?: number;
  condition?: Reference;
  interruptible?: boolean;
}

function createCallBuilder(state: CallBuilderState): CallPipelineBuilder {
  const builder: CallPipelineBuilder = {
    outputs(outputs: Readonly<Record<string, OutputDeclaration>>): CallPipelineBuilder {
      state.outputs = outputs;
      return builder;
    },
    dependsOn(steps: readonly string[]): CallPipelineBuilder {
      state.dependsOn = steps;
      return builder;
    },
    runtime(runtime: Runtime): CallPipelineBuilder {
      state.runtime = runtime;
      return builder;
    },
    timeout(ms: number): CallPipelineBuilder {
      state.timeout = ms;
      return builder;
    },
    condition(ref: Reference): CallPipelineBuilder {
      state.condition = ref;
      return builder;
    },
    interruptible(value: boolean): CallPipelineBuilder {
      state.interruptible = value;
      return builder;
    },
    build(pipeline: Pipeline, id: string): PipelineCallStep {
      return new PipelineCallStep(pipeline, id, {
        callee: state.callee,
        callInputs: state.callInputs,
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
 * Create a pipeline-call step builder.
 * @param callee The callee pipeline id (within the same Project).
 * @param callInputs Bound inputs for the callee pipeline.
 */
export function callPipeline(
  callee: string,
  callInputs?: Readonly<Record<string, Reference | InputLiteral>>,
): CallPipelineBuilder {
  return createCallBuilder({
    callee,
    callInputs: callInputs ? { ...callInputs } : {},
  });
}
