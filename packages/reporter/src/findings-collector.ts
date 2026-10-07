// @sverka/reporter — FindingsCollector (I/O). Spec 43.

import { readdir, readFile, lstat } from "node:fs/promises";
import type { Stats } from "node:fs";
import { join, relative, sep, resolve } from "node:path";
import { normalizeSarif } from "@sverka/verification";
import type { SarifLog } from "@sverka/verification";
import type { FindingsCollectorOptions, FindingRow } from "./types.js";
import { ReporterError } from "./errors.js";

/** Tolerance for coarse filesystem timestamp granularity (FAT32: 2 s). */
const MTIME_EPSILON_MS = 2_000;

/** Collect findings from SARIF files in the artifact directory. */
export async function collectFindings(
  options: FindingsCollectorOptions,
): Promise<readonly FindingRow[]> {
  const { artifactDir, sinceMs } = options;
  const root = resolve(artifactDir);
  let entries: readonly string[];
  try {
    entries = await readdir(root);
  } catch (e) {
    if ((e as NodeJS.ErrnoException).code === "ENOENT") {
      throw new ReporterError(
        `artifact directory not found: ${root} — no step produced artifacts; declare a SARIF artifact output with fromStdout: true to use --evaluate`,
        "COLLECTION_FAILED",
        e,
      );
    }
    throw new ReporterError(
      `failed to read artifact directory ${root}: ${e instanceof Error ? e.message : String(e)}`,
      "COLLECTION_FAILED",
      e,
    );
  }

  const rows: FindingRow[] = [];

  for (const entry of entries) {
    const entryPath = join(root, entry);
    let isDir: boolean;
    try {
      isDir = (await lstat(entryPath)).isDirectory();
    } catch {
      continue;
    }

    if (!isDir) continue;

    // Recursively find .sarif files under this entry; stepId is the
    // relative path from artifactDir to the directory containing the file.
    await scanDir(entryPath, root, rows, sinceMs);
  }

  return rows;
}

async function scanDir(
  dir: string,
  artifactDir: string,
  rows: FindingRow[],
  sinceMs?: number,
): Promise<void> {
  let entries: readonly string[];
  try {
    entries = await readdir(dir);
  } catch {
    return;
  }

  for (const entry of entries) {
    const entryPath = join(dir, entry);
    let st: Stats;
    try {
      st = await lstat(entryPath);
    } catch {
      continue;
    }

    // Prevent traversal outside artifactDir via symlink or ../
    const resolvedEntry = resolve(entryPath);
    if (
      resolvedEntry !== artifactDir &&
      !resolvedEntry.startsWith(artifactDir + sep)
    ) {
      continue;
    }

    if (st.isDirectory()) {
      await scanDir(entryPath, artifactDir, rows, sinceMs);
    } else if (entry.endsWith(".sarif") || entry.endsWith(".sarif.json")) {
      // Stale artifacts from earlier runs share this directory — only
      // files (re)written during the current run belong in its report.
      // Filesystems with coarse timestamp granularity (FAT32: 2s) can
      // round a just-written file's mtime below the run start, so the
      // cutoff carries an epsilon — a file written moments before this
      // run is a far smaller evil than silently dropping its findings.
      if (
        sinceMs !== undefined &&
        st.mtimeMs < sinceMs - MTIME_EPSILON_MS
      )
        continue;
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
