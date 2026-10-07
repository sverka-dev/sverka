// --watch supervisor tests (Spec 53.2).
// Debounce, in-flight coalescing, failure resilience, abort — all against
// a real chokidar watcher on a temp dir, with an injectable run counter.

import { describe, it, expect, afterEach } from "vitest";
import { writeFile } from "node:fs/promises";
import { join } from "node:path";
import { watchLoop } from "../internal/watch.js";
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
});
