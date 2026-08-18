// decoratePipeline — creates a Pipeline construct from a decorated class.
// Spec 04 — §9.3–9.8.

import { Pipeline, ShellStep, Entry } from "@sverka/cdk";
import type { Project, Input, Trigger, Reference, ShellStepProps, Construct } from "@sverka/cdk";
import type { StepBuilder } from "@sverka/sdk";
import { getPipelineMetadata } from "./decorators.js";
import { DecoratorError } from "./errors.js";
import type { FieldMetadata, StepOptions } from "./types.js";

/** Register a construct as a child of its parent (side-effect constructor). */
function register<T extends Construct>(_construct: T): void {
  // Constructs add themselves to their parent in the constructor.
  // The return value is intentionally unused.
}

const FIELDS_KEY = Symbol.for("sverka:fields");

type MethodStepSpec =
  | { readonly kind: "builder"; readonly builder: StepBuilder }
  | { readonly kind: "command"; readonly command: string; readonly inputs: readonly Reference[] };

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

  // Instantiate the class to evaluate field initializers.
  let instance: object;
  try {
    instance = new PipelineClass() as object;
  } catch (error) {
    throw new DecoratorError(
      `failed to instantiate pipeline class '${PipelineClass.name}'`,
      "INVALID_FIELD",
      error,
    );
  }

  // Get field metadata.
  const fields = getFieldsFromMetadata(metadata);

  // Collect inputs from instance fields marked with @input.
  const inputs: Record<string, Input> = {};
  for (const [name, meta] of fields) {
    if (meta.kind === "input") {
      const value = (instance as Record<string, unknown>)[name];
      inputs[name] = validateInput(value, name);
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
        // Inputs are handled at the pipeline level.
        break;
    }
  }

  return pipeline;
}

function getFieldsFromMetadata(metadata: object): Map<string, FieldMetadata> {
  const obj = metadata as Record<symbol, unknown>;
  const fields = obj[FIELDS_KEY];
  if (!(fields instanceof Map)) {
    return new Map();
  }
  return fields as Map<string, FieldMetadata>;
}

const INPUT_TYPES = new Set(["string", "number", "boolean"]);

function validateInput(value: unknown, name: string): Input {
  if (value === null || typeof value !== "object") {
    throw new DecoratorError(`input field '${name}' must be an object`, "INVALID_FIELD");
  }
  const obj = value as Record<string, unknown>;
  if (typeof obj.type !== "string" || !INPUT_TYPES.has(obj.type)) {
    throw new DecoratorError(`input field '${name}' has invalid type: ${String(obj.type)}`, "INVALID_FIELD");
  }
  validateInputBoolean(obj, "required", name);
  validateInputBoolean(obj, "secret", name);
  validateInputString(obj, "description", name);
  validateInputDefault(obj, name);
  return value as Input;
}

function validateInputBoolean(obj: Record<string, unknown>, field: string, name: string): void {
  if (obj[field] !== undefined && typeof obj[field] !== "boolean") {
    throw new DecoratorError(`input field '${name}' has invalid ${field} flag`, "INVALID_FIELD");
  }
}

function validateInputString(obj: Record<string, unknown>, field: string, name: string): void {
  if (obj[field] !== undefined && typeof obj[field] !== "string") {
    throw new DecoratorError(`input field '${name}' has invalid ${field}`, "INVALID_FIELD");
  }
}

function validateInputDefault(obj: Record<string, unknown>, name: string): void {
  if (obj.default !== undefined && !INPUT_TYPES.has(typeof obj.default)) {
    throw new DecoratorError(`input field '${name}' has invalid default value`, "INVALID_FIELD");
  }
}

