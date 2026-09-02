// Shared sanitization and guard helpers for code generation emitters.
// Used by Inngest, Temporal, and other target emitters to safely embed
// user-controlled values (step IDs, warnings) into generated source code.

import type { Condition } from "@sverka/workflow";

/**
 * Sanitize text for safe embedding inside a `//` line comment.
 * Replaces newlines, carriage returns, tabs, Unicode line terminators
 * (U+2028, U+2029), and other control characters (U+0000–U+001F) with
 * spaces to prevent comment termination or code injection.
 */
export function sanitizeForComment(text: string): string {
  return text.replace(/[\r\n\t\u0000-\u001f\u2028\u2029]/g, " ");
}

/**
 * Generate condition guard lines for a step, parameterized by indentation.
 * The `indent` string is prepended to each generated line (e.g. "  " or "    ").
 */
export function conditionGuard(
  condition: Condition | undefined,
  indent: string,
): { open: string; close: string } {
  if (condition === undefined) {
    return { open: "", close: "" };
  }

  if (condition.kind === "status") {
    switch (condition.status) {
      case "success":
        return { open: `${indent}if (!_failed) {`, close: `${indent}}` };
      case "failure":
        return { open: `${indent}if (_failed) {`, close: `${indent}}` };
      case "always":
        return { open: "", close: "" };
      case "never":
        return { open: `${indent}if (false) { // condition: never`, close: `${indent}}` };
    }
  }

  // Expression or Reference — cannot be evaluated at compile time.
  // Reject rather than silently executing the step unconditionally.
  throw new Error(
    `condition kind '${condition.kind}' cannot be evaluated at compile time and is not supported by this target`,
  );
}
