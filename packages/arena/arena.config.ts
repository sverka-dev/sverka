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
  ],
  repetitions: 1,
  outputDir: ".arena",
};
