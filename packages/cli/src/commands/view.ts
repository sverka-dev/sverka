// view command — view SARIF findings in TUI or generate HTML report.

import process from "node:process";
import { readFileSync } from "node:fs";
import type { GlobalFlags, OutputWriter } from "../types.js";
import { CliError, ExitCode } from "../types.js";

export interface ViewArgs {
  /** Path to a .sarif file. Reads from stdin if undefined. */
  file?: string;
  /** View format: "tui" (terminal) or "web" (HTML report). */
  format: "tui" | "web";
  /** Output HTML file path (for --format web). */
  output?: string;
}

/**
 * View SARIF findings in the terminal TUI or generate an HTML report.
 */
export async function viewCommand(
  args: ViewArgs,
  global: GlobalFlags,
  output: OutputWriter,
  start: number,
): Promise<number> {
  // Read SARIF input.
  let sarifJson: string;
  if (args.file) {
    try {
      sarifJson = readFileSync(args.file, "utf8");
    } catch (e) {
      throw new CliError(
        `failed to read SARIF file: ${e instanceof Error ? e.message : String(e)}`,
        "MISSING_ARG",
        ExitCode.RuntimeError,
      );
    }
  } else if (!process.stdin.isTTY) {
    sarifJson = readFileSync(0, "utf8");
    if (sarifJson.trim() === "") {
      output.errorLine("sverka view: stdin is empty.");
      return ExitCode.RuntimeError;
    }
  } else {
    output.errorLine(
      "sverka view: no input. Provide a SARIF file argument or pipe SARIF via stdin.",
    );
    return ExitCode.UsageError;
  }

  let sarif: unknown;
  try {
    sarif = JSON.parse(sarifJson);
  } catch (e) {
    output.errorLine(
      `sverka view: invalid JSON: ${e instanceof Error ? e.message : String(e)}`,
    );
    return ExitCode.RuntimeError;
  }

  if (args.format === "web") {
    return renderWeb(sarif, args, output);
  }

  return renderTui(sarif, output);
}

/** Launch the TUI viewer using @sverka/sarif-viewer-tui. */
async function renderTui(sarif: unknown, output: OutputWriter): Promise<number> {
  try {
    const { renderSarifTui } = await import("@sverka/sarif-viewer-tui");
    await renderSarifTui({ sarif: sarif as never });
    return ExitCode.Success;
  } catch (e) {
    output.errorLine(
      `sverka view: ${e instanceof Error ? e.message : String(e)}`,
    );
    return ExitCode.RuntimeError;
  }
}

/** Generate an HTML report using @sverka/sarif-viewer-web. */
async function renderWeb(
  sarif: unknown,
  args: ViewArgs,
  output: OutputWriter,
): Promise<number> {
  try {
    const { renderSarifWeb } = await import("@sverka/sarif-viewer-web");
    const outputPath = args.output ?? "sarif-report.html";
    renderSarifWeb({ sarif: sarif as never, outputPath });
    output.writeLine(`Wrote ${outputPath}`);
    return ExitCode.Success;
  } catch (e) {
    output.errorLine(
      `sverka view: ${e instanceof Error ? e.message : String(e)}`,
    );
    return ExitCode.RuntimeError;
  }
}
