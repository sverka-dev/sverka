# Playground

`@sverka/playground` is the zero-install front door (Spec 53): a
browser-only pipeline model, a runner that executes it in-page, share
links that carry the whole scenario in the URL, and an embed API docs
pages use to give code examples a **Run** button — all with no backend.

The playground demos the _authoring + findings + report_ loop, not real
shell execution — a browser cannot spawn processes. The honest contract:
**the graph you build transfers verbatim to a local config**, and
`toSverkaConfig()` does that conversion. To run real checks, take the
pipeline home with `npm create sverka`.

## The pipeline model

The package mirrors the `@sverka/workflow` Construct API — same names,
same structure — so example code moves between the two unchanged. The
only difference is the step kind:

- `FunctionStep` — runs a JavaScript function returning
  `PlaygroundFinding[]`. This is how you simulate a check in the browser.
- `ShellStep` — accepted so real configs load verbatim, but its
  `execute()` returns an info finding explaining the demo boundary (the
  command text is deliberately not echoed into findings — a real command
  may carry secrets, and findings end up in share links).

```ts
import { Project, Pipeline, FunctionStep, Entry } from "@sverka/playground";

const proj = new Project("verify");
const pipeline = new Pipeline(proj, "ci");

new FunctionStep(pipeline, "lint", {
  fn: () => [
    {
      rule: "no-console",
      file: "src/app.ts",
      line: 12,
      severity: "medium",
      message: "Unexpected console.log statement",
    },
  ],
});

new FunctionStep(pipeline, "test", {
  fn: () => [],
  dependencies: ["lint"],
});

new Entry(pipeline, "on-push", {
  trigger: { kind: "push" },
  roots: ["test"],
});

export default proj;
```

`Entry` works like the real one: `roots` selects which steps an entry
starts from, and a root's dependency closure runs with it. Inside the
playground editor, `import`/`export` statements are stripped and trigger
helpers (`push()`, `manual()`, `schedule(cron)`, `changeRequest()`) are
injected, so `export default proj` is all the wiring a file needs.

## Running

`runPipeline(project)` executes the selected steps and returns a
`PipelineResult` — per-step `StepResult`s (status, findings, duration)
plus the merged `Finding[]`, which is what the findings report renders.

```ts
import { runPipeline } from "@sverka/playground";

const result = await runPipeline(proj);
// result.steps: StepResult[] — { stepId, status, findings, durationMs }
// result.findings: Finding[] — all findings, normalized to the
//   @sverka/verification shape (fingerprint, severity, source)
// result.success: boolean
```

`runPipelineWithTimeout(project, timeoutMs)` wraps the same run in a
deadline so a stuck `fn` can't wedge the UI. `evaluateUserCode(code)`
turns editor source into a `Project` — it runs user code through `new
Function()` in the page context, the same trust model as a local REPL.

The standalone app (a Monaco editor + findings report, from the
`index.html`/`vite.config.ts` in the package) builds on exactly these
exports: `DEFAULT_CODE` is the template it loads, `evaluateUserCode`
evaluates it, `runPipelineWithTimeout` runs it, and
`@sverka/sarif-viewer-web` renders the report.

## Share links

A share link serializes `{ schema: "sverka.playground/v1", code,
findings? }` through deflate → base64url → the URL fragment:

```ts
import { encodeShareLink, decodeShareLink } from "@sverka/playground";

const url = encodeShareLink(
  { schema: "sverka.playground/v1", code: source, findings },
  "https://sverka.dev",
);
// → https://sverka.dev/playground#c=<deflate-base64url>

const restored = decodeShareLink(location.hash);
```

The fragment (not a query param) keeps payloads out of server logs —
links are self-contained, never stored server-side. Two size thresholds:
encoded payloads warn past `SHARE_PAYLOAD_WARN_BYTES` (32 KB) and are
refused past `SHARE_PAYLOAD_MAX_BYTES` (64 KB), where the app loads the
default template with a warning banner instead of a blank page. Corrupt
or undecodable fragments get the same graceful fallback —
`PlaygroundError(DECODE_FAILED | PAYLOAD_TOO_LARGE)` is thrown by
`decodeShareLink`, never silently swallowed.

## Embedding the runner

`mountRunner` mounts a self-contained runner — code panel (editable or
read-only), Run button, and a findings iframe — on any element:

```ts
import { mountRunner } from "@sverka/playground";

const mounted = mountRunner(document.getElementById("demo")!, {
  code: exampleSource, // defaults to DEFAULT_CODE
  readonly: false, // render as a fixed listing instead of an editor
  autoRun: false, // never auto-executes — the reader presses Run
  onRun: (result) => console.log(result.findings.length),
});

mounted.dispose(); // removes DOM, listeners, and in-flight callbacks
```

On this site the docs embed is the `<Runner>` MDX component — the live
demo on [First plan](../getting-started/first-plan.md) is one. Mounting
never runs code unless `autoRun` is set, and `dispose()` silences
callbacks for runs still in flight.

## Taking a pipeline home

`toSverkaConfig(source)` transpiles playground source into a real
`sverka.config.ts`: `Project`/`Pipeline`/`Entry`/`roots` transfer
verbatim and each `FunctionStep` becomes a `ShellStep` carrying a
placeholder `echo` you replace with the real command. Source it can't
parse throws `PlaygroundError(TRANSPILE_FAILED)` naming the offending
construct — it never emits a half-converted file.

## Examples gallery

`listExamples(modules)` turns a bundler-provided map of
`examples/*/sverka.config.ts` sources into a sorted picker list
(`{ id, title, code }[]`). The app feeds it `import.meta.glob` so the
gallery needs no network access; the library export stays
bundler-agnostic.

## API summary

| Export                                                      | Kind                                                                   |
| ----------------------------------------------------------- | ---------------------------------------------------------------------- |
| `Project`, `Pipeline`, `FunctionStep`, `ShellStep`, `Entry` | Browser-safe construct classes                                         |
| `runPipeline`, `runPipelineWithTimeout`                     | In-page runner                                                         |
| `evaluateUserCode`, `DEFAULT_CODE`                          | Editor source → `Project`                                              |
| `encodeShareLink`, `decodeShareLink`, `PlaygroundError`     | Share links (`DECODE_FAILED`, `PAYLOAD_TOO_LARGE`, `TRANSPILE_FAILED`) |
| `mountRunner`                                               | Embed API — returns `{ dispose() }`                                    |
| `toSverkaConfig`                                            | Playground source → `sverka.config.ts`                                 |
| `listExamples`                                              | `examples/*/` sources → picker entries                                 |
| `SHARE_PAYLOAD_WARN_BYTES`, `SHARE_PAYLOAD_MAX_BYTES`       | 32 KB warn / 64 KB hard limit                                          |

Types: `Finding`, `FindingSource`, `PlaygroundFinding`, `Severity`,
`StepResult`, `PipelineResult`, `ShareableRun`, `MountRunnerOptions`,
`MountedRunner`, `GalleryExample`, `Construct`, `Step`,
`PlaygroundErrorCode`.

## See also

- [First plan](../getting-started/first-plan.md) — live `<Runner>` embed
  in a docs page
- [SARIF pipeline](../findings/sarif-pipeline.md) — the report renderer
  the playground reuses
- [Install](../getting-started/install.md) — `npm create sverka`, the
  take-it-home path
