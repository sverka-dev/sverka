import { Project, Pipeline, ShellStep, Entry, push } from "@sverka/workflow";

const proj = new Project("sverka");

const ci = new Pipeline(proj, "ci");

const typecheck = new ShellStep(ci, "typecheck", { command: "bun run typecheck" });
const lint = new ShellStep(ci, "lint", {
  command: "bun run lint",
  dependsOn: [typecheck.node.id],
});
const test = new ShellStep(ci, "test", {
  command: "bun run test",
  dependsOn: [lint.node.id],
});

const lintSarif = new ShellStep(ci, "lint-sarif", {
  command: "bunx eslint packages/*/src -f @microsoft/eslint-formatter-sarif",
  runtime: { shell: "sh" },
  outputs: { "eslint.sarif": { type: "artifact", fromStdout: true } },
});

export const onPush = new Entry(ci, "on-push", {
  trigger: push(),
  roots: [typecheck.node.id, lint.node.id, test.node.id, lintSarif.node.id],
});

export default proj;
