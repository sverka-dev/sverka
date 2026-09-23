/**
 * Apply local patches to the vendored nx.ts submodule.
 *
 * The submodule is pinned to a specific SHA of nx-devkit/nx.ts. These fixes
 * are needed for Nx to load the plugins correctly but are not yet committed
 * upstream. This script applies them idempotently after `git submodule update
 * --init` so that `build:nx-plugins` builds patched source.
 *
 * Patches:
 * 1. package.json exports: point `default` at dist/*.mjs (Node can't strip
 *    types from src/*.ts under node_modules)
 * 2. shouldSkipPath: skip `vendor/` so plugins don't scan files inside the
 *    submodule itself
 * 3. createNodesV2: use projectRoot as the key in the projects map (Nx
 *    expects project root, not injective project name)
 * 4. build executor: use --project/--out-dir to match local compiler CLI
 * 5. executors.json: add .mjs extension for ESM resolution
 *
 * Once these are upstreamed and the submodule pointer is updated, this
 * script can be deleted.
 */
import {
  closeSync,
  existsSync,
  ftruncateSync,
  openSync,
  readFileSync,
  writeSync,
} from "node:fs";
import { resolve } from "node:path";

const REPO_ROOT = resolve(import.meta.dirname, "..");
const SUBMODULE = resolve(REPO_ROOT, "vendor/nx.ts");

const PKGS = [
  { dir: "packages/skill", name: "@nx-devkit/skill" },
  { dir: "packages/skillspector", name: "@nx-devkit/skillspector" },
  { dir: "packages/typescript-preset", name: "@nx-devkit/typescript" },
  {
    dir: "packages/prepare-for-release",
    name: "@nx-devkit/prepare-for-release",
  },
] as const;

function patchFile(
  path: string,
  check: (content: string) => boolean,
  apply: (content: string) => string,
): void {
  // Single open fd for read + write — no check-then-act window (CodeQL js/file-system-race).
  let fd: number;
  try {
    fd = openSync(path, "r+");
  } catch {
    console.warn(`  ! not found: ${path}`);
    return;
  }
  try {
    const original = readFileSync(fd, "utf8");
    if (check(original)) {
      console.log(`  ✓ already patched: ${path}`);
      return;
    }
    const patched = apply(original);
    if (!check(patched)) {
      throw new Error(
        `patch did not apply cleanly: ${path} — vendored source may have changed`,
      );
    }
    ftruncateSync(fd, 0);
    writeSync(fd, patched, 0, "utf8");
    console.log(`  ✓ patched: ${path}`);
  } finally {
    closeSync(fd);
  }
}

