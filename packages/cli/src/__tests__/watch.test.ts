// --watch supervisor tests (Spec 53.2).
// Debounce, in-flight coalescing, failure resilience, abort — all against
// a real chokidar watcher on a temp dir, with an injectable run counter.

import { describe, it, expect, afterEach } from "vitest";
import { writeFile } from "node:fs/promises";
import { join } from "node:path";
import { watchLoop } from "../internal/watch.js";
import { runCommand, type RunArgs } from "../commands/run.js";
import { CliError, ExitCode, type GlobalFlags } from "../types.js";
import {
  CaptureWriter,
  makeTempDir,
  cleanupTempDir,
} from "./helpers/fixtures.js";

const dirs: string[] = [];
async function getDir(): Promise<string> {
  const d = await makeTempDir("sverka-watch-test-");
  dirs.push(d);
  return d;
}
afterEach(async () => {
  while (dirs.length) await cleanupTempDir(dirs.pop()!);
});

/** Poll until `cond` holds or `timeoutMs` elapses. */
async function until(cond: () => boolean, timeoutMs = 8000): Promise<void> {
  const deadline = Date.now() + timeoutMs;
  while (!cond()) {
    if (Date.now() > deadline) throw new Error("condition not met in time");
    await new Promise((r) => setTimeout(r, 25));
  }
}

function touchable(dir: string): Promise<void> {
  return writeFile(
    join(dir, "src-file.ts"),
    `// ${Date.now()}${Math.random()}`,
  );
}

describe("watchLoop (spec 53.2)", () => {
  it("runs once on start, then exactly once per debounced change", async () => {
    const dir = await getDir();
    let runs = 0;
    const ac = new AbortController();
    const loop = watchLoop({
      root: dir,
      run: async () => {
        runs++;
        return 0;
      },
      output: new CaptureWriter(),
      signal: ac.signal,
      debounceMs: 50,
    });
    await loop.ready;
    await until(() => runs === 1);
    // Burst of changes → coalesced into ONE re-run.
    await touchable(dir);
    await touchable(dir);
    await touchable(dir);
    await until(() => runs === 2);
    await new Promise((r) => setTimeout(r, 300));
    expect(runs).toBe(2);
    ac.abort();
    await loop.done;
  });

  it("a change during a run triggers exactly one follow-up run", async () => {
    const dir = await getDir();
    let runs = 0;
    let resolveSlow: (() => void) | undefined;
    const ac = new AbortController();
    const loop = watchLoop({
      root: dir,
      run: async () => {
        runs++;
        if (runs === 1) {
          // Slow first run — changes land while it's in flight.
          await new Promise<void>((r) => {
            resolveSlow = r;
          });
        }
        return 0;
      },
      output: new CaptureWriter(),
      signal: ac.signal,
      debounceMs: 30,
    });
    await loop.ready;
    await until(() => runs === 1);
    await touchable(dir);
    await touchable(dir);
    // Keep run #1 in flight past the debounce window so the burst is
    // guaranteed to land in the pending path, not the idle path.
    await new Promise((r) => setTimeout(r, 120));
    resolveSlow!();
    await until(() => runs === 2);
    await new Promise((r) => setTimeout(r, 300));
    expect(runs).toBe(2); // exactly one coalesced re-run
    ac.abort();
    await loop.done;
  });

  it("keeps watching after a failing run (a failure is a result)", async () => {
    const dir = await getDir();
    let runs = 0;
    const ac = new AbortController();
    const out = new CaptureWriter();
    const loop = watchLoop({
      root: dir,
      run: async () => {
        runs++;
        if (runs === 1) throw new Error("run blew up");
        return 1;
      },
      output: out,
      signal: ac.signal,
      debounceMs: 30,
    });
    await loop.ready;
    await until(() => runs === 1);
    expect(out.stderrText).toContain("run failed: run blew up");
    await touchable(dir);
    await until(() => runs === 2);
    ac.abort();
    await loop.done;
  });

  it("keeps watch progress on stderr, stdout clean for --format json", async () => {
    const dir = await getDir();
    const ac = new AbortController();
    const out = new CaptureWriter();
    const loop = watchLoop({
      root: dir,
      run: async () => 0,
      output: out,
      signal: ac.signal,
      debounceMs: 30,
    });
    await loop.ready;
    await until(() => out.stderrText.includes("watch: run #1"));
    expect(out.stdoutText).not.toContain("watch: run");
    ac.abort();
    await loop.done;
  });

  it("abort waits for the in-flight run to settle", async () => {
    const dir = await getDir();
    const ac = new AbortController();
    let release: (() => void) | undefined;
    let runs = 0;
    const loop = watchLoop({
      root: dir,
      run: async () => {
        runs++;
        await new Promise<void>((r) => {
          release = r;
        });
        return 7;
      },
      output: new CaptureWriter(),
      signal: ac.signal,
      debounceMs: 30,
    });
    await loop.ready;
    await until(() => runs === 1);
    ac.abort();
    // done must NOT resolve while the run is still in flight.
    let settled = false;
    void loop.done.then(() => {
      settled = true;
    });
    await new Promise((r) => setTimeout(r, 120));
    expect(settled).toBe(false);
    release!();
    await expect(loop.done).resolves.toBe(7);
  });

  it("ignores .sverka/ churn from its own artifacts", async () => {
    const dir = await getDir();
    let runs = 0;
    const ac = new AbortController();
    const loop = watchLoop({
      root: dir,
      run: async () => {
        runs++;
        return 0;
      },
      output: new CaptureWriter(),
      signal: ac.signal,
      debounceMs: 30,
    });
    await loop.ready;
    await until(() => runs === 1);
    // Artifact writes inside .sverka must not retrigger the loop.
    await writeFile(join(dir, ".sverka", "report.html"), "<html/>").catch(
      async () => {
        const { mkdir } = await import("node:fs/promises");
        await mkdir(join(dir, ".sverka"), { recursive: true });
        await writeFile(join(dir, ".sverka", "report.html"), "<html/>");
      },
    );
    await new Promise((r) => setTimeout(r, 400));
    expect(runs).toBe(1);
    ac.abort();
    await loop.done;
  });

  it("rejects invalid flags before entering the watch loop", async () => {
    const dir = await getDir();
    const out = new CaptureWriter();
    const global: GlobalFlags = {
      format: "text",
      config: null,
      root: dir,
      quiet: false,
      verbose: false,
    };
    // Going through main() can't pin this ordering — dispatchRun rejects
    // bad flags before runCommand is ever reached. Call runCommand
    // directly so the assertion covers validateRunFlags running before
    // the runWatch dispatch. If the guard regressed below the dispatch,
    // these calls enter the watcher and the test times out.
    for (const args of [
      { watch: true, jobs: 0 },
      { watch: true, stepOutputLines: -1 },
    ] satisfies RunArgs[]) {
      const attempt = runCommand(args, global, out, Date.now());
      await expect(attempt).rejects.toThrow(CliError);
      await expect(attempt).rejects.toMatchObject({
        code: "INVALID_FLAG",
        exitCode: ExitCode.UsageError,
      });
    }
  });
});
