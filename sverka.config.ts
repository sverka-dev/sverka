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

// Drift guard: .github/workflows/sverka.yml must equal `compile --pin`
// output — catches edits to the generated file (e.g. dependabot bumps
// that belong in the compiler's pinned-actions registry instead).
// compile exits non-zero on error diagnostics (e.g. unpinned actions),
// so its exit code is propagated explicitly — a bare `| diff` would
// mask a failed compile when the emitted YAML happens to match.
const drift = new ShellStep(ci, "workflow-drift", {
  command:
    "f=$(mktemp) && trap 'rm -f \"$f\"' EXIT && bun packages/cli/src/bin.ts compile --target github --pin > \"$f\" && diff \"$f\" .github/workflows/sverka.yml",
  runtime: { shell: "sh" },
  beforeScript: [...nxPlugins, "bun run build"],
});

export const onPush = new Entry(ci, "on-push", {
  trigger: push(),
  roots: [
    test.node.id, // pulls build → typecheck → lint via dependsOn
    policy.node.id, // pulls lint-sarif via artifact input
    audit.node.id,
    doctor.node.id,
    drift.node.id,
  ],
});

export default proj;