function createStepFromField(
  pipeline: Pipeline,
  name: string,
  instance: object,
  options?: StepOptions,
): void {
  const value = (instance as Record<string, unknown>)[name];
  const stepId = options?.id ?? name;

  if (typeof value === "string") {
    register(new ShellStep(pipeline, stepId, stepProps(value, options)));
    return;
  }

  if (isStepBuilder(value)) {
    applyOptionsToBuilder(value as StepBuilder, options).build(pipeline, stepId);
    return;
  }

  if (typeof value === "function") {
    createStepFromMethod(pipeline, stepId, value as (this: unknown, ...args: unknown[]) => unknown, options);
    return;
  }

  if (value === undefined) {
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

function createStepFromMethod(
  pipeline: Pipeline,
  stepId: string,
  method: (this: unknown, ...args: unknown[]) => unknown,
  options?: StepOptions,
): void {
  const spec = evaluateMethodStep(method, stepId, options);
  if (spec.kind === "builder") {
    applyOptionsToBuilder(spec.builder, options).build(pipeline, stepId);
    return;
  }
  const props: ShellStepProps = {
    ...stepProps(spec.command, options),
    ...(spec.inputs.length > 0 ? { inputs: spec.inputs } : {}),
  };
  register(new ShellStep(pipeline, stepId, props));
}

function stepProps(command: string, options?: StepOptions): ShellStepProps {
  return {
    command,
    ...(options?.runtime ? { runtime: options.runtime } : {}),
    ...(options?.outputs ? { outputs: options.outputs } : {}),
    ...(options?.dependsOn ? { dependsOn: options.dependsOn } : {}),
    ...(options?.timeout !== undefined ? { timeout: options.timeout } : {}),
    ...(options?.matrix !== undefined ? { matrix: options.matrix } : {}),
    ...(options?.interruptible !== undefined ? { interruptible: options.interruptible } : {}),
  };
}

function applyOptionsToBuilder(builder: StepBuilder, options?: StepOptions): StepBuilder {
  let b = builder;
  if (options?.runtime) b = b.runtime(options.runtime);
  if (options?.timeout !== undefined) b = b.timeout(options.timeout);
  if (options?.outputs) b = b.outputs(options.outputs);
  if (options?.dependsOn) b = b.dependsOn(options.dependsOn);
  if (options?.matrix !== undefined) b = b.matrix(options.matrix);
  if (options?.interruptible !== undefined) b = b.interruptible(options.interruptible);
  return b;
}

function evaluateMethodStep(
  method: (this: unknown, ...args: unknown[]) => unknown,
  name: string,
  options?: StepOptions,
): MethodStepSpec {
  const commands: string[] = [];
  const collectedInputs: Reference[] = [];

  const planningContext = {
    sh(strings: TemplateStringsArray, ...values: readonly unknown[]): void {
      let command = "";
      for (let i = 0; i < strings.length; i++) {
        command += strings[i];
        if (i < values.length) {
          const v = values[i]!;
          if (typeof v === "string") {
            command += v;
          } else if (typeof v === "number" || typeof v === "boolean") {
            command += String(v);
          } else if (isReference(v)) {
            collectedInputs.push(v);
            const ref = v as Reference;
            if (ref.kind === "step") {
              command += `\${${ref.step}.${ref.output}}`;
            } else {
              command += `\${${ref.namespace}.${ref.field}}`;
            }
          } else {
            throw new DecoratorError(
              `step method '${name}' has invalid interpolation of type ${typeof v}`,
              "INVALID_FIELD",
            );
          }
        }
      }
      const trimmed = command.trim();
      if (trimmed) commands.push(trimmed);
    },
  };

  let result: unknown;
  try {
    result = method.call(planningContext);
  } catch (error) {
    throw new DecoratorError(
      `step method '${name}' threw an error`,
      "INVALID_FIELD",
      error,
    );
  }

  if (isStepBuilder(result)) {
    return { kind: "builder", builder: result as StepBuilder };
  }

  if (typeof result === "string") {
    return { kind: "command", command: result, inputs: [] };
  }

  if (commands.length === 0) {
    throw new DecoratorError(
      `step method '${name}' produced no operations`,
      "MISSING_INITIALIZER",
    );
  }

  return { kind: "command", command: commands.join(" && "), inputs: collectedInputs };
}

function isStepBuilder(value: unknown): boolean {
  return (
    value !== null &&
    typeof value === "object" &&
    "build" in value &&
    typeof (value as { build: unknown }).build === "function"
  );
}

function isReference(value: unknown): value is Reference {
  if (typeof value !== "object" || value === null || !("kind" in value)) {
    return false;
  }
  const kind = (value as { kind: unknown }).kind;
  if (kind === "step") {
    const ref = value as Record<string, unknown>;
    return (
      typeof ref.step === "string" &&
      typeof ref.output === "string" &&
      typeof ref.type === "string"
    );
  }
  if (kind === "context") {
    const ref = value as Record<string, unknown>;
    return typeof ref.namespace === "string" && typeof ref.field === "string";
  }
  return false;
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
  void new Entry(pipeline, name, { trigger, roots });
}
