import { Project, Pipeline, ShellStep, Entry, push } from "@sverka/workflow";

const proj = new Project("all-green");
const ci = new Pipeline(proj, "ci");

new ShellStep(ci, "test", { command: "bun run test" });
new ShellStep(ci, "build", { command: "bun run build", dependsOn: ["test"] });

new Entry(ci, "on-push", { trigger: push(), roots: ["build"] });

export default proj;
