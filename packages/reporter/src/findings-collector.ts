// @sverka/reporter — FindingsCollector (I/O). Spec 43.

import { readdir, readFile, lstat, realpath } from "node:fs/promises";
import type { Stats } from "node:fs";
import { join, relative, sep, resolve, isAbsolute } from "node:path";
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
  const { artifactDir, sinceMs, runId } = options;
  const root = resolve(artifactDir);
  // Run-scoped collection: the engine writes artifacts under
  // <artifactDir>/<runId>/ so findings belong to exactly one run and a
  // concurrent run's files can never leak in. `sinceMs` remains as a
  // secondary filter within the run tree.
  const scanRoot = runId === undefined ? root : resolve(join(root, runId));
  if (runId !== undefined) {
    // Containment must hold lexically (runId can't `../` out — a
    // `root + sep` prefix test would reject the filesystem root itself)
    // and physically: a symlinked run dir resolves outside the root
    // while still passing the lexical check.
    const [realRoot, realScan] = await Promise.all([
      realpath(root).catch(() => root),
      realpath(scanRoot).catch(() => scanRoot),
    ]);
    if (!isUnder(root, scanRoot) || !isUnder(realRoot, realScan)) {
      throw new ReporterError(
        `invalid runId "${runId}" — must resolve under the artifact directory`,
        "COLLECTION_FAILED",
      );
    }
  }

  let entries: readonly string[];
  try {
    entries = await readdir(scanRoot);
  } catch (e) {
    const code = (e as NodeJS.ErrnoException).code;
    if (code === "ENOENT" && runId !== undefined) {
      // The scoped run wrote no artifacts — normal when no step exports
      // SARIF. Keep the actionable hint when the artifact root itself is
      // absent: no run has ever produced artifacts here.
      try {
        await readdir(root);
        return [];
      } catch (rootErr) {
        if ((rootErr as NodeJS.ErrnoException).code === "ENOENT") {
          throw dirNotFoundError(root, rootErr);
        }
        throw dirReadError(root, rootErr);
      }
    }
    if (code === "ENOENT") throw dirNotFoundError(root, e);
    throw dirReadError(scanRoot, e);
  }

  const rows: FindingRow[] = [];

  for (const entry of entries) {
    const entryPath = join(scanRoot, entry);
    let isDir: boolean;
    try {
      isDir = (await lstat(entryPath)).isDirectory();
    } catch {
      continue;
    }

    if (!isDir) continue;

    // Recursively find .sarif files under this entry; stepId is the
    // relative path from artifactDir to the directory containing the file.
    await scanDir(entryPath, scanRoot, rows, sinceMs);
  }

  return rows;
}

/** True when `child` resolves strictly inside `parent`. */
function isUnder(parent: string, child: string): boolean {
  const rel = relative(parent, child);
  return (
    rel !== "" &&
    rel !== ".." &&
    !rel.startsWith(`..${sep}`) &&
    !isAbsolute(rel)
  );
}

function dirNotFoundError(dir: string, cause: unknown): ReporterError {
  return new ReporterError(
    `artifact directory not found: ${dir} — no step produced artifacts; declare a SARIF artifact output with fromStdout: true to use --evaluate`,
    "COLLECTION_FAILED",
    cause,
  );
}

function dirReadError(dir: string, cause: unknown): ReporterError {
  return new ReporterError(
    `failed to read artifact directory ${dir}: ${cause instanceof Error ? cause.message : String(cause)}`,
    "COLLECTION_FAILED",
    cause,
  );
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
    if (resolvedEntry !== artifactDir && !isUnder(artifactDir, resolvedEntry)) {
      continue;
    }

    // lstat reports symlinks as links, not dirs/files — never follow
    // them so a link can't pull SARIF in from outside the artifact tree.
    if (st.isSymbolicLink()) continue;

    if (st.isDirectory()) {
      await scanDir(entryPath, artifactDir, rows, sinceMs);
    } else if (entry.endsWith(".sarif") || entry.endsWith(".sarif.json")) {
      // Run scoping is the collector's job — when `runId` is set the
      // scan root is already that run's private tree. `sinceMs` remains
      // for legacy flat artifact directories shared across runs: only
      // files (re)written during the current run belong in its report.
      // Filesystems with coarse timestamp granularity (FAT32: 2s) can
      // round a just-written file's mtime below the run start, so the
      // cutoff carries an epsilon — a file written moments before this
      // run is a far smaller evil than silently dropping its findings.
      if (sinceMs !== undefined && st.mtimeMs < sinceMs - MTIME_EPSILON_MS)
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
