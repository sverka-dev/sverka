import { Project, Pipeline, ShellStep, Entry, push } from "@sverka/workflow";

const proj = new Project("sverka");

const ci = new Pipeline(proj, "ci");

new ShellStep(ci, "typecheck", { command: "bun run typecheck" });
new ShellStep(ci, "lint", {
  command: "bun run lint",
  dependencies: [{ kind: "control", producer: "typecheck" }],
});
new ShellStep(ci, "test", {
  command: "bun run test",
  dependencies: [{ kind: "control", producer: "lint" }],
});

new Entry(ci, "on-push", { trigger: push(), roots: ["typecheck", "lint", "test"] });

export default proj;
