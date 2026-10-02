/**
 * Dogfood config — benchmark Devin on this repo's own fixtures, with and
 * without the sverka skill installed. Paths resolve relative to this file.
 *
 * From the repo root:
 *   sverka-arena doctor --config packages/arena/arena.config.ts
 *   sverka-arena run    --config packages/arena/arena.config.ts
 *   sverka-arena report packages/arena/.arena/results.json
 * (paths inside this file resolve relative to the file itself, so the
 * --config path is the only cwd-dependent piece)
 *
 * Consumers should import defineConfig for typechecking:
 *   import { defineConfig } from "@sverka/arena";
 */

// sha256 digests of the ship-package fixture's protected files —
// regenerate with:
//   node -e 'const c=require("node:crypto"),f=require("node:fs");for(const p of [...])console.log(p,c.createHash("sha256").update(f.readFileSync("packages/arena/fixtures/ship-package/"+p)).digest("hex"))'
const SHIP_PACKAGE_DIGESTS: Record<string, string> = {
  ".oxlintrc.json":
    "d06272fc9ae34cf4b506b487953d09d67e9214e4d94df7edcd5bec622c9a1eb2",
  ".prettierrc":
    "ca3d163bab055381827226140568f3bef7eaac187cebd76878e0b63e9e442356",
  ".prettierignore":
    "5006eb6c926acacaa76a5040112ad9a4fa28fb3a6420423f220b812e66367fe4",
  "tsconfig.json":
    "c65fb07be8206f77ef0c5c42ffb91850c3048609d9c1d4bf1be5b6280908eb62",
  "tsdown.config.ts":
    "f9799e4bc67a8e5b8f6246943a04231aa098ec547771e616772ed7c8f6d08f72",
  "src/__tests__/errors.test.ts":
    "cce89c92e07c619f8c60e43e9e6627b6adeed4b0d679125e6d5618f876fce05f",
  "src/__tests__/file-store.test.ts":
    "86a5dfca4368b84a2a37c56635e41aefc004e12990d0ffc7a4d6aba59d274901",
  "src/__tests__/public-api.test.ts":
    "3de1c464d2d3113570c9737c9d3af70660dae0d3c462c0937b1e9f378b55c7fa",
  "src/__tests__/serialize.test.ts":
    "bcdee9a733feb5327db2d8ec69238699d51ca0895c9ab45ba6c857c862b31755",
  "src/__tests__/sqlite-store.test.ts":
    "1fb1ce63e0fe56019efb3b26544ef8d9c2eec5c3f6a4d2dccf1b0a9790a69da9",
  "src/__tests__/helpers/fixtures.ts":
    "3e8d8cd3e54908e76cfefe6197631a55d79341c0e521734289cb65aff2f0ffc1",
};

