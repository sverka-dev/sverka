import type { Plan } from "./plan.js";
import { canonicalStringify } from "./internal/canonical.js";
import { validatePlan } from "./validate.js";
import { SerializationError, ValidationError } from "./errors.js";

/**
 * Serialize a Plan to a canonical JSON string.
 *
 * Canonical form: UTF-8, keys sorted lexicographically (byte-wise on UTF-16
 * code units), no trailing whitespace, no comments, compact (no
 * indentation). Array element order is preserved. `undefined` fields are
 * omitted. This is the single canonical primitive: `computePlanId` hashes
 * the output of this function (with `id`/`createdAt` stripped), so two
 * identical plans produce byte-identical JSON and thus the same id.
 */
export function serializePlan(plan: Plan): string {
  try {
    return canonicalStringify(plan);
  } catch (e) {
    // Defensive: the Plan type forbids NaN/Infinity, but unknown callers
    // could smuggle them in via `as Plan`.
    throw new SerializationError(
      e instanceof Error ? e.message : "failed to serialize plan",
      { cause: e instanceof Error ? e.message : String(e) },
    );
  }
}

/**
 * Deserialize and validate a JSON string into a Plan. Throws
 * {@link SerializationError} on JSON parse failure and {@link ValidationError}
 * when the parsed object fails schema validation. The returned Plan is a
 * deep-frozen, readonly view.
 */
export function deserializePlan(json: string): Plan {
  let parsed: unknown;
  try {
    parsed = JSON.parse(json);
  } catch (e) {
    throw new SerializationError(
      e instanceof Error ? e.message : "malformed JSON",
      { inputLength: json.length },
    );
  }

  const result = validatePlan(parsed);
  if (!result.valid) {
    const first = result.errors[0];
    const message =
      first === undefined
        ? "plan failed validation"
        : `${first.code}: ${first.message}`;
    throw new ValidationError(message, {
      errors: result.errors.map((e) => ({ code: e.code, field: e.field })),
    });
  }

  return deepFreeze(parsed as Plan);
}

/** Recursively freeze an object and all nested objects/arrays. */
function deepFreeze<T>(value: T): T {
  if (value !== null && typeof value === "object") {
    const v = value as unknown as Record<string, unknown> | unknown[];
    if (Array.isArray(v)) {
      for (const el of v) deepFreeze(el);
    } else {
      for (const k of Object.keys(v)) deepFreeze(v[k]);
    }
    Object.freeze(value);
  }
  return value;
}
