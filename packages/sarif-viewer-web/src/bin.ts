#!/usr/bin/env node
// @sverka/sarif-viewer-web — CLI entry point. Spec 47.

import process from "node:process";
import { readFileSync, writeFileSync, mkdirSync } from "node:fs";
import { dirname } from "node:path";
import { resolveFindings } from "./input.js";
import { generateSarifHtml } from "./viewer.js";

function parseArgs(argv: string[]): { inputPath: string | null; outputPath: string } {
  let inputPath: string | null = null;
  let outputPath = "sarif-report.html";
  for (let i = 0; i < argv.length; i++) {
    const arg = argv[i];
    if (arg === "-o" || arg === "--output") {
      const next = argv[i + 1];
      if (next === undefined || next.startsWith("-")) {
        process.stderr.write("sarif-viewer-web: -o requires a file path argument.\n");
        process.exit(1);
      }
      outputPath = next;
      i++;
    } else if (arg === "--help" || arg === "-h") {
      process.stdout.write(
        "Usage: sarif-viewer-web <file> [-o report.html]\n  Reads SARIF from a file argument.\n  Writes HTML to -o path (default: sarif-report.html).\n",
      );
      process.exit(0);
    } else if (!arg.startsWith("-")) {
      if (inputPath !== null) {
        process.stderr.write("sarif-viewer-web: only one input file may be provided.\n");
        process.exit(1);
      }
      inputPath = arg;
    } else {
      process.stderr.write(`sarif-viewer-web: unknown option: ${arg}\n`);
      process.exit(1);
    }
  }
  return { inputPath, outputPath };
}

function main(): void {
  const { inputPath, outputPath } = parseArgs(process.argv.slice(2));

  let findings;
  try {
    if (inputPath !== null) {
      const raw = readFileSync(inputPath, "utf8");
      const parsed: unknown = JSON.parse(raw);
      findings = resolveFindings({ sarif: parsed });
    } else if (!process.stdin.isTTY) {
      const raw = readFileSync(0, "utf8");
      if (raw.trim() === "") {
        process.stderr.write("sarif-viewer-web: stdin is empty.\n");
        process.exit(1);
      }
      const parsed: unknown = JSON.parse(raw);
      findings = resolveFindings({ sarif: parsed });
    } else {
      process.stderr.write(
        "sarif-viewer-web: no input. Provide a SARIF file argument or pipe SARIF via stdin.\n",
      );
      process.exit(1);
    }
  } catch (e) {
    const msg = e instanceof Error ? e.message : String(e);
    process.stderr.write(`sarif-viewer-web: ${msg}\n`);
    process.exit(1);
  }

  try {
    const html = generateSarifHtml(findings);
    mkdirSync(dirname(outputPath), { recursive: true });
    writeFileSync(outputPath, html, "utf-8");
    process.stdout.write(`Wrote ${outputPath}\n`);
  } catch (e) {
    const msg = e instanceof Error ? e.message : String(e);
    process.stderr.write(`sarif-viewer-web: failed to write HTML: ${msg}\n`);
    process.exit(1);
  }
}

main();