function main(): void {
  if (!existsSync(SUBMODULE)) {
    console.error(`vendor/nx.ts not found — run: git submodule update --init`);
    process.exit(1);
  }

  console.log("Applying submodule patches...");

  for (const pkg of PKGS) {
    const pkgDir = resolve(SUBMODULE, pkg.dir);

    // Patch 1: package.json exports — dist instead of src for default.
    // JSON transform: upstream formatting may vary (single- or multi-line).
    const pkgJsonPath = resolve(pkgDir, "package.json");
    patchFile(
      pkgJsonPath,
      (c) =>
        c.includes('"./dist/index.mjs"') || c.includes('"./dist/plugin.mjs"'),
      (c) => {
        let manifest: {
          main?: string;
          module?: string;
          types?: string;
          exports?: Record<string, unknown>;
          [k: string]: unknown;
        };
        try {
          manifest = JSON.parse(c);
        } catch (err) {
          throw new Error(
            `Invalid JSON in ${pkgJsonPath}: ${err instanceof Error ? err.message : String(err)}`,
          );
        }
        // typescript-preset's entry is plugin.ts; the others use index.ts
        const entry = pkg.name === "@nx-devkit/typescript" ? "plugin" : "index";
        manifest.main = `./dist/${entry}.mjs`;
        manifest.module = `./dist/${entry}.mjs`;
        manifest.types = `./dist/${entry}.d.mts`;
        manifest.exports = {
          ".": {
            "@nx/nx-source": `./src/${entry}.ts`,
            types: `./dist/${entry}.d.mts`,
            default: `./dist/${entry}.mjs`,
          },
          "./plugin": {
            "@nx/nx-source": "./src/plugin.ts",
            types: "./dist/plugin.d.mts",
            default: "./dist/plugin.mjs",
          },
          ...(pkg.name === "@nx-devkit/typescript"
            ? {
                "./generators/init": {
                  types: "./dist/generators/init/generator.d.mts",
                  default: "./dist/generators/init/generator.mjs",
                },
              }
            : {}),
          "./package.json": "./package.json",
        };
        return `${JSON.stringify(manifest, null, 2)}\n`;
      },
    );
  }

  // Patch 2 & 3: plugin.ts — vendor skip + project root key.
  for (const pkg of [PKGS[0], PKGS[1]]) {
    const pkgDir = resolve(SUBMODULE, pkg.dir);
    const pluginPath = resolve(pkgDir, "src/plugin.ts");
    if (pkg.name === "@nx-devkit/skill") {
      patchFile(
        pluginPath,
        (c) =>
          c.includes("rel.startsWith('vendor/')") &&
          c.includes("[projectRoot]:"),
        (c) => {
          if (!c.includes("rel.startsWith('vendor/')")) {
            c = c.replace(
              "if (rel.includes('node_modules')) {\n    return true\n  }",
              "if (rel.includes('node_modules')) {\n    return true\n  }\n\n  if (rel.startsWith('vendor/')) {\n    return true\n  }",
            );
          }
          c = c.replace(
            /projects:[^\S\n]*\{[^\S\n]*\n[^\S\n]*\[projectName\]:[^\S\n]*\{[^\S\n]*\n[^\S\n]*targets,/,
            "projects: {\n              [projectRoot]: {\n                name: projectName,\n                root: projectRoot,\n                targets,",
          );
          return c;
        },
      );

      // Patch 4: build executor — use --project/--out-dir to match local compiler CLI
      const executorPath = resolve(pkgDir, "src/executors/build/executor.ts");
      patchFile(
        executorPath,
        (c) => c.includes("'--project'") && c.includes("'--out-dir'"),
        (c) =>
          c
            .replace("'--out',", "'--out-dir',")
            .replace("'--skill',", "'--project',"),
      );
    } else {
      patchFile(
        pluginPath,
        (c) =>
          c.includes("projectRoot.startsWith('vendor/')") &&
          c.includes("[projectRoot]: project"),
        (c) => {
          if (!c.includes("projectRoot.startsWith('vendor/')")) {
            c = c.replace(
              "if (projectRoot.split('/').includes('..')) return true",
              "if (projectRoot.startsWith('vendor/')) return true\n  if (projectRoot.split('/').includes('..')) return true",
            );
          }
          c = c.replace(
            /const project:[^\S\n]*ProjectConfiguration[^\S\n]*=[^\S\n]*\{[^\S\n]*\n[^\S\n]*root:/,
            "const project: ProjectConfiguration = {\n        name: projectName,\n        root:",
          );
          c = c.replace("[projectName]: project,", "[projectRoot]: project,");
          return c;
        },
      );
    }
  }

  // Patch 5: executors.json — add .mjs extension for ESM resolution
  const EXECUTOR_PATCHES = [
    ["packages/skill/executors.json", '"./dist/executors/build/executor"'],
    [
      "packages/skillspector/executors.json",
      '"./dist/executors/scan/executor"',
    ],
    [
      "packages/prepare-for-release/executors.json",
      '"./dist/executors/publish-placeholder/executor"',
    ],
  ] as const;
  for (const [rel, bare] of EXECUTOR_PATCHES) {
    patchFile(
      resolve(SUBMODULE, rel),
      (c) => c.includes(`${bare.slice(0, -1)}.mjs"`),
      (c) => c.replace(bare, `${bare.slice(0, -1)}.mjs"`),
    );
  }

  console.log("Submodule patches applied.");
}

main();
