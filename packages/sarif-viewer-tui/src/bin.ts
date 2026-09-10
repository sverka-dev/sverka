#!/usr/bin/env node
// @sverka/sarif-viewer-tui — CLI entry point. Spec 46.

import process from "node:process";
import { readFileSync } from "node:fs";
import { resolveFindings } from "./input.js";

async function main(): Promise<void> {
  const arg = process.argv[2];

  if (arg === "--help" || arg === "-h") {
    process.stdout.write(
      "Usage: sarif-viewer-tui [file]\n  Reads SARIF from a file argument or stdin.\n",
    );
    return;
  }

  // Resolve findings first (handles file reading, parsing, normalization).
  // This does NOT import ink — only the render step does.
  const options =
    arg !== undefined
      ? { sarifPath: arg }
      : process.stdin.isTTY
        ? null
        : (() => {
            const raw = readFileSync(0, "utf8");
            if (raw.trim() === "") {
              process.stderr.write("sarif-viewer-tui: stdin is empty.\n");
              process.exit(1);
            }
            try {
              return { sarif: JSON.parse(raw) };
            } catch {
              process.stderr.write("sarif-viewer-tui: failed to parse SARIF JSON from stdin.\n");
              process.exit(1);
            }
          })();

  if (options === null) {
    process.stderr.write(
      "sarif-viewer-tui: no input. Provide a SARIF file argument or pipe SARIF via stdin.\n",
    );
    process.exit(1);
  }

  const findings = resolveFindings(options);

  // Lazy import the render module — this pulls in ink/react, which we only
  // need when actually launching the TUI.
  const { renderSarifTui } = await import("./render.js");
  await renderSarifTui({ findings });
}

main()
  .then(() => {
    process.exit(0);
  })
  .catch((e: unknown) => {
    process.stderr.write(
      `sarif-viewer-tui: ${e instanceof Error ? e.message : String(e)}\n`,
    );
    process.exit(1);
  });
