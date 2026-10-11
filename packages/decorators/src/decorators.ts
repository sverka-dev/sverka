// TC39 standard decorators. Spec 04 — §9.3–9.8.
// Uses standard ECMAScript decorators (TypeScript 5.0+, no experimentalDecorators).
//
// context.metadata ?? {} is a per-class object shared across all decorators.
// @pipeline stores it on the class constructor so decoratePipeline can
// retrieve it later (Symbol.metadata is not yet widely implemented).

import type { Trigger, Input } from "@sverka/constructs";
import type { StepOptions, FieldMetadata, FieldKind } from "./types.js";
import { DecoratorError } from "./errors.js";

const PIPELINE_SYMBOL = Symbol.for("sverka:pipeline:metadata");
const FIELDS_KEY = "sverka:fields";
const INPUTS_KEY = "sverka:inputs";

/**
 * @pipeline — class decorator that marks a class as a Sverka pipeline.
 * Stores context.metadata ?? {} on the class constructor for later retrieval.
 */
export function pipeline<This extends new (...args: never[]) => unknown>(
  target: This,
  context: ClassDecoratorContext<This>,
): This {
  (target as unknown as Record<symbol, object>)[PIPELINE_SYMBOL] = context.metadata!;
  return target;
}

/**
 * Get the metadata object from a pipeline class.
 * @internal
 */
export function getPipelineMetadata(cls: new (...args: never[]) => unknown): object {
  const meta = (cls as unknown as Record<symbol, unknown>)[PIPELINE_SYMBOL];
  if (meta === undefined || meta === null || typeof meta !== "object") {
    throw new DecoratorError(
      `class ${cls.name} is not a decorated pipeline (missing @pipeline)`,
      "NOT_A_PIPELINE",
    );
  }
  return meta;
}

/**
 * @step — field decorator. Supports both bare and factory forms:
 *
 *   @step                    — bare form, no options
 *   @step({ timeout: 60000 }) — factory form with options
 *
 * TC39 standard decorators call the decorator function directly for the
 * bare form (`step(value, context)` — 2 args) and as a factory for the
 * parenthesized form (`step(options)` — 1 arg, returns a decorator).
 * We overload on argument count.
 */
export function step(
  valueOrOptions: unknown,
  context?: ClassFieldDecoratorContext,
): void | ((value: unknown, ctx: ClassFieldDecoratorContext) => void) {
  // Factory form: @step({ timeout: 60000 })
  if (context === undefined) {
    const options = valueOrOptions as StepOptions;
    validateStepOptions(options);
    return function (_value: unknown, ctx: ClassFieldDecoratorContext): void {
      registerFieldOnMetadata(ctx.metadata ?? {}, String(ctx.name), "step", options);
    };
  }
  // Bare form: @step
  registerFieldOnMetadata(context.metadata ?? {}, String(context.name), "step");
}

/**
 * Factory form of @step for use with options: `@step({ timeout: 60000 })`.
 * Kept as a named export for explicit usage; equivalent to calling
 * `step(options)` directly.
 */
export function stepWithOptions(
  options: StepOptions,
): (value: unknown, context: ClassFieldDecoratorContext) => void {
  validateStepOptions(options);
  return function (_value: unknown, ctx: ClassFieldDecoratorContext): void {
    registerFieldOnMetadata(ctx.metadata ?? {}, String(ctx.name), "step", options);
  };
}

/**
 * @entry(trigger) — field decorator for entry definitions.
 */
export function entry(
  trigger: Trigger,
): (value: unknown, context: ClassFieldDecoratorContext) => void {
  return function (_value: unknown, context: ClassFieldDecoratorContext): void {
    registerFieldOnMetadata(context.metadata ?? {}, String(context.name), "entry", undefined, trigger);
  };
}

/**
 * @input — field decorator for pipeline inputs.
 * The field initializer provides the Input value (read from instance
 * during decoratePipeline, since TC39 field decorators receive undefined
 * as the value at class definition time).
 */
export function input(
  _value: unknown,
  context: ClassFieldDecoratorContext,
): void {
  registerFieldOnMetadata(context.metadata ?? {}, String(context.name), "input");
}

/**
 * @output — field decorator for pipeline outputs.
 */
export function output(
  value: unknown,
  context: ClassFieldDecoratorContext,
): void {
  registerFieldOnMetadata(context.metadata ?? {}, String(context.name), "output");
}

// --- Internal helpers ---

function getFieldsMap(metadata: object): Map<string, FieldMetadata> {
  const obj = metadata as Record<string, unknown>;
  let fields = obj[FIELDS_KEY];
  if (!(fields instanceof Map)) {
    fields = new Map();
    obj[FIELDS_KEY] = fields;
  }
  return fields as Map<string, FieldMetadata>;
}

function registerFieldOnMetadata(
  metadata: object,
  name: string,
  kind: FieldKind,
  options?: StepOptions,
  trigger?: Trigger,
): void {
  const fields = getFieldsMap(metadata);
  if (fields.has(name)) {
    throw new DecoratorError(
      `duplicate field decorator: ${name}`,
      "DUPLICATE_FIELD",
    );
  }
  const meta: FieldMetadata = {
    kind,
    ...(options ? { options } : {}),
    ...(trigger ? { trigger } : {}),
  };
  fields.set(name, meta);
}

function registerInputOnMetadata(metadata: object, name: string, value: Input): void {
  const obj = metadata as Record<string, unknown>;
  let inputs = obj[INPUTS_KEY];
  if (!(inputs instanceof Map)) {
    inputs = new Map();
    obj[INPUTS_KEY] = inputs;
  }
  (inputs as Map<string, Input>).set(name, value);
}

/**
 * Get all inputs from a metadata object.
 * @internal
 */
export function getInputsFromMetadata(metadata: object): Record<string, Input> {
  const obj = metadata as Record<string, unknown>;
  const inputs = obj[INPUTS_KEY];
  if (!(inputs instanceof Map)) return {};
  const result: Record<string, Input> = {};
  for (const [name, value] of (inputs as Map<string, Input>)) {
    result[name] = value;
  }
  return result;
}

function validateStepOptions(options: StepOptions): void {
  if (typeof options !== "object" || options === null) {
    throw new DecoratorError("step options must be an object", "INVALID_OPTIONS");
  }
  if (options.timeout !== undefined && typeof options.timeout !== "number") {
    throw new DecoratorError("step timeout must be a number", "INVALID_OPTIONS");
  }
  if (options.dependsOn !== undefined && !Array.isArray(options.dependsOn)) {
    throw new DecoratorError("step dependsOn must be an array", "INVALID_OPTIONS");
  }
}
