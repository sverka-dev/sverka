// Shared sanitization helpers for code generation emitters.
// Used by Inngest, Temporal, and other target emitters to safely embed
// user-controlled values (step IDs, warnings) into generated source code.

/**
 * Sanitize text for safe embedding inside a `//` line comment.
 * Replaces newlines, carriage returns, tabs, Unicode line terminators
 * (U+2028, U+2029), and other control characters (U+0000–U+001F) with
 * spaces to prevent comment termination or code injection.
 */
export function sanitizeForComment(text: string): string {
  return text.replace(/[\r\n\t\u0000-\u001f\u2028\u2029]/g, " ");
}
