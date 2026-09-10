import { Project, Pipeline, ShellStep, Entry, push } from "@sverka/workflow";

const proj = new Project("sverka");

const ci = new Pipeline(proj, "ci");

void new ShellStep(ci, "typecheck", { command: "bun run typecheck" });
void new ShellStep(ci, "lint", {
  command: "bun run lint",
  dependencies: [{ kind: "control", producer: "typecheck" }],
});
void new ShellStep(ci, "test", {
  command: "bun run test",
  dependencies: [{ kind: "control", producer: "lint" }],
});

void new Entry(ci, "on-push", { trigger: push(), roots: ["typecheck", "lint", "test"] });

export default proj;
