import { Project, Pipeline, ShellStep } from "@sverka/workflow";
import { shell } from "../index.js";

const project = new Project("test");
const pipeline = new Pipeline(project, "ci");
const step = shell.git`push origin main`.build(pipeline, "push");
console.log("Returned step command:", step.command);
const child = pipeline.node.children.find((c) => c.node.id === "push");
console.log("Pipeline child command:", child instanceof ShellStep ? child.command : undefined);
