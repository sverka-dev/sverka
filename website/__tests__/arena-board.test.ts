import { describe, it, expect, afterEach } from "bun:test";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { generateBoard } from "../scripts/update-arena-board";

let dir: string | undefined;
afterEach(() => {
  if (dir) fs.rmSync(dir, { recursive: true, force: true });
  dir = undefined;
});

const HASH = "a".repeat(64);

function writeResult(
  regDir: string,
  runId: string,
  day: string,
  extra: Record<string, unknown> = {},
): void {
  const rel = path.join(regDir, "results/node-ci/devin", day);
  fs.mkdirSync(rel, { recursive: true });
  fs.writeFileSync(
    path.join(rel, `${runId}.json`),
    JSON.stringify({
      schema: "arena.result/v1",
      runId,
      pack: "node-ci",
      agent: "devin",
      model: "m1",
      plugins: [],
      sverkaVersion: "0.9.0",
      startedAt: `${day}T00:00:00.000Z`,
      tasks: [
        {
          task: "lint-fix",
          promptHash: HASH,
          score: { passed: true, findings: 0 },
          metrics: { tokens: 100, durationMs: 1000 },
        },
      ],
      ...extra,
    }),
  );
}

describe("generateBoard", () => {
  it("renders a static leaderboard from a fixture registry", async () => {
    dir = fs.mkdtempSync(path.join(os.tmpdir(), "arena-board-"));
    const regDir = path.join(dir, "registry");
    writeResult(regDir, "r1", "2026-10-01");
    writeResult(regDir, "r2", "2026-10-02");
    const out = path.join(dir, "board.html");
    const { cohorts, runs } = await generateBoard(regDir, out);
    expect(cohorts).toBe(1);
    expect(runs).toBe(2);
    const html = fs.readFileSync(out, "utf-8");
    expect(html).toContain("<!doctype html>");
    expect(html).toContain("node-ci");
    expect(html).toContain("lint-fix");
    expect(html).toContain("devin");
    expect(html).not.toContain("<script");
  });

  it("renders the no-data state for an empty registry", async () => {
    dir = fs.mkdtempSync(path.join(os.tmpdir(), "arena-board-empty-"));
    const out = path.join(dir, "board.html");
    const { cohorts } = await generateBoard(path.join(dir, "reg"), out);
    expect(cohorts).toBe(0);
    expect(fs.readFileSync(out, "utf-8")).toContain("no arena results");
  });
});
