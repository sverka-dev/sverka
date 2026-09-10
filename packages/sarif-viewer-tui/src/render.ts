// @sverka/sarif-viewer-tui — render entry point. Spec 46.

import process from "node:process";
import { render } from "ink";
import { createElement } from "react";
import { resolveFindings } from "./input.js";
import { SarifTuiApp } from "./viewer.js";
import type { SarifTuiOptions } from "./types.js";

/**
 * Resolve `options` into findings and render the SARIF TUI. Blocks until the
 * user quits (q / Ctrl-C). Resolves on exit.
 *
 * Wraps resolveFindings in a try-catch so invalid input produces a clean
 * error message instead of an unhandled synchronous throw before the
 * promise exists.
 */
export function renderSarifTui(options: SarifTuiOptions): Promise<void> {
  let findings;
  try {
    findings = resolveFindings(options);
  } catch (e) {
    const msg = e instanceof Error ? e.message : String(e);
    process.stderr.write(`sarif-viewer-tui: ${msg}\n`);
    return Promise.resolve();
  }

  // Only pass stdin to Ink if it's a live TTY. When SARIF was piped via
  // stdin, the stream is consumed and Ink cannot use it for input.
  const stdin = process.stdin.isTTY ? process.stdin : undefined;

  const instance = render(createElement(SarifTuiApp, { findings }), {
    stdout: process.stdout,
    ...(stdin !== undefined ? { stdin } : {}),
    exitOnCtrlC: true,
  });
  return instance.waitUntilExit().then(() => undefined);
}
