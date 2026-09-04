import type { Task, AgentConfig } from "./types.js";

/** 5 task scenarios, ordered simple → complex. */
export const BENCHMARK_TASKS: readonly Task[] = [
  {
    id: "run-checks",
    name: "run-checks",
    prompt:
      "Run all quality checks (lint, typecheck, test, build) for this TypeScript project and report the results. If any check fails, report which one failed and why.",
    timeoutMs: 120000,
  },
  {
    id: "discover",
    name: "discover",
    prompt:
      "Discover what checks are available in this project by reading package.json scripts and looking for config files. List each check with its command.",
    timeoutMs: 60000,
  },
  {
    id: "create-config",
    name: "create-config",
    prompt:
      "Create a CI workflow configuration file for this project that runs lint, typecheck, test, and build in dependency order. The config should define steps with dependencies: lint and typecheck run first (parallel), test depends on both, build depends on test.",
    timeoutMs: 120000,
  },
  {
    id: "compile-github",
    name: "compile-github",
    prompt:
      "Compile a CI workflow to GitHub Actions YAML format for this project. The workflow should run lint, typecheck, test, and build on push events. Output the complete YAML.",
    timeoutMs: 120000,
  },
  {
    id: "multi-step",
    name: "multi-step",
    prompt:
      "Create a multi-step pipeline with dependencies: lint and typecheck run in parallel, test depends on both, build depends on test. Define the pipeline as code and validate it works correctly.",
    timeoutMs: 120000,
  },
] as const;

/** Default agent configs: raw-shell (no sverka) vs sverka (CLI + skill). */
export const DEFAULT_AGENTS: readonly AgentConfig[] = [
  {
    id: "raw-shell",
    name: "Raw Shell Agent",
    type: "raw-shell",
  },
  {
    id: "sverka",
    name: "Sverka CLI Agent",
    type: "sverka",
  },
] as const;
