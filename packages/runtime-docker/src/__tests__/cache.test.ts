import { describe, it, expect, beforeEach, afterEach } from "vitest";
import { mkdtemp, mkdir, writeFile, readFile, rm, access } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { DockerCacheManager } from "../cache.js";

async function pathExists(p: string): Promise<boolean> {
  try {
    await access(p);
    return true;
  } catch {
    return false;
  }
}

let cacheDir: string;
let sourceDir: string;

beforeEach(async () => {
  cacheDir = await mkdtemp(join(tmpdir(), "sverka-cache-"));
  sourceDir = await mkdtemp(join(tmpdir(), "sverka-src-"));
});

afterEach(async () => {
  await rm(cacheDir, { recursive: true, force: true });
  await rm(sourceDir, { recursive: true, force: true });
});

describe("DockerCacheManager", () => {
  it("prepare creates a cache directory keyed by the declared key", async () => {
    const mgr = new DockerCacheManager(cacheDir);
    const prepared = await mgr.prepare([], "key-1");
    expect(prepared).toBe(join(cacheDir, "key-1"));
    expect(await pathExists(prepared)).toBe(true);
  });

  it("prepare copies declared inputs into the cache directory", async () => {
    await writeFile(join(sourceDir, "input.txt"), "hello");
    const mgr = new DockerCacheManager(cacheDir);
    const prepared = await mgr.prepare(
      [join(sourceDir, "input.txt")],
      "key-2",
    );
    const copied = await readFile(join(prepared, "input.txt"), "utf8");
    expect(copied).toBe("hello");
  });

  it("prepare preserves input directory structure relative to workspace", async () => {
    await mkdir(join(sourceDir, "src"), { recursive: true });
    await writeFile(join(sourceDir, "src", "input.txt"), "hello");
    const mgr = new DockerCacheManager(cacheDir);
    const prepared = await mgr.prepare(
      [join(sourceDir, "src", "input.txt")],
      "key-2-nested",
      sourceDir,
    );
    const copied = await readFile(join(prepared, "src", "input.txt"), "utf8");
    expect(copied).toBe("hello");
  });

  it("collect copies declared outputs back to the persistent cacheDir", async () => {
    // Simulate outputs written in a source dir after execution.
    await mkdir(join(sourceDir, "out"), { recursive: true });
    await writeFile(join(sourceDir, "out", "result.txt"), "result");
    const mgr = new DockerCacheManager(cacheDir);
    await mgr.collect(
      [join(sourceDir, "out", "result.txt")],
      sourceDir,
      ".",
    );
    // collect should copy outputs into cacheDir preserving relative structure.
    const collected = await readFile(
      join(cacheDir, "out", "result.txt"),
      "utf8",
    );
    expect(collected).toBe("result");
  });

  it("rejects cache keys that escape cacheDir", async () => {
    const mgr = new DockerCacheManager(cacheDir);
    await expect(mgr.prepare([], "../outside")).rejects.toThrow(
      /escapes cacheDir/,
    );
  });

  it("rejects cache outputs that escape the sourceDir", async () => {
    await writeFile(join(sourceDir, "result.txt"), "result");
    const mgr = new DockerCacheManager(cacheDir);
    await expect(
      mgr.collect(["../outside.txt"], sourceDir, "."),
    ).rejects.toThrow(/escapes/);
  });

  it("collect skips missing outputs without crashing", async () => {
    await mkdir(join(sourceDir, "out"), { recursive: true });
    await writeFile(join(sourceDir, "out", "found.txt"), "yes");
    const mgr = new DockerCacheManager(cacheDir);
    await expect(
      mgr.collect(
        [join(sourceDir, "out", "found.txt"), join(sourceDir, "out", "missing.txt")],
        sourceDir,
        ".",
      ),
    ).resolves.not.toThrow();
    const collected = await readFile(join(cacheDir, "out", "found.txt"), "utf8");
    expect(collected).toBe("yes");
  });

  it("rejects absolute cache keys", async () => {
    const mgr = new DockerCacheManager(cacheDir);
    await expect(mgr.prepare([], "/tmp/outside")).rejects.toThrow(
      /absolute cache key/,
    );
  });

  it("second prepare with same key restores from cache (inputs exist)", async () => {
    await writeFile(join(sourceDir, "input.txt"), "v1");
    const mgr = new DockerCacheManager(cacheDir);
    await mgr.prepare([join(sourceDir, "input.txt")], "key-3");
    // Remove the source input; second prepare should restore from cache.
    await rm(join(sourceDir, "input.txt"));
    const prepared = await mgr.prepare(
      [join(sourceDir, "input.txt")],
      "key-3",
    );
    // The cached copy should still be present in the prepared dir.
    const restored = await readFile(join(prepared, "input.txt"), "utf8");
    expect(restored).toBe("v1");
  });
});
