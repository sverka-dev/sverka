// expr tagged template — symbolic expression builder.
// Spec 03 — §12.3. Architecture spec §11.1, §12.3.

import type { Reference, Expression, StepRef, ContextRef } from "@sverka/cdk";
import { SdkError } from "./errors.js";

/**
 * Create a symbolic expression from a tagged template.
 * References interpolated in the template produce `${namespace.field}`
 * placeholders and are collected into `refs` for dependency inference.
 * String, number, and boolean values are inlined into the template.
 */
export function expr(
  strings: TemplateStringsArray,
  ...values: readonly (string | number | boolean | Reference)[]
): Expression {
  let template = "";
  const refs: Reference[] = [];

  for (let i = 0; i < strings.length; i++) {
    template += strings[i];
    if (i < values.length) {
      const v = values[i]!;
      if (typeof v === "string" || typeof v === "number" || typeof v === "boolean") {
        template += String(v);
      } else if (isReference(v)) {
        refs.push(v);
        if (v.kind === "step") {
          template += `\${${v.step}.${v.output}}`;
        } else {
          template += `\${${v.namespace}.${v.field}}`;
        }
      } else {
        throw new SdkError(
          `invalid interpolation value at position ${i}: expected string, number, boolean, or Reference`,
          "INVALID_INTERPOLATION",
        );
      }
    }
  }

  return { kind: "expression", template, refs };
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
