// ui command — start local web dashboard server.

import process from "node:process";
import { join } from "node:path";
import type { GlobalFlags, OutputWriter } from "../types.js";
import { ExitCode } from "../types.js";

export interface UiArgs {
  /** Port to listen on (default: 3000). */
  port?: number;
  /** Host to bind (default: localhost). */
  host?: string;
}

/**
 * Start a local web dashboard server that lists SARIF files
 * and renders individual findings reports.
 */
export async function uiCommand(
  args: UiArgs,
  global: GlobalFlags,
  output: OutputWriter,
  _start: number,
): Promise<number> {
  const artifactsDir = join(global.root, ".sverka", "artifacts");
  const port = args.port ?? 3000;
  const host = args.host ?? "localhost";

  try {
    const { startUiServer } = await import("@sverka/ui");
    const server = await startUiServer({ artifactsDir, port, host });
    output.writeLine(`Sverka UI running at ${server.url}`);
    output.writeLine(`Artifacts: ${artifactsDir}`);
    output.writeLine("Press Ctrl+C to stop.");

    // Keep the process alive until interrupted.
    // Use `once` to prevent handler accumulation if uiCommand is called
    // multiple times in the same process.
    process.once("SIGINT", () => {
      server.close();
      process.exit(ExitCode.Success);
    });

    // Return a promise that never resolves — the process exits via SIGINT.
    return new Promise<number>(() => {});
  } catch (e) {
    output.errorLine(
      `sverka ui: ${e instanceof Error ? e.message : String(e)}`,
    );
    return ExitCode.RuntimeError;
  }
}
