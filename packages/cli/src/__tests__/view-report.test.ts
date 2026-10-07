// Spec 53 — bare `sverka view` (interactive terminal, no input) resolves
// the newest .sverka/runs/<runId>/report.html and opens it in the system
// browser.

import { describe, it, expect, beforeEach, afterEach, vi } from "vitest";

vi.mock("node:child_process", async (importOriginal) => {
  const actual = await importOriginal<typeof import("node:child_process")>();
  return { ...actual, spawnSync: vi.fn() };
});

import { spawnSync } from "node:child_process";
import { utimesSync } from "node:fs";
import { join } from "node:path";
import { main } from "../index.js";
import {
  makeTempDir,
  cleanupTempDir,
  CaptureWriter,
  writefile,
} from "./helpers/fixtures.js";

const mockedSpawnSync = vi.mocked(spawnSync);

/** Force the interactive branch — vitest stdin is never a TTY. */
let stdinIsTTY: PropertyDescriptor | undefined;
function stubInteractiveStdin(): void {
  stdinIsTTY = Object.getOwnPropertyDescriptor(process.stdin, "isTTY");
  Object.defineProperty(process.stdin, "isTTY", {
    value: true,
    configurable: true,
  });
}
function restoreStdin(): void {
  if (stdinIsTTY !== undefined) {
    Object.defineProperty(process.stdin, "isTTY", stdinIsTTY);
  } else {
    delete (process.stdin as { isTTY?: boolean }).isTTY;
  }
}

async function fakeRunReport(
  dir: string,
  runId: string,
  mtime: Date,
): Promise<string> {
  const path = join(dir, ".sverka", "runs", runId, "report.html");
  await writefile(
    dir,
    join(".sverka", "runs", runId, "report.html"),
    "<html/>",
  );
  utimesSync(path, mtime, mtime);
  return path;
}

describe("view command — latest run report (spec 53)", () => {
  let dir: string;

  beforeEach(async () => {
    dir = await makeTempDir("sverka-view-report-");
    stubInteractiveStdin();
    mockedSpawnSync.mockReset();
    mockedSpawnSync.mockReturnValue({
      status: 0,
      error: undefined,
    } as unknown as ReturnType<typeof spawnSync>);
  });

  afterEach(async () => {
    restoreStdin();
    await cleanupTempDir(dir);
  });

  it("opens the newest .sverka/runs/<runId>/report.html in a browser", async () => {
    await fakeRunReport(dir, "run-a", new Date("2026-01-01"));
    const newer = await fakeRunReport(dir, "run-b", new Date("2026-02-01"));

    const out = new CaptureWriter();
    const code = await main(["view", "--root", dir], { output: out });

    expect(code).toBe(0);
    expect(out.stdoutText).toContain(`report: ${newer}`);
    expect(mockedSpawnSync).toHaveBeenCalledWith(
      expect.any(String),
      expect.arrayContaining([newer]),
      expect.anything(),
    );
  });

  it("skips run dirs without report.html and picks the newest that has one", async () => {
    const older = await fakeRunReport(dir, "run-a", new Date("2026-01-01"));
    // Newest run dir lacks report.html (e.g. HTML write failed) — resolve
    // falls back to the next report-bearing run.
    await writefile(dir, join(".sverka", "runs", "run-b", "report.json"), "{}");

    const out = new CaptureWriter();
    const code = await main(["view", "--root", dir], { output: out });

    expect(code).toBe(0);
    expect(out.stdoutText).toContain(`report: ${older}`);
  });

  it("exits UsageError when no run report exists", async () => {
    const out = new CaptureWriter();
    const code = await main(["view", "--root", dir], { output: out });

    expect(code).toBe(2);
    expect(out.stderrText).toContain("no run report found");
    expect(mockedSpawnSync).not.toHaveBeenCalled();
  });

  it("warns but exits 0 when no browser opener succeeds", async () => {
    const report = await fakeRunReport(dir, "run-a", new Date("2026-01-01"));
    mockedSpawnSync.mockReturnValue({
      status: 1,
      error: undefined,
    } as unknown as ReturnType<typeof spawnSync>);

    const out = new CaptureWriter();
    const code = await main(["view", "--root", dir], { output: out });

    expect(code).toBe(0);
    expect(out.stdoutText).toContain(`report: ${report}`);
    expect(out.stderrText).toContain("could not open a browser");
  });
});
