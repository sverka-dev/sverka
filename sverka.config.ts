import { Project, Pipeline, ShellStep, Entry, push } from "@sverka/workflow";

const proj = new Project("sverka");

// Least privilege for generated CI — same as hand-written ci.yml.
const ci = new Pipeline(proj, "ci", {
  permissions: { actions: "read", contents: "read" },
});

// nx loads vendored @nx-devkit/* plugins — they must be built after install
// (CI compiles this pipeline: setup-bun + bun install are injected, then
// beforeScript runs before the step command).
const nxPlugins = ["bun run build:nx-plugins"];

// Build first: package tests resolve workspace deps via dist/.
const build = new ShellStep(ci, "build", {
  command: "bun run build",
  beforeScript: nxPlugins,
});
const typecheck = new ShellStep(ci, "typecheck", {
  command: "bun run typecheck",
  dependsOn: [build.node.id],
  beforeScript: nxPlugins,
});
const lint = new ShellStep(ci, "lint", {
  command: "bun run lint",
  dependsOn: [typecheck.node.id],
  beforeScript: nxPlugins,
});
const test = new ShellStep(ci, "test", {
  command: "bun run test",
  dependsOn: [lint.node.id],
  beforeScript: nxPlugins,
});

// Emits SARIF on stdout → collected as a finding artifact for --evaluate.
const lintSarif = new ShellStep(ci, "lint-sarif", {
  command: "bunx eslint packages/*/src -f @microsoft/eslint-formatter-sarif",
  runtime: { shell: "sh" },
  outputs: { "eslint.sarif": { type: "artifact", fromStdout: true } },
});

// Dependency vulnerabilities (bun audit exits non-zero on findings).
const audit = new ShellStep(ci, "audit", { command: "bun audit" });

// Self-check: runs the CLI from source — needs built workspace deps.
// CI jobs are isolated runners, so beforeScript builds them in-job.
const doctor = new ShellStep(ci, "doctor", {
  command: "bun packages/cli/src/bin.ts doctor",
  beforeScript: [...nxPlugins, "bun run build"],
});

export const onPush = new Entry(ci, "on-push", {
  trigger: push(),
  roots: [
    test.node.id, // pulls build → typecheck → lint via dependsOn
    lintSarif.node.id,
    audit.node.id,
    doctor.node.id,
  ],
});

export default proj;
