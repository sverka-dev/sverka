// decoratePipeline — creates a Pipeline construct from a decorated class.
// Spec 04 — §9.3–9.8.

import { Project, Pipeline, ShellStep, Entry } from "@sverka/constructs";
import type { Input, Trigger } from "@sverka/constructs";
import type { StepBuilder } from "@sverka/sdk";
import { getPipelineMetadata } from "./decorators.js";
import { DecoratorError } from "./errors.js";
import type { FieldMetadata, StepOptions } from "./types.js";

const FIELDS_KEY = "sverka:fields";

/**
 * Create a Pipeline construct from a decorated pipeline class.
 *
 * Instantiates the class, reads field metadata, and creates ShellStep
 * and Entry constructs for each decorated field.
 *
 * @param PipelineClass The decorated pipeline class
 * @param project The Project construct to create the pipeline under
 * @param id The pipeline ID
 * @returns The created Pipeline construct
 */
export function decoratePipeline(
  PipelineClass: new (...args: never[]) => unknown,
  project: Project,
  id: string,
): Pipeline {
  // Get the metadata object from the class.
  const metadata = getPipelineMetadata(PipelineClass);

  // Get field metadata.
  const fields = getFieldsFromMetadata(metadata);

  // Instantiate the class to evaluate field initializers.
  const instance = new PipelineClass() as object;

  // Collect inputs from instance fields marked with @input.
  const inputs: Record<string, Input> = {};
  for (const [name, meta] of fields) {
    if (meta.kind === "input") {
      const value = (instance as Record<string, unknown>)[name];
      if (value !== undefined && typeof value === "object" && value !== null && "type" in value) {
        inputs[name] = value as Input;
      }
    }
  }

  // Create the Pipeline construct with inputs.
  const pipeline = new Pipeline(project, id, {
    ...(Object.keys(inputs).length > 0 ? { inputs } : {}),
  });

  // Iterate fields in insertion order (source order).
  for (const [name, meta] of fields) {
    switch (meta.kind) {
      case "step":
        createStepFromField(pipeline, name, instance, meta.options);
        break;
      case "entry":
        createEntryFromField(pipeline, name, instance, meta.trigger);
        break;
      case "input":
      case "output":
        // Inputs and outputs are handled at the pipeline level.
        // No construct to create for individual input/output fields.
        break;
    }
  }

  return pipeline;
}

function getFieldsFromMetadata(metadata: object): Map<string, FieldMetadata> {
  const obj = metadata as Record<string, unknown>;
  const fields = obj[FIELDS_KEY];
  if (!(fields instanceof Map)) {
    return new Map();
  }
  return fields as Map<string, FieldMetadata>;
}

function createStepFromField(
  pipeline: Pipeline,
  name: string,
  instance: object,
  options?: StepOptions,
): void {
  const value = (instance as Record<string, unknown>)[name];

  if (typeof value === "string") {
    // String shorthand — leaf step with shell command.
    new ShellStep(pipeline, name, {
      command: value,
      ...(options?.runtime ? { runtime: options.runtime } : {}),
      ...(options?.outputs ? { outputs: options.outputs } : {}),
      ...(options?.dependsOn ? { dependsOn: options.dependsOn } : {}),
      ...(options?.timeout !== undefined ? { timeout: options.timeout } : {}),
    });
    return;
  }

  if (value !== null && typeof value === "object" && "build" in value && typeof (value as { build: unknown }).build === "function") {
    // StepBuilder from sh`...` — use its build method.
    const builder = value as StepBuilder;
    builder.build(pipeline, name);
    return;
  }

  if (value === undefined) {
    // Could be a method-based step — check if the method exists.
    const method = (instance as Record<string, unknown>)[name];
    if (typeof method === "function") {
      // Evaluate the method in a planning context.
      // For v0, we collect sh operations by calling the method.
      // The method uses sh`...` which returns StepBuilder objects.
      // We join all commands into a single shell step.
      const commands: string[] = [];
      const planningContext = createPlanningContext(commands);
      method.call(planningContext);
      if (commands.length === 0) {
        throw new DecoratorError(
          `step method '${name}' produced no operations`,
          "MISSING_INITIALIZER",
        );
      }
      new ShellStep(pipeline, name, {
        command: commands.join(" && "),
        ...(options?.runtime ? { runtime: options.runtime } : {}),
        ...(options?.outputs ? { outputs: options.outputs } : {}),
        ...(options?.dependsOn ? { dependsOn: options.dependsOn } : {}),
        ...(options?.timeout !== undefined ? { timeout: options.timeout } : {}),
      });
      return;
    }
    throw new DecoratorError(
      `step field '${name}' has no initializer`,
      "MISSING_INITIALIZER",
    );
  }

  throw new DecoratorError(
    `step field '${name}' has invalid value type: ${typeof value}`,
    "INVALID_FIELD",
  );
}

function createEntryFromField(
  pipeline: Pipeline,
  name: string,
  instance: object,
  trigger: Trigger | undefined,
): void {
  const value = (instance as Record<string, unknown>)[name];
  if (!Array.isArray(value)) {
    throw new DecoratorError(
      `entry field '${name}' must be an array of step IDs`,
      "INVALID_FIELD",
    );
  }
  const roots = value as readonly string[];
  if (trigger === undefined) {
    throw new DecoratorError(
      `entry field '${name}' missing trigger`,
      "INVALID_FIELD",
    );
  }
  new Entry(pipeline, name, { trigger, roots });
}

/**
 * Create a planning context for method-based steps.
 * The context captures sh operations by intercepting the sh function.
 */
function createPlanningContext(commands: string[]): object {
  return {
    sh(strings: TemplateStringsArray, ...values: readonly (string | unknown)[]): void {
      let command = "";
      for (let i = 0; i < strings.length; i++) {
        command += strings[i];
        if (i < values.length) {
          const v = values[i];
          command += typeof v === "string" ? v : "";
        }
      }
      commands.push(command.trim());
    },
  };
}
