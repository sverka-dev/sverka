// Markdown authoring errors (Spec 37, extended by Spec 54).

import { SdkError } from "./errors.js";

export type MarkdownParseErrorCode =
  | "INVALID_FRONTMATTER"
  | "INVALID_STEP"
  | "INVALID_TRIGGER"
  | "EXTENDS_NOT_FOUND";

/** Raised when a `.sverka.md` file cannot be parsed into a Project. */
export class MarkdownParseError extends SdkError {
  declare readonly code: MarkdownParseErrorCode;

  constructor(message: string, code: MarkdownParseErrorCode, cause?: unknown) {
    super(message, code, cause);
    this.name = "MarkdownParseError";
  }
}
