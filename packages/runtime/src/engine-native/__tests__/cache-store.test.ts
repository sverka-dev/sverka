import { describe, it, expect, beforeEach, afterEach } from "vitest";
import { mkdtemp, rm, readFile, writeFile, mkdir } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { createFileCacheStore } from "../cache-store.js";

describe("FileCacheStore", () => {
  let cacheDir: string;
  let workDir: string;

  beforeEach(async () => {
    cacheDir = await mkdtemp(join(tmpdir(), "sverka-cache-"));
    workDir = await mkdtemp(join(tmpdir(), "sverka-cache-ws-"));
  });

  afterEach(async () => {
    await rm(cacheDir, { recursive: true, force: true });
    await rm(workDir, { recursive: true, force: true });
  });

  it("store then restore round-trip returns the primary key and restores paths", async () => {
    const store = createFileCacheStore({ cacheDir });
    const sourceDir = join(workDir, "src");
    await mkdir(join(sourceDir, "dist"), { recursive: true });
    await writeFile(join(sourceDir, "dist", "out.txt"), "built-content");

    await store.store({
      key: "build-key-1",
      paths: ["dist"],
      sourceDir,
    });

    const targetDir = join(workDir, "target");
    await mkdir(targetDir, { recursive: true });
    const result = await store.restore({
      key: "build-key-1",
      restoreKeys: [],
      paths: ["dist"],
      targetDir,
    });

    expect(result).toBeDefined();
    expect(result?.key).toBe("build-key-1");
    const restored = await readFile(join(targetDir, "dist", "out.txt"), "utf-8");
    expect(restored).toBe("built-content");
  });

  it("restore returns undefined on a miss (unknown key)", async () => {
    const store = createFileCacheStore({ cacheDir });
    const targetDir = join(workDir, "target");
    await mkdir(targetDir, { recursive: true });
    const result = await store.restore({
      key: "unknown-key",
      restoreKeys: [],
      paths: ["dist"],
      targetDir,
    });
    expect(result).toBeUndefined();
  });

  it("restore falls back to restoreKeys (prefix match); primary-key hit preferred", async () => {
    const store = createFileCacheStore({ cacheDir });

    // Seed a cache entry under a different (prefix-matching) key.
    const sourceDir = join(workDir, "src");
    await mkdir(join(sourceDir, "dist"), { recursive: true });
    await writeFile(join(sourceDir, "dist", "out.txt"), "prefix-content");
    await store.store({
      key: "build-linux-v1",
      paths: ["dist"],
      sourceDir,
    });

    const targetDir = join(workDir, "target");
    await mkdir(targetDir, { recursive: true });

    // Primary key miss, restoreKey prefix match.
    const result = await store.restore({
      key: "build-linux-v2",
      restoreKeys: ["build-linux-"],
      paths: ["dist"],
      targetDir,
    });
    expect(result).toBeDefined();
    expect(result?.key).toBe("build-linux-v1");
    const restored = await readFile(join(targetDir, "dist", "out.txt"), "utf-8");
    expect(restored).toBe("prefix-content");
  });

  it("primary-key hit is preferred over restoreKey hit", async () => {
    const store = createFileCacheStore({ cacheDir });

    // Seed two entries: a prefix-matching one and an exact primary one.
    const srcA = join(workDir, "srcA");
    await mkdir(join(srcA, "dist"), { recursive: true });
    await writeFile(join(srcA, "dist", "out.txt"), "prefix-A");
    await store.store({ key: "build-linux-v1", paths: ["dist"], sourceDir: srcA });

    const srcB = join(workDir, "srcB");
    await mkdir(join(srcB, "dist"), { recursive: true });
    await writeFile(join(srcB, "dist", "out.txt"), "primary-B");
    await store.store({ key: "build-linux-v2", paths: ["dist"], sourceDir: srcB });

    const targetDir = join(workDir, "target");
    await mkdir(targetDir, { recursive: true });
    const result = await store.restore({
      key: "build-linux-v2",
      restoreKeys: ["build-linux-"],
      paths: ["dist"],
      targetDir,
    });
    expect(result?.key).toBe("build-linux-v2");
    const restored = await readFile(join(targetDir, "dist", "out.txt"), "utf-8");
    expect(restored).toBe("primary-B");
  });

  it("restore throw → returns undefined (treated as miss, non-fatal)", async () => {
    // Use a cacheDir that cannot be read (pointing at a file, not a dir).
    const badDir = join(workDir, "notadir");
    await writeFile(badDir, "x");
    const store = createFileCacheStore({ cacheDir: badDir });
    const targetDir = join(workDir, "target");
    await mkdir(targetDir, { recursive: true });
    const result = await store.restore({
      key: "any",
      restoreKeys: [],
      paths: ["dist"],
      targetDir,
    });
    expect(result).toBeUndefined();
  });

  it("store throw → rejects (caller wraps as non-fatal)", async () => {
    const badDir = join(workDir, "notadir2");
    await writeFile(badDir, "x");
    const store = createFileCacheStore({ cacheDir: badDir });
    const sourceDir = join(workDir, "src");
    await mkdir(join(sourceDir, "dist"), { recursive: true });
    await writeFile(join(sourceDir, "dist", "out.txt"), "x");
    await expect(
      store.store({ key: "any", paths: ["dist"], sourceDir }),
    ).rejects.toThrow();
  });
});
