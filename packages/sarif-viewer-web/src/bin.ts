#!/usr/bin/env node
// @sverka/sarif-viewer-web — CLI entry point. Spec 47.

import process from "node:process";
import { readFileSync } from "node:fs";
import { resolveFindings } from "./input.js";
import { generateSarifHtml } from "./viewer.js";
import { writeFileSync, mkdirSync } from "node:fs";
import { dirname } from "node:path";

function parseArgs(argv: string[]): { inputPath: string | null; outputPath: string } {
  let inputPath: string | null = null;
  let outputPath = "sarif-report.html";
  for (let i = 0; i < argv.length; i++) {
    const arg = argv[i];
    if (arg === "-o" || arg === "--output") {
      outputPath = argv[i + 1] ?? outputPath;
      i++;
    } else if (arg === "--help" || arg === "-h") {
      process.stdout.write(
        "Usage: sarif-viewer-web <file> [-o report.html]\n  Reads SARIF from a file argument.\n  Writes HTML to -o path (default: sarif-report.html).\n",
      );
      process.exit(0);
    } else if (!arg.startsWith("-")) {
      inputPath = arg;
    }
  }
  return { inputPath, outputPath };
}

function main(): void {
  const { inputPath, outputPath } = parseArgs(process.argv.slice(2));

  let findings;
  if (inputPath !== null) {
    const raw = readFileSync(inputPath, "utf8");
    const parsed = JSON.parse(raw);
    findings = resolveFindings({ sarif: parsed });
  } else if (!process.stdin.isTTY) {
    const raw = readFileSync(0, "utf8");
    if (raw.trim() === "") {
      process.stderr.write("sarif-viewer-web: stdin is empty.\n");
      process.exit(1);
    }
    const parsed = JSON.parse(raw);
    findings = resolveFindings({ sarif: parsed });
  } else {
    process.stderr.write(
      "sarif-viewer-web: no input. Provide a SARIF file argument or pipe SARIF via stdin.\n",
    );
    process.exit(1);
  }

  const html = generateSarifHtml(findings);
  mkdirSync(dirname(outputPath), { recursive: true });
  writeFileSync(outputPath, html, "utf-8");
  process.stdout.write(`Wrote ${outputPath}\n`);
}

main();
