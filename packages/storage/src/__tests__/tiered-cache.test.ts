// createTieredCacheStore — local/remote composition + degradation.

import { describe, it, expect, beforeEach, afterEach } from "vitest";
import { mkdtemp, rm, writeFile, mkdir, readFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { createFileCacheStore } from "@sverka/runtime";
import type { CacheStore } from "@sverka/runtime";
import { createTieredCacheStore } from "../tiered-cache.js";

function failingStore(label: string): CacheStore {
  return {
    async restore() {
      throw new Error(`${label} down`);
    },
    async store() {
      throw new Error(`${label} down`);
    },
  };
}

describe("createTieredCacheStore", () => {
  let dir: string;
  beforeEach(async () => {
    dir = await mkdtemp(join(tmpdir(), "sverka-tiered-"));
  });
  afterEach(async () => {
    await rm(dir, { recursive: true, force: true });
  });

  const seed = async (store: CacheStore, key = "k1") => {
    const src = join(dir, "src");
    await mkdir(src, { recursive: true });
    await writeFile(join(src, "a.txt"), "alpha");
    await store.store({ key, paths: ["a.txt"], sourceDir: src });
  };

  it("local hit wins — remote never consulted", async () => {
    const local = createFileCacheStore({ cacheDir: join(dir, "local") });
    await seed(local);
    let remoteCalls = 0;
    const remote: CacheStore = {
      restore: () => {
        remoteCalls++;
        return Promise.resolve(undefined);
      },
      store: () => Promise.resolve(),
    };
    const store = createTieredCacheStore({ local, remote });
    const hit = await store.restore({
      key: "k1",
      restoreKeys: [],
      paths: ["a.txt"],
      targetDir: join(dir, "dst"),
    });
    expect(hit).toEqual({ key: "k1" });
    expect(remoteCalls).toBe(0);
  });

  it("local miss → remote hit → write-through back to local", async () => {
    const remoteDir = join(dir, "remote-fs");
    const remote = createFileCacheStore({ cacheDir: remoteDir });
    await seed(remote);
    const local = createFileCacheStore({ cacheDir: join(dir, "local") });
    const store = createTieredCacheStore({ local, remote });

    const dst = join(dir, "dst");
    const hit = await store.restore({
      key: "k1",
      restoreKeys: [],
      paths: ["a.txt"],
      targetDir: dst,
    });
    expect(hit).toEqual({ key: "k1" });
    expect(await readFile(join(dst, "a.txt"), "utf8")).toBe("alpha");

    // Write-back happened: a remote that now throws must not matter.
    const broken = createTieredCacheStore({
      local,
      remote: failingStore("remote"),
    });
    const second = await broken.restore({
      key: "k1",
      restoreKeys: [],
      paths: ["a.txt"],
      targetDir: join(dir, "dst2"),
    });
    expect(second).toEqual({ key: "k1" });
  });

  it("remote failure → miss + single remote.cache-unreachable warn", async () => {
    const warns: string[] = [];
    const store = createTieredCacheStore({
      local: createFileCacheStore({ cacheDir: join(dir, "local") }),
      remote: failingStore("remote"),
      onWarn: (m) => warns.push(m),
    });
    const req = {
      key: "k",
      restoreKeys: [],
      paths: ["a.txt"],
      targetDir: join(dir, "dst"),
    };
    expect(await store.restore(req)).toBeUndefined();
    expect(await store.restore(req)).toBeUndefined();
    expect(
      warns.filter((w) => w.includes("remote.cache-unreachable")),
    ).toHaveLength(1);
  });

  it("store writes local + remote; remote failure warns only", async () => {
    const warns: string[] = [];
    const remoteDir = join(dir, "remote-fs");
    const remote = createFileCacheStore({ cacheDir: remoteDir });
    const store = createTieredCacheStore({
      local: createFileCacheStore({ cacheDir: join(dir, "local") }),
      remote,
      onWarn: (m) => warns.push(m),
    });
    const src = join(dir, "src");
    await mkdir(src, { recursive: true });
    await writeFile(join(src, "a.txt"), "alpha");
    await store.store({ key: "k1", paths: ["a.txt"], sourceDir: src });
    // Both sides populated.
    expect(
      await remote.restore({
        key: "k1",
        restoreKeys: [],
        paths: ["a.txt"],
        targetDir: join(dir, "r1"),
      }),
    ).toEqual({ key: "k1" });

    const broken = createTieredCacheStore({
      local: createFileCacheStore({ cacheDir: join(dir, "l2") }),
      remote: failingStore("remote"),
      onWarn: (m) => warns.push(m),
    });
    await expect(
      broken.store({ key: "k2", paths: ["a.txt"], sourceDir: src }),
    ).resolves.toBeUndefined();
    expect(warns.some((w) => w.includes("remote.cache-unreachable"))).toBe(
      true,
    );
  });
});
