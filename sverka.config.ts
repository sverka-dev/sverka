import { Project, Pipeline, ShellStep, Entry, push } from "@sverka/workflow";

const proj = new Project("sverka");

const ci = new Pipeline(proj, "ci");

// Build first: package tests resolve workspace deps via dist/.
const build = new ShellStep(ci, "build", { command: "bun run build" });
const typecheck = new ShellStep(ci, "typecheck", {
  command: "bun run typecheck",
  dependsOn: [build.node.id],
});
const lint = new ShellStep(ci, "lint", {
  command: "bun run lint",
  dependsOn: [typecheck.node.id],
});
const test = new ShellStep(ci, "test", {
  command: "bun run test",
  dependsOn: [lint.node.id],
});

// Emits SARIF on stdout → collected as a finding artifact for --evaluate.
const lintSarif = new ShellStep(ci, "lint-sarif", {
  command: "bunx eslint packages/*/src -f @microsoft/eslint-formatter-sarif",
  runtime: { shell: "sh" },
  outputs: { "eslint.sarif": { type: "artifact", fromStdout: true } },
});

// Dependency vulnerabilities (bun audit exits non-zero on findings).
const audit = new ShellStep(ci, "audit", { command: "bun audit" });

// Self-check: runs the CLI from source — no global install required.
const doctor = new ShellStep(ci, "doctor", {
  command: "bun packages/cli/src/bin.ts doctor",
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
