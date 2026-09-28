import { Project, Pipeline, ShellStep, Entry, push } from "@sverka/workflow";

const proj = new Project("verify-and-fix");
const ci = new Pipeline(proj, "ci");

// Fast checks first (parallel, no deps)
new ShellStep(ci, "format", { command: "bun run format" });
new ShellStep(ci, "lint", { command: "bun run lint" });
new ShellStep(ci, "typecheck", { command: "bun run typecheck" });

new ShellStep(ci, "test", {
  command: "bun run test",
  dependsOn: ["format", "lint", "typecheck"],
});

new ShellStep(ci, "build", { command: "bun run build", dependsOn: ["test"] });

new Entry(ci, "on-push", { trigger: push(), roots: ["build"] });

export default proj;
