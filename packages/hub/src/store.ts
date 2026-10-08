// Hub persistence — cache blobs + snapshots on the filesystem, runs in a
// SQLite index (node:sqlite, no native dep). Spec 55.

import { createHash, randomUUID } from "node:crypto";
import {
  mkdirSync,
  readdirSync,
  readFileSync,
  writeFileSync,
  unlinkSync,
} from "node:fs";
import { join } from "node:path";
import { DatabaseSync } from "node:sqlite";
import type { HubStoredRun } from "./types.js";

/** Cache keys are lowercase url-safe slugs — anything else is a 400. */
const KEY_PATTERN = /^[a-z0-9-]{1,128}$/;
/** Run ids are generated or client-supplied; keep them filename-safe. */
const RUN_ID_PATTERN = /^[A-Za-z0-9._~-]{1,128}$/;

export function isValidCacheKey(key: string): boolean {
  return KEY_PATTERN.test(key);
}

export function isValidRunId(runId: string): boolean {
  return RUN_ID_PATTERN.test(runId);
}

function sha256(value: string): string {
  return createHash("sha256").update(value).digest("hex");
}

/** Projects arrive URL-encoded — decoded strings may contain '/'. The
 *  storage dir encodes again to stay flat and traversal-proof. */
function projectDir(root: string, project: string): string {
  return join(root, encodeURIComponent(project));
}

const CREATE_RUNS_TABLE = `
  CREATE TABLE IF NOT EXISTS runs (
    run_id         TEXT PRIMARY KEY,
    project        TEXT NOT NULL,
    entry          TEXT NOT NULL,
    status         TEXT NOT NULL,
    started_at     INTEGER,
    duration_ms    INTEGER,
    finding_counts TEXT NOT NULL,
    verdict        TEXT,
    uploaded_at    INTEGER NOT NULL,
    report_json    TEXT NOT NULL,
    findings_json  TEXT NOT NULL
  )
`;

export interface RunInsert {
  readonly project: string;
  readonly entry: string;
  readonly report: Record<string, unknown>;
  readonly findings: readonly unknown[];
  readonly runId?: string | undefined;
}

export interface RunListQuery {
  readonly project?: string | undefined;
  readonly limit?: number | undefined;
  /** uploadedAt exclusive cursor — rows uploaded before this instant. */
  readonly before?: number | undefined;
}

export interface FlakyRow {
  readonly stepId: string;
  readonly successRate: number;
  readonly runs: number;
}

/**
 * The hub store: blobs + snapshots under `dataDir`, run index in
 * `dataDir/hub.db`.
 */
