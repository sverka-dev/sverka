# First plan

This page walks through defining a workflow, synthesizing a Definition Graph,
and running verification through the native engine.

## Define a workflow

Create `sverka.config.ts` in your project root (or run `sverka init` to
generate one):

```ts
import { Project, Pipeline, ShellStep, Entry } from "@sverka/workflow";

const proj = new Project("verify");
const pipeline = new Pipeline(proj, "ci");

new ShellStep(pipeline, "lint", { command: "npm run lint" });
new ShellStep(pipeline, "typecheck", { command: "npm run typecheck" });
new ShellStep(pipeline, "test", {
  command: "npm run test",
  dependsOn: ["lint", "typecheck"],
});

new Entry(pipeline, "on-push", {
  trigger: { kind: "push" },
  roots: ["test"],
});

export default proj;
```

The workflow runs lint and typecheck in parallel, then test after both
complete. Each `ShellStep` names its operation for the plan output.

### Try it in the playground

The same pipeline shape, running in your browser — `FunctionStep`s stand
in for `ShellStep`s because a browser can't spawn processes (a `ShellStep`
in the playground reports an info finding explaining the boundary):

<Runner
code={`import { Project, Pipeline, FunctionStep, Entry } from "@sverka/playground";

const proj = new Project("verify");
const pipeline = new Pipeline(proj, "ci");

new FunctionStep(pipeline, "lint", {
fn: () => [
{ rule: "no-console", file: "src/app.ts", line: 12, severity: "medium", message: "Unexpected console.log statement" },
],
});
new FunctionStep(pipeline, "typecheck", {
fn: () => [
{ rule: "ts2322", file: "src/types.ts", line: 8, severity: "critical", message: "Type 'string' is not assignable to type 'number'" },
],
});
new FunctionStep(pipeline, "test", {
fn: () => [],
dependencies: ["lint", "typecheck"],
});

new Entry(pipeline, "on-push", { trigger: { kind: "push" }, roots: ["test"] });

export default proj;`}
/>

Press **Run** to execute it and see the findings report. To run real
checks, take the same structure home with
[`npm create sverka`](./install.md) — the graph transfers verbatim.

## See what would run

```sh
sverka plan
```

This discovers your project, synthesizes the Definition Graph, binds a
Run Plan, and prints it without executing anything.

## Run verification

```sh
sverka run
```

This executes the Run Plan through the native engine with the host
runtime driver. You see step events: pending, started, succeeded/failed,
and run completion.

## Inspect the graph

```sh
sverka graph
```

This prints the synthesized Definition Graph showing pipelines, steps,
entries, and dependencies.

## Compile to GitHub Actions

```sh
sverka synth --target github
```

This lowers the Definition Graph to native GitHub Actions YAML and
writes it to `.github/workflows/ci.yml`.

## Authoring surface

Pipelines are authored with the Construct API from `@sverka/workflow` —
the same surface `sverka init` generates:

```ts
import { Project, Pipeline, ShellStep, Entry } from "@sverka/workflow";

const proj = new Project("myproj");
const p = new Pipeline(proj, "ci");
new ShellStep(p, "build", { command: "npm run build" });
new Entry(p, "on-push", { trigger: { kind: "push" }, roots: ["build"] });
```

For programmatic use, `synthesize` (`@sverka/workflow`) and `bindRunPlan`
(`@sverka/sdk`) drive the same graph → Plan pipeline — see
[From workflow to Plan](../workflows/overview.md#from-workflow-to-plan).
