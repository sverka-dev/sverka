// @sverka/reporter — FindingsCollector (I/O). Spec 43.

import { readdir, readFile, stat } from "node:fs/promises";
import { join, relative, sep } from "node:path";
import { normalizeSarif } from "@sverka/verification";
import type { SarifLog } from "@sverka/verification";
import type { FindingsCollectorOptions, FindingRow } from "./types.js";
import { ReporterError } from "./errors.js";

/** Collect findings from SARIF files in the artifact directory. */
export async function collectFindings(
  options: FindingsCollectorOptions,
): Promise<readonly FindingRow[]> {
  const { artifactDir } = options;
  let entries: readonly string[];
  try {
    entries = await readdir(artifactDir);
  } catch {
    return [];
  }

  const rows: FindingRow[] = [];

  for (const entry of entries) {
    const entryPath = join(artifactDir, entry);
    let isDir: boolean;
    try {
      isDir = (await stat(entryPath)).isDirectory();
    } catch {
      continue;
    }

    if (!isDir) continue;

    // Recursively find .sarif files under this entry; stepId is the
    // relative path from artifactDir to the directory containing the file.
    await scanDir(entryPath, artifactDir, rows);
  }

  return rows;
}

async function scanDir(
  dir: string,
  artifactDir: string,
  rows: FindingRow[],
): Promise<void> {
  let entries: readonly string[];
  try {
    entries = await readdir(dir);
  } catch {
    return;
  }

  for (const entry of entries) {
    const entryPath = join(dir, entry);
    let isDir: boolean;
    try {
      isDir = (await stat(entryPath)).isDirectory();
    } catch {
      continue;
    }

    if (isDir) {
      await scanDir(entryPath, artifactDir, rows);
    } else if (entry.endsWith(".sarif") || entry.endsWith(".sarif.json")) {
      await processSarif(entryPath, dir, artifactDir, rows);
    }
  }
}

async function processSarif(
  filePath: string,
  fileDir: string,
  artifactDir: string,
  rows: FindingRow[],
): Promise<void> {
  let content: string;
  try {
    content = await readFile(filePath, "utf-8");
  } catch {
    return;
  }

  let parsed: SarifLog;
  try {
    parsed = JSON.parse(content) as SarifLog;
  } catch (e) {
    throw new ReporterError(
      `invalid SARIF JSON in ${filePath}`,
      "COLLECTION_FAILED",
      e,
    );
  }

  // stepId is the relative path from artifactDir to the file's parent dir
  const stepId = relative(artifactDir, fileDir).split(sep).join("/");

  const findings = normalizeSarif(parsed, {
    root: artifactDir,
    checkIdPrefix: stepId,
    defaultConfidence: 0.5,
  });

  for (const finding of findings) {
    rows.push({ finding, stepId });
  }
}