export default {
  agent: "devin",
  models: [
    // `devin acp --model <id>` accepts fuzzy names (family slug or alias).
    // SWE-2 tiers are free — prefer them for benchmarks (see `devin models list`).
    { id: "swe-2-high", name: "SWE-2 High" },
  ],
  plugins: [
    // The variable under test: the sverka agent skill from this repo.
    { id: "sverka", name: "Sverka", path: "../../skills/sverka" },
  ],
  tasks: [
    {
      id: "fix-tests",
      name: "Fix failing unit tests",
      prompt:
        "This TypeScript project has failing tests. Find the bugs in src/ " +
        "and fix them so `bun test` passes.",
      fixture: "fixtures/ts-fix-test",
      successCriteria: "All unit tests pass and no test files were modified",
      checks: [
        {
          id: "tests-pass",
          command: "bun test",
          description: "unit tests pass",
        },
      ],
    },
    {
      id: "verify-and-fix",
      name: "Run verification suite and fix failures",
      // The real dogfood: the fixture ships a sverka.config.ts wiring five
      // checks (format/lint/typecheck/test/build) with planted failures in
      // four of them. With the skill, one `sverka run --format json` finds
      // them all; without it the agent runs each check by hand.
      prompt:
        "This project has a verification suite defined in sverka.config.ts " +
        "(see also the package.json scripts). Run all the checks, find " +
        "every failure, and fix the source code so the entire suite " +
        "passes. Do not modify test files, sverka.config.ts, or any " +
        "check configuration (.oxlintrc.json, tsconfig.json).",
      fixture: "fixtures/verify-and-fix",
      setup: ["bun install"],
      timeoutMs: 300_000,
      successCriteria:
        "Every check passes (format, lint, typecheck, test, build) and " +
        "no test or config file was modified",
      checks: [
        {
          id: "tests-pass",
          command: "bun test",
          description: "unit tests pass",
        },
        {
          id: "typecheck",
          command: "bunx tsc --noEmit",
          description: "no type errors",
        },
        {
          id: "lint",
          command: "bunx oxlint .",
          description: "no lint errors",
        },
        {
          id: "format",
          command: "bunx prettier --check .",
          description: "formatting is clean",
        },
        {
          id: "build",
          command: "bun run build",
          description: "build succeeds",
        },
      ],
    },
    {
      id: "ship-package",
      name: "Wire a CI pipeline for a real package",
      // The honest dogfood: the fixture is a verbatim copy of this repo's
      // real @sverka/storage package (real tests, real build) with three
      // accumulated-without-CI failures (typecheck, lint, format). The
      // prompt never mentions sverka — the skill cell must discover the
      // plugin, author sverka.config.ts from scratch, and drive
      // `sverka run`; the baseline cell does the same work by hand.
      prompt:
        "This TypeScript package has no CI verification wired up. Set up " +
        "a verification pipeline that runs every check this project " +
        "supports (format, lint, typecheck, test, build) in a sensible " +
        "order, re-runnable via a single `bun run verify` command. Run " +
        "it and fix the source until all checks pass. Do not modify " +
        "test files or existing tool configuration; you may add " +
        "pipeline files (e.g. sverka.config.ts) and scripts to " +
        "package.json — no new tool configs.",
      fixture: "fixtures/ship-package",
      setup: ["bun install"],
      timeoutMs: 600_000,
      successCriteria:
        "Every check passes (format, lint, typecheck, test, build), " +
        "`bun run verify` re-runs the whole pipeline, and no test or " +
        "existing tool config file was modified",
      checks: [
        {
          id: "format",
          command: "bun run format",
          description: "formatting is clean",
        },
        {
          id: "lint",
          command: "bun run lint",
          description: "no lint errors",
        },
        {
          id: "typecheck",
          command: "bun run typecheck",
          description: "no type errors",
        },
        {
          id: "tests-pass",
          command: "bun run test",
          description: "unit tests pass",
        },
        {
          id: "build",
          command: "bun run build",
          description: "build succeeds",
        },
        {
          id: "protected-files",
          // Digests live here in config, not in a workspace manifest —
          // an agent could rewrite a manifest file to bless its own
          // edits. node -e keeps this cross-platform (sha256sum is
          // GNU-only). package.json can't be hashed outright — the task
          // requires adding a `verify` script — so the five existing
          // script values are pinned and additions tolerated.
          command:
            `node -e 'const c=require("node:crypto"),f=require("node:fs"),` +
            `exp=${JSON.stringify(SHIP_PACKAGE_DIGESTS)},` +
            'want={format:"prettier --check .",lint:"oxlint --deny-warnings src",typecheck:"tsc --noEmit",test:"vitest run",build:"tsdown"};' +
            "let bad=0;" +
            'for(const[p,h]of Object.entries(exp)){let a;try{a=c.createHash("sha256").update(f.readFileSync(p)).digest("hex")}catch{a="missing"}if(a!==h){console.error("protected file modified:",p);bad=1}}' +
            'for(const[k,v]of Object.entries(want)){if(require("./package.json").scripts[k]!==v){console.error("script modified:",k);bad=1}}' +
            // New tool configs are as forbidden as edits — a
            // vite/vitest config with `test.include: []` +
            // passWithNoTests would pass `bun run test` while running
            // zero tests. Match every config filename vitest reads.
            'if(f.readdirSync(".").some(p=>/^(vite|vitest)\\.(config|workspace)\\.[cm]?[jt]s$/.test(p))){console.error("vite/vitest config added");bad=1}' +
            "process.exit(bad)'",
          description: "test/tool-config files unmodified",
        },
        {
          id: "pipeline",
          // Exit 0 alone isn't enough — `"verify": "echo ok"` passes
          // trivially. The script must either delegate to a pipeline
          // tool (sverka/just/make/nx/...) or compose the five checks.
          command:
            'bun run verify && node -e \'const v=require("./package.json").scripts.verify||"";' +
            'const composed=["format","lint","typecheck","test","build"].every(k=>new RegExp("\\\\b"+k+"\\\\b").test(v));' +
            "const delegated=/\\b(sverka|just|make|nx|turbo|moon|bazel)\\b/.test(v);" +
            'if(!composed&&!delegated){console.error("verify does not run the full pipeline:",v);process.exit(1)}\'',
          description: "pipeline re-runnable as one command",
        },
      ],
    },
  ],
  repetitions: 1,
  outputDir: ".arena",
};
