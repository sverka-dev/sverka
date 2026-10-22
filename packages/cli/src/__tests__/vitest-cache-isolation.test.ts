// Regression check for sv-6ers — the root cause behind sv-87qf: the
// packages that run in parallel must not share a mutable vitest cache.
//
// Vitest 5 keeps transformed modules in <workspaceRoot>/node_modules/
// .vitest-cache — one directory for the whole repo, whichever package
// starts the run. At startup every vitest process compares the lockfile
// hash recorded in _metadata.json with the current one and, when they
// differ, rm -rf's that shared directory. The nx fan-out starts every
// package's vitest at once, so several processes reset the same directory
// simultaneously: one recreates it while another is still removing it and
// the run dies before a single test executes —
//
//   Startup Error: ENOTEMPTY: directory not empty, rmdir
//     '…/node_modules/.vitest-cache'
//
// That is how the dogfood run 5edd6b36 lost ci/test: runtime:test and
// workflow:test were both dead on arrival. PR #412 disabled the cache in
// every package config; this check keeps it disabled.
//
// The check starts one vitest process per package at the same time — the
// same shape as `nx run-many --target=test --all` — against a throwaway
// workspace whose fs module cache is poisoned with a stale lockfile hash.
// Every process must start cleanly and none of them may clear the shared
// cache directory.

import { describe, it, expect } from "vitest";
import { spawn } from "node:child_process";
import { mkdir, mkdtemp, readFile, readdir, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join, resolve } from "node:path";
import { fileURLToPath } from "node:url";

const REPO_ROOT = resolve(
  fileURLToPath(import.meta.url),
  "..",
  "..",
  "..",
  "..",
  "..",
);

interface PackageRun {
  readonly package: string;
  readonly code: number | null;
  readonly output: string;
}

/** Vitest inherits the parent's worker env — a nested run must not see it. */
function childEnv(): NodeJS.ProcessEnv {
  const env: NodeJS.ProcessEnv = {};
  for (const [key, value] of Object.entries(process.env)) {
    if (value !== undefined && !key.startsWith("VITEST")) env[key] = value;
  }
  return env;
}

/**
 * Start one package's vitest against the given workspace root.
 *
 * `--root` points vitest at the throwaway workspace, so the fs module cache
 * it would use is the workspace's own (shared by every package started the
 * same way). The config is the package's real one — the check is about what
 * the repo ships, not about a synthetic config.
 */
function startVitest(
  pkg: string,
  workspace: string,
): Promise<PackageRun> {
  const { promise, resolve, reject } = Promise.withResolvers<PackageRun>();
  const child = spawn(
    "bun",
    [
      "run",
      "vitest",
      "run",
      "--root",
      workspace,
      "--config",
      join(REPO_ROOT, "packages", pkg, "vitest.config.ts"),
      // No test file matches the filter: the run exercises the startup
      // path (where the cache reset happens) and nothing else.
      "--passWithNoTests",
      "__no_such_test_file__",
    ],
    {
      cwd: join(REPO_ROOT, "packages", pkg),
      env: childEnv(),
      stdio: ["ignore", "pipe", "pipe"],
    },
  );
  let output = "";
  child.stdout.on("data", (chunk: Buffer) => {
    output += chunk.toString();
  });
  child.stderr.on("data", (chunk: Buffer) => {
    output += chunk.toString();
  });
  child.on("error", reject);
  child.on("close", (code) => {
    resolve({ package: pkg, code, output });
  });
  return promise;
}

/** Every package that ships a vitest config. */
async function packagesWithVitestConfig(): Promise<string[]> {
  const entries = await readdir(join(REPO_ROOT, "packages"), {
    withFileTypes: true,
  });
  const names: string[] = [];
  for (const entry of entries) {
    if (!entry.isDirectory()) continue;
    const files = await readdir(join(REPO_ROOT, "packages", entry.name));
    if (files.includes("vitest.config.ts")) names.push(entry.name);
  }
  return names.sort();
}

describe("vitest fs module cache isolation", () => {
  it("keeps parallel package startups off a shared cache directory", async () => {
    const packages = await packagesWithVitestConfig();
    // Guard against a discovery bug silently making the check vacuous.
    expect(packages.length).toBeGreaterThanOrEqual(10);

    const workspace = await mkdtemp(join(tmpdir(), "sverka-vitest-isolation-"));
    try {
      // A package.json with "workspaces" stops vite's workspace-root search
      // here, so every child resolves its fs module cache to
      // <workspace>/node_modules/.vitest-cache — one shared directory.
      await writeFile(
        join(workspace, "package.json"),
        JSON.stringify({
          name: "vitest-isolation",
          private: true,
          workspaces: [],
        }),
      );
      const cacheDir = join(workspace, "node_modules", ".vitest-cache");
      await mkdir(cacheDir, { recursive: true });
      // A stale lockfile hash: every child sees a mismatch and tries to
      // reset the shared cache at startup.
      await writeFile(
        join(cacheDir, "_metadata.json"),
        JSON.stringify({ lockfileHash: "stale-deadbeef" }),
      );
      // The marker survives only if no child cleared the directory.
      const marker = join(cacheDir, "marker.txt");
      await writeFile(marker, "keep me");

      const runs = await Promise.all(
        packages.map((pkg) => startVitest(pkg, workspace)),
      );

      for (const run of runs) {
        expect(
          run.output,
          `${run.package} must not fail its vitest startup`,
        ).not.toContain("ENOTEMPTY");
        expect(
          run.output,
          `${run.package} must not report a startup error`,
        ).not.toContain("Startup Error");
        expect(run.code, `${run.package} must exit cleanly`).toBe(0);
      }

      // The shared cache directory is untouched — no package resets it.
      const markerContent = await readFile(marker, "utf-8").catch(() => null);
      expect(
        markerContent,
        "a package vitest startup cleared the shared fs module cache",
      ).toBe("keep me");
    } finally {
      await rm(workspace, { recursive: true, force: true });
    }
  }, 120000);
});
