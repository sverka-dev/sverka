// BufferingOutputWriter — captures stdout output for JSON parsing,
// routes errors/debug to stderr (NOT stdout — stdout is the MCP transport).

import process from "node:process";
import type { OutputWriter } from "../types.js";

/**
 * OutputWriter for MCP tool execution: captures structured stdout output
 * (command handlers emit JSON when format="json") and routes all error/debug
 * output to stderr. stdout is reserved for MCP JSON-RPC transport.
 */
export class BufferingOutputWriter implements OutputWriter {
  #buffer = "";

  write(text: string): void {
    this.#buffer += text;
  }

  writeLine(text: string): void {
    this.#buffer += text + "\n";
  }

  error(text: string): void {
    process.stderr.write(text);
  }

  errorLine(text: string): void {
    process.stderr.write(text + "\n");
  }

  debug(text: string): void {
    process.stderr.write(text + "\n");
  }

  /** The captured stdout content (JSON string from the command handler). */
  get captured(): string {
    return this.#buffer;
  }
}
