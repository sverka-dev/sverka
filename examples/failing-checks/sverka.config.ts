import { Project, Pipeline, ShellStep, Entry, push } from "@sverka/workflow";

const proj = new Project("failing-checks");
const ci = new Pipeline(proj, "ci");

// No deps between the two — both run so both planted failures are visible.
new ShellStep(ci, "typecheck", { command: "bun run typecheck" });
new ShellStep(ci, "test", { command: "bun run test" });
new ShellStep(ci, "build", {
  command: "bun run build",
  dependsOn: ["typecheck", "test"],
});

new Entry(ci, "on-push", { trigger: push(), roots: ["build"] });

export default proj;
