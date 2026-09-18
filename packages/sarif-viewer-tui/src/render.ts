// @sverka/sarif-viewer-tui — render entry point. Spec 46.

import process from "node:process";
import { openSync } from "node:fs";
import { ReadStream } from "node:tty";
import { render } from "ink";
import { createElement } from "react";
import type { Finding } from "@sverka/verification";
import { resolveFindings } from "./input.js";
import { SarifTuiApp } from "./viewer.js";
import type { SarifTuiOptions } from "./types.js";

/**
 * Resolve `options` into findings and render the SARIF TUI. Blocks until the
 * user quits (q / Ctrl-C). Resolves on exit.
 *
 * When stdout is not a TTY (piped output, CI, agents) or no interactive
 * input stream is available, Ink cannot run — the findings are printed as
 * plain text instead so the command still produces useful output and exits.
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

  if (!process.stdout.isTTY || process.env.CI) {
    // Non-interactive stdout or CI — even with a pseudo-TTY there is no
    // user to quit Ink, so a TUI would block forever. Print the findings.
    printFindings(findings);
    return Promise.resolve();
  }

  // Ink needs a raw-mode-capable stdin for keyboard input. When SARIF was
  // piped via stdin (e.g. `cat f.sarif | sverka view`), stdin is a pipe —
  // fall back to the controlling terminal so the TUI still works.
  const stdin = interactiveStdin();
  if (stdin === undefined) {
    printFindings(findings);
    return Promise.resolve();
  }

  const instance = render(createElement(SarifTuiApp, { findings }), {
    stdout: process.stdout,
    stdin,
    exitOnCtrlC: true,
  });
  return instance.waitUntilExit().then(() => undefined);
}

/** Return a raw-mode-capable input stream for Ink, or undefined. */
function interactiveStdin(): ReadStream | undefined {
  if (process.stdin.isTTY) return process.stdin;
  // /dev/tty is POSIX-only; on Windows there is no equivalent Node API to
  // reopen console input, so piped stdin degrades to the text fallback.
  if (process.platform === "win32") return undefined;
  try {
    return new ReadStream(openSync("/dev/tty", "r"));
  } catch {
    // No controlling terminal (CI, detached process) — non-interactive.
    return undefined;
  }
}

/** Plain-text fallback listing used when the TUI cannot run. */
function printFindings(findings: readonly Finding[]): void {
  process.stdout.write(`SARIF findings (${findings.length}):\n`);
  for (const f of findings) {
    process.stdout.write(
      `  ${f.severity.padEnd(8)} ${f.checkId}  ${f.file}:${f.startLine}  ${f.message}\n`,
    );
  }
}
