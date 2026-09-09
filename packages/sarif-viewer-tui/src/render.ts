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
 */
export function renderSarifTui(options: SarifTuiOptions): Promise<void> {
  const findings = resolveFindings(options);
  const instance = render(createElement(SarifTuiApp, { findings }), {
    stdout: process.stdout,
    stdin: process.stdin,
    exitOnCtrlC: true,
  });
  return instance.waitUntilExit().then(() => undefined);
}
