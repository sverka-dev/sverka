import { Project, Pipeline, ShellStep, Entry, push } from "@sverka/workflow";

const proj = new Project("sarif-findings");
const ci = new Pipeline(proj, "ci");

// Emits SARIF on stdout → stored as a findings artifact even on findings
// (the || true keeps a finding-heavy run from failing the step itself —
// policy is the gate, not the linter's exit code).
new ShellStep(ci, "lint-sarif", {
  command: "bun run lint:sarif || true",
  runtime: { shell: "sh" },
  outputs: { "findings.sarif": { type: "artifact", fromStdout: true } },
});

new ShellStep(ci, "policy", {
  command:
    "bunx sverka policy --findings \"$(find . -name 'findings.sarif' | head -n1)\"",
  runtime: { shell: "sh" },
  dependsOn: ["lint-sarif"],
});

new Entry(ci, "on-push", { trigger: push(), roots: ["policy"] });

export default proj;