export function createHubStore(dataDir: string) {
  mkdirSync(dataDir, { recursive: true, mode: 0o700 });
  const db = new DatabaseSync(join(dataDir, "hub.db"));
  db.exec(CREATE_RUNS_TABLE);

  // --- cache blobs ---

  const cacheDir = (project: string) =>
    projectDir(join(dataDir, "cache"), project);

  const putBlob = (project: string, key: string, blob: Buffer): void => {
    const dir = cacheDir(project);
    mkdirSync(dir, { recursive: true });
    const base = join(dir, sha256(key));
    writeFileSync(`${base}.blob`, blob);
    writeFileSync(
      `${base}.json`,
      JSON.stringify({ key, size: blob.length, createdAt: Date.now() }),
    );
  };

  const readBlobDir = (
    project: string,
  ): readonly { file: string; key: string; createdAt: number }[] => {
    const dir = cacheDir(project);
    let names: string[];
    try {
      names = readdirSync(dir);
    } catch {
      return [];
    }
    const entries: { file: string; key: string; createdAt: number }[] = [];
    for (const file of names) {
      if (!file.endsWith(".json")) continue;
      try {
        const meta = JSON.parse(readFileSync(join(dir, file), "utf8")) as {
          key?: unknown;
          createdAt?: unknown;
        };
        if (typeof meta.key === "string") {
          entries.push({
            file: file.slice(0, -".json".length),
            key: meta.key,
            createdAt: typeof meta.createdAt === "number" ? meta.createdAt : 0,
          });
        }
      } catch {
        // Skip corrupt meta files.
      }
    }
    return entries;
  };

  const getBlob = (
    project: string,
    key: string,
    opts?: { prefix?: boolean | undefined },
  ): { blob: Buffer; key: string } | undefined => {
    // Exact match — O(1) and always on.
    const exact = join(cacheDir(project), `${sha256(key)}.blob`);
    try {
      return { blob: readFileSync(exact), key };
    } catch {
      // No exact hit.
    }
    // Prefix fallback is opt-in: it implements the client's restoreKeys
    // semantics. Without it, a GET for key "b" could return the newest
    // "b*" blob — wrong-key restores — and every plain miss paid an O(n)
    // synchronous scan of the whole blob dir on the request thread.
    if (opts?.prefix !== true) return undefined;
    let best: { file: string; key: string; createdAt: number } | undefined;
    for (const entry of readBlobDir(project)) {
      if (!entry.key.startsWith(key)) continue;
      if (best === undefined || entry.createdAt > best.createdAt) {
        best = entry;
      }
    }
    if (best === undefined) return undefined;
    const blobPath = join(cacheDir(project), `${best.file}.blob`);
    try {
      return { blob: readFileSync(blobPath), key: best.key };
    } catch {
      return undefined;
    }
  };

  // --- snapshots ---

  const snapshotPath = (project: string, runId: string): string =>
    join(
      projectDir(join(dataDir, "snapshots"), project),
      `${encodeURIComponent(runId)}.json`,
    );

  const putSnapshot = (project: string, runId: string, body: string): void => {
    const dir = projectDir(join(dataDir, "snapshots"), project);
    mkdirSync(dir, { recursive: true });
    writeFileSync(snapshotPath(project, runId), body, { mode: 0o600 });
  };

  const getSnapshot = (project: string, runId: string): string | undefined => {
    try {
      return readFileSync(snapshotPath(project, runId), "utf8");
    } catch {
      return undefined;
    }
  };

  const deleteSnapshot = (project: string, runId: string): boolean => {
    try {
      unlinkSync(snapshotPath(project, runId));
      return true;
    } catch {
      return false;
    }
  };

  // --- runs (sqlite index) ---

  const insertStmt = db.prepare(
    `INSERT OR REPLACE INTO runs
     (run_id, project, entry, status, started_at, duration_ms,
      finding_counts, verdict, uploaded_at, report_json, findings_json)
     VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
  );

  const insertRun = (input: RunInsert): HubStoredRun => {
    const runId =
      input.runId !== undefined && isValidRunId(input.runId)
        ? input.runId
        : randomUUID();
    const report = input.report;
    const data =
      typeof report["data"] === "object" && report["data"] !== null
        ? (report["data"] as Record<string, unknown>)
        : {};
    const status =
      typeof data["status"] === "string" ? data["status"] : "unknown";
    const durationMs =
      typeof report["durationMs"] === "number"
        ? report["durationMs"]
        : typeof data["durationMs"] === "number"
          ? data["durationMs"]
          : null;
    const uploadedAt = Date.now();
    // The report payload has no startedAt — approximate it from upload
    // time minus duration when a duration is known.
    const startedAt = durationMs === null ? null : uploadedAt - durationMs;
    const bySeverity: Record<string, number> = {};
    for (const f of input.findings) {
      const sev =
        typeof f === "object" && f !== null
          ? (f as { severity?: unknown }).severity
          : undefined;
      if (typeof sev === "string") {
        bySeverity[sev] = (bySeverity[sev] ?? 0) + 1;
      }
    }
    const findingCounts = JSON.stringify({
      total: input.findings.length,
      bySeverity,
    });
    const verdict =
      typeof data["verdict"] === "string" ? data["verdict"] : null;
    const reportJson = JSON.stringify(report);
    const findingsJson = JSON.stringify(input.findings);
    insertStmt.run(
      runId,
      input.project,
      input.entry,
      status,
      startedAt,
      durationMs,
      findingCounts,
      verdict,
      uploadedAt,
      reportJson,
      findingsJson,
    );
    return {
      runId,
      project: input.project,
      entry: input.entry,
      status,
      startedAt,
      durationMs,
      findingCounts,
      policyVerdict: verdict,
      uploadedAt,
      reportJson,
      findingsJson,
    };
  };

  const listRuns = (query: RunListQuery): HubStoredRun[] => {
    const clauses: string[] = [];
    const params: (string | number | null)[] = [];
    if (query.project !== undefined) {
      clauses.push("project = ?");
      params.push(query.project);
    }
    if (query.before !== undefined) {
      clauses.push("uploaded_at < ?");
      params.push(query.before);
    }
    const limit = Math.min(Math.max(query.limit ?? 50, 1), 200);
    const where = clauses.length === 0 ? "" : `WHERE ${clauses.join(" AND ")}`;
    const rows = db
      .prepare(
        `SELECT run_id, project, entry, status, started_at, duration_ms,
                finding_counts, verdict, uploaded_at
         FROM runs ${where} ORDER BY uploaded_at DESC LIMIT ?`,
      )
      .all(...params, limit) as unknown as Record<string, unknown>[];
    return rows.map(rowToSummary);
  };

  const getRun = (runId: string): HubStoredRun | undefined => {
    const row = db.prepare("SELECT * FROM runs WHERE run_id = ?").get(runId) as
      Record<string, unknown> | undefined;
    if (row === undefined) return undefined;
    return {
      runId: row["run_id"] as string,
      project: row["project"] as string,
      entry: row["entry"] as string,
      status: row["status"] as string,
      startedAt: (row["started_at"] as number | null) ?? null,
      durationMs: (row["duration_ms"] as number | null) ?? null,
      findingCounts: row["finding_counts"] as string,
      policyVerdict: (row["verdict"] as string | null) ?? null,
      uploadedAt: row["uploaded_at"] as number,
      reportJson: row["report_json"] as string,
      findingsJson: row["findings_json"] as string,
    };
  };

  const listProjects = (): string[] => {
    const rows = db
      .prepare("SELECT DISTINCT project FROM runs ORDER BY project")
      .all() as { project: string }[];
    return rows.map((r) => r.project);
  };

  /**
   * Flaky-step aggregation: per-step success rate across the last N runs
   * of a project. Success = "succeeded" | "cache-hit"; the denominator
   * counts only runs where the step actually produced a verdict (skipped
   * and cancelled steps are excluded).
   */
  const flaky = (
    project: string,
    opts?: {
      n?: number | undefined;
      steps?: readonly string[] | undefined;
    },
  ): FlakyRow[] => {
    const n = Math.min(Math.max(opts?.n ?? 20, 1), 100);
    const rows = db
      .prepare(
        `SELECT report_json FROM runs WHERE project = ?
         ORDER BY uploaded_at DESC LIMIT ?`,
      )
      .all(project, n) as { report_json: string }[];
    const wanted = opts?.steps !== undefined ? new Set(opts.steps) : null;
    const stats = new Map<string, { ok: number; total: number }>();
    for (const row of rows) {
      let report: Record<string, unknown>;
      try {
        report = JSON.parse(row.report_json) as Record<string, unknown>;
      } catch {
        continue;
      }
      const data = report["data"];
      const steps =
        typeof data === "object" && data !== null
          ? (data as { steps?: readonly unknown[] }).steps
          : undefined;
      if (!Array.isArray(steps)) continue;
      for (const step of steps) {
        if (typeof step !== "object" || step === null) continue;
        const { stepId, status } = step as {
          stepId?: unknown;
          status?: unknown;
        };
        if (typeof stepId !== "string" || typeof status !== "string") {
          continue;
        }
        if (wanted !== null && !wanted.has(stepId)) continue;
        if (
          status !== "succeeded" &&
          status !== "failed" &&
          status !== "cache-hit"
        ) {
          continue;
        }
        const s = stats.get(stepId) ?? { ok: 0, total: 0 };
        s.total += 1;
        if (status !== "failed") s.ok += 1;
        stats.set(stepId, s);
      }
    }
    return [...stats.entries()]
      .map(([stepId, s]) => ({
        stepId,
        successRate: s.total === 0 ? 0 : s.ok / s.total,
        runs: s.total,
      }))
      .sort((a, b) => a.successRate - b.successRate);
  };

  return {
    dataDir,
    putBlob,
    getBlob,
    putSnapshot,
    getSnapshot,
    deleteSnapshot,
    insertRun,
    listRuns,
    getRun,
    listProjects,
    flaky,
    close: () => {
      try {
        db.close();
      } catch {
        // already closed
      }
    },
  };
}

export type HubStore = ReturnType<typeof createHubStore>;

function rowToSummary(row: Record<string, unknown>): HubStoredRun {
  return {
    runId: row["run_id"] as string,
    project: row["project"] as string,
    entry: row["entry"] as string,
    status: row["status"] as string,
    startedAt: (row["started_at"] as number | null) ?? null,
    durationMs: (row["duration_ms"] as number | null) ?? null,
    findingCounts: row["finding_counts"] as string,
    policyVerdict: (row["verdict"] as string | null) ?? null,
    uploadedAt: row["uploaded_at"] as number,
    reportJson: "",
    findingsJson: "[]",
  };
}
