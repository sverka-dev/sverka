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

export const onPush = new Entry(ci, "on-push", {
  trigger: push(),
  roots: [typecheck.node.id, lint.node.id, test.node.id],
});

export default proj;
