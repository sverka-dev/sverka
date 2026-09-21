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

// Emits SARIF on stdout → collected as a finding artifact for the policy
// gate. Always exits 0: eslint exits 1 on findings, and a failed step would
// skip the artifact export — policy is the gate, not eslint's exit code.
const lintSarif = new ShellStep(ci, "lint-sarif", {
  command: "bun run lint:sarif || true",
  runtime: { shell: "sh" },
  outputs: { "eslint.sarif": { type: "artifact", fromStdout: true } },
});

// Policy gate on the lint SARIF (Spec 16). DEFAULT_POLICY fails on any
// high-severity finding and on new medium-severity findings (no baseline).
// The artifact lands as a bare file locally and under <name>/<name> in CI
// (download-artifact treats `path` as a directory) — `find` resolves both.
const policy = new ShellStep(ci, "policy", {
  command:
    "bun packages/cli/src/bin.ts policy --findings \"$(find eslint.sarif -type f -name '*.sarif' | head -n1)\"",
  runtime: { shell: "sh" },
  inputs: [{ kind: "step", step: lintSarif.node.id, output: "eslint.sarif", type: "artifact" }],
  beforeScript: [...nxPlugins, "bun run build"],
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
    policy.node.id, // pulls lint-sarif via artifact input
    audit.node.id,
    doctor.node.id,
  ],
});

export default proj;
