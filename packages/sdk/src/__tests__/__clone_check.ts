import { Project, Pipeline, ShellStep } from "@sverka/cdk";
import { shell } from "@sverka/sdk";

const project = new Project("test");
const pipeline = new Pipeline(project, "ci");
const step = shell.git`push origin main`.build(pipeline, "push");
console.log("Returned step command:", step.command);
const child = pipeline.node.children.find((c: any) => c.node.id === "push");
console.log("Pipeline child command:", (child as any)?.command);
