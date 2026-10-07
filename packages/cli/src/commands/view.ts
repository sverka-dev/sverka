// view command — open the latest run report, or view SARIF findings in
// TUI / generate an HTML report from a SARIF file or stdin.

import process from "node:process";
import { readFileSync } from "node:fs";
import type { GlobalFlags, OutputWriter } from "../types.js";
import { CliError, ExitCode } from "../types.js";
import {
  findLatestReportHtml,
  openReportInBrowser,
} from "../internal/open-report.js";

export interface ViewArgs {
  /** Path to a .sarif file. Reads piped stdin when omitted; on an
   *  interactive terminal with no input, opens the latest run report. */
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
    // Interactive with no input — open the latest run report (Spec 53:
    // `sverka run` tails with `report: <path>  (sverka view to open)`).
    const report = findLatestReportHtml(global.root);
    if (report === undefined) {
      output.errorLine(
        "sverka view: no input. Provide a SARIF file argument, pipe SARIF via stdin, or run `sverka run` first — no run report found under .sverka/runs/.",
      );
      return ExitCode.UsageError;
    }
    output.writeLine(`report: ${report}`);
    if (!openReportInBrowser(report)) {
      output.errorLine(
        "sverka view: could not open a browser — open the report path above manually.",
      );
    }
    return ExitCode.Success;
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
async function renderTui(
  sarif: unknown,
  output: OutputWriter,
): Promise<number> {
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
