// TC39 standard decorators. Spec 04 — §9.3–9.8.
// Uses standard ECMAScript decorators (TypeScript 5.0+, no experimentalDecorators).

import type { Trigger } from "@sverka/constructs";
import type { StepOptions, FieldMetadata, FieldKind, PlanningContext } from "./types.js";
import { DecoratorError } from "./errors.js";

const PIPELINE_SYMBOL = Symbol.for("sverka:pipeline:metadata");
const FIELDS_KEY = Symbol.for("sverka:fields");

type DecoratorContext = ClassFieldDecoratorContext | ClassMethodDecoratorContext;

/**
 * Function returned by `step(options)` / `stepWithOptions(options)`.
 * It is overloaded so it can be applied to both field and method declarations.
 */
export interface StepDecorator {
  <This, Value>(
    _value: undefined,
    context: ClassFieldDecoratorContext<This, Value>,
  ): void | ((this: This, value: Value) => Value);
  <This, Args extends readonly unknown[], Return>(
    value: (this: This, ...args: Args) => Return,
    context: ClassMethodDecoratorContext<This, (this: This, ...args: Args) => Return>,
  ): (this: This, ...args: Args) => Return;
}

/**
 * @pipeline — class decorator that marks a class as a Sverka pipeline.
 * Stores a shared metadata object on the class constructor for later retrieval.
 */
export function pipeline<This extends new (...args: never[]) => unknown>(
  target: This,
  context: ClassDecoratorContext<This>,
): This {
  const meta = context.metadata ?? {};
  (target as unknown as Record<symbol, object>)[PIPELINE_SYMBOL] = meta;
  return target;
}

/**
 * Get the metadata object from a pipeline class.
 * @internal
 */
export function getPipelineMetadata(cls: new (...args: never[]) => unknown): object {
  const meta = (cls as unknown as Record<symbol, object | undefined>)[PIPELINE_SYMBOL];
  if (meta === undefined || meta === null || typeof meta !== "object") {
    throw new DecoratorError(
      `class ${cls.name} is not a decorated pipeline (missing @pipeline)`,
      "NOT_A_PIPELINE",
    );
  }
  return meta;
}

/**
 * @step — field or method decorator for step definitions.
 * Can be used as `@step`, `@step(options)`, on a planning method, or on a method
 * returning a StepBuilder.
 */
export function step<This, Value>(
  _value: undefined,
  context: ClassFieldDecoratorContext<This, Value>,
): void | ((this: This, value: Value) => Value);
export function step<This, Args extends readonly unknown[], Return>(
  value: (this: This, ...args: Args) => Return,
  context: ClassMethodDecoratorContext<This, (this: This, ...args: Args) => Return>,
): (this: This, ...args: Args) => Return;
export function step(options: StepOptions): StepDecorator;
export function step(
  first: unknown,
  second?: DecoratorContext,
): unknown {
  if (second !== undefined) {
    const context = second;
    return registerField(context, String(context.name), "step", first, undefined);
  }
  const options = first as StepOptions;
  validateStepOptions(options);
  return ((value: unknown, context: DecoratorContext) =>
    registerField(context, String(context.name), "step", value, options)) as StepDecorator;
}

/**
 * Factory form of @step for use with options: `@stepWithOptions({ timeout: 60000 })`.
 */
export function stepWithOptions(options: StepOptions): StepDecorator {
  return step(options) as StepDecorator;
}

/**
 * @entry(trigger) — field decorator for entry definitions.
 */
export function entry<This, Value>(
  trigger: Trigger,
): (_value: undefined, context: ClassFieldDecoratorContext<This, Value>) => void | ((this: This, value: Value) => Value) {
  return function (_value: undefined, context: ClassFieldDecoratorContext): void | ((this: This, value: Value) => Value) {
    registerField(context, String(context.name), "entry", _value, undefined, trigger);
    return undefined;
  };
}

/**
 * @input — field decorator for pipeline inputs.
 * The field initializer provides the Input value (read from instance
 * during decoratePipeline, since TC39 field decorators receive undefined
 * as the value at class definition time).
 */
export function input<This, Value>(
  _value: undefined,
  context: ClassFieldDecoratorContext<This, Value>,
): void | ((this: This, value: Value) => Value) {
  registerField(context, String(context.name), "input", _value);
  return undefined;
}

// --- Internal helpers ---

function registerField(
  context: DecoratorContext,
  name: string,
  kind: FieldKind,
  value: unknown,
  options?: StepOptions,
  trigger?: Trigger,
): unknown {
  if (context.metadata !== undefined && context.metadata !== null) {
    registerFieldOnMetadata(context.metadata, name, kind, options, trigger);
  } else {
    context.addInitializer(function () {
      const ctor = ((this as object).constructor as unknown as Record<symbol, object | undefined>);
      let meta = ctor[PIPELINE_SYMBOL];
      if (meta === undefined || meta === null || typeof meta !== "object") {
        meta = {};
        ctor[PIPELINE_SYMBOL] = meta;
      }
      registerFieldOnMetadata(meta, name, kind, options, trigger);
    });
  }
  if (context.kind === "method") {
    return value;
  }
  return undefined;
}

function getFieldsMap(metadata: object): Map<string, FieldMetadata> {
  const obj = metadata as Record<symbol, unknown>;
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

function validateStepOptions(options: StepOptions): void {
  if (typeof options !== "object" || options === null) {
    throw new DecoratorError("step options must be an object", "INVALID_OPTIONS");
  }
  validateOptionalNumber(options.timeout, "timeout");
  validateOptionalArray(options.dependsOn, "dependsOn");
  validateOptionalObject(options.runtime, "runtime");
  validateOptionalRecord(options.outputs, "outputs");
}

function validateOptionalNumber(val: unknown, field: string): void {
  if (val !== undefined && typeof val !== "number") {
    throw new DecoratorError(`step ${field} must be a number`, "INVALID_OPTIONS");
  }
}

function validateOptionalArray(val: unknown, field: string): void {
  if (val !== undefined && !Array.isArray(val)) {
    throw new DecoratorError(`step ${field} must be an array`, "INVALID_OPTIONS");
  }
}

function validateOptionalObject(val: unknown, field: string): void {
  if (val !== undefined && (typeof val !== "object" || val === null)) {
    throw new DecoratorError(`step ${field} must be an object`, "INVALID_OPTIONS");
  }
}

function validateOptionalRecord(val: unknown, field: string): void {
  if (val !== undefined && (typeof val !== "object" || val === null || Array.isArray(val))) {
    throw new DecoratorError(`step ${field} must be a record`, "INVALID_OPTIONS");
  }
}
