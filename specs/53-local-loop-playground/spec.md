# Spec 53 — Local Loop & Playground

**Status:** Proposed
**Source:** direction program sv-44n5 (strategy review, 2026-10)
**Package:** `@sverka/cli` (run UX), `@sverka/playground` (browser surface), `website/` (embed + funnel)
**Bead:** sv-44n5.1
**Related:** Spec 17 (CLI), Spec 32 (run queries), Spec 38 (observability/report), Spec 43 (reporter), Spec 48 (json stdout/stderr), Spec 50-pipeline-pages, Spec 52 (arena page)

## Overview

`sverka run` is the product. Everything else — compilation, MCP,
agent steps, hub — is downstream of a local loop that is fast,
predictable, and demo-able in 60 seconds. This spec covers two
halves of one funnel:

1. **Local loop polish** — the zero-config path
   `discover → plan → run → report` behaves as a single coherent
   product surface: stable machine output, human output that points
   at the report, and a watch mode for the inner dev loop.
2. **Playground funnel** — `@sverka/playground` becomes the
   zero-install front door: a browser page where a visitor edits a
   pipeline, runs it, gets a findings report, and can share the
   exact scenario as a link. Docs pages embed the same runner.

The funnel contract: **the graph you built in the browser
transfers verbatim to a local config**. Playground code must be a
faithful subset of the real authoring surface, not a lookalike
dialect — `toSverkaConfig()` preserves pipeline structure,
dependencies, and entries exactly, while `FunctionStep` bodies
become TODO `ShellStep`s the user implements (the browser can
never run real processes; see "Execution substrate").

## Goals

- `sverka run` on a repo with no `sverka.config.*`: the command
  bootstraps an implicit `default` pipeline from the same
  detection `sverka check` uses (planner proposals + package.json
  scripts, `detectProjectChecks`), each detected check becoming a
  host `ShellStep` under one `run` entry — then plan → execute →
  print findings summary + path/URL to the full report. One
  command, no flags, useful output. Zero detections → usage error
  (exit 2) pointing at `sverka init`.
- `sverka run --watch`: re-run affected steps on file change
  (debounced; reuses run plan; re-emits report).
- `--format json` is a **stability contract** (Spec 48): field set
  frozen per major version; additions only, never renames/removals
  in 0.x→0.y.
- `sverka run` human output ends with the report location
  (`file://…/report.html` or `sverka view` hint) — the report is
  discoverable, not hidden.
- Playground runs entirely in-browser (Web Worker); zero backend.
- Shareable run links: pipeline source (+ optional findings seed)
  serialized into the URL (`#c=<deflate>`); opening the link
  restores editor state and the last run result.
- Embeddable runner: `<iframe>` / web-component mount used by docs
  pages; docs code examples gain a "Run" affordance.
- Examples gallery: `examples/*/` mini-projects render inside the
  playground picker; one click loads one into the editor.
- Model unification: playground `FunctionStep` maps 1:1 onto a real
  graph step shape so playground code is valid sverka config.

## Non-goals

- Accounts, auth, server-side persistence, collaboration —
  share links are self-contained URLs, not stored documents.
- Hosted execution of arbitrary user repos (Spec 57 territory).
- Running real host/container steps in the browser — the browser
  can never spawn processes; see "Execution substrate" below.
- Playground coverage of every authoring feature — it is the
  funnel subset: pipeline, steps, deps, entries, findings.
- Real-time multiplayer / CRDT editing.

## Interfaces

### Local loop (`@sverka/cli`)

```ts
// run.ts gains:
//   --watch           re-run on change (chokidar or fs.watch; debounce 300ms)
//   --report <path>   HTML report path — Spec 44 `--output` semantics;
//                     report.json stays on the Spec 38 path
// Exit codes unchanged (Spec 17).
```

Human-mode tail of `sverka run` MUST include:

```text
  report: .sverka/runs/<runId>/report.html  (open in a browser)
```

JSON-mode (`--format json`) field names frozen; the versioned
schema is `sverka.run/v1`. New fields append-only.

### Playground (`@sverka/playground`)

```ts
export interface ShareableRun {
  readonly schema: "sverka.playground/v1";
  readonly code: string; // editor source
  readonly findings?: readonly Finding[]; // optional seeded result
}

export function encodeShareLink(run: ShareableRun): string;
// → `${origin}/playground#c=${base64url(deflate(JSON.stringify(run)))}`

export function decodeShareLink(hash: string): ShareableRun;

export function mountRunner(
  el: HTMLElement,
  opts?: {
    readonly code?: string;
    readonly readonly?: boolean;
    readonly onRun?: (result: PipelineResult) => void;
  },
): { dispose(): void };
```

`mountRunner` is the embed API — docs pages call it with the
example source; the runner executes inside a Web Worker (Monaco
already runs there; the executor moves there too).

### Model unification

Playground's `FunctionStep` is a **graph step with a `function`
operation kind** in playground semantics only:

```ts
// Playground-side (browser-safe subset of @sverka/workflow):
new FunctionStep(pipeline, "lint", { fn: () => PlaygroundFinding[] });
// ≡ real config:
new ShellStep(pipeline, "lint", { command: "npm run lint" });
```

The playground module mirrors the real construct names
(`Project`, `Pipeline`, `Entry`, `dependsOn`, `roots`) so example
code transfers verbatim — only the step kind differs
(`FunctionStep` ↔ `ShellStep`). A `toSverkaConfig()` export
transpiles a playground file to a real `sverka.config.ts`
(replaces `FunctionStep` bodies with TODO `ShellStep`s). This is
the "take it home" bridge — the emitted config carries the same
graph but does not run the browser checks; the user fills in the
shell commands that produce equivalent behavior.

## Execution substrate (decision)

Two options were considered; **in-browser execution is chosen**:

1. **In-browser engine (chosen).** Playground keeps its own
   minimal scheduler (`runPipeline`) in a Web Worker. Function
   steps only; no real engine dependency. Zero infra, works on
   static hosting, instant.
2. Remote ephemeral sandbox — rejected for v1: needs hosted
   compute (Spec 57), cold-start latency kills the 60-second
   funnel, and arbitrary code execution is a security+ cost centre
   with no paying user.

Consequence: playground can demo the _authoring + findings +
report_ loop, not real shell execution. The copy must be honest:
"edit a pipeline, see the report — then `npm create sverka` to run
real checks."

## Data models

### Share link encoding

`ShareableRun` → JSON → deflate-raw → base64url → `#c=` fragment.
Fragment (not query) keeps payloads out of server logs. Two size
thresholds: **warn at > 32 KB** (still load; fragment length
limits are browser-dependent) and **hard fallback at > 64 KB**
— beyond the safe fragment range, decode is refused and the
default template loads with a `warn` banner.

### Run report link

`sverka run` writes `report.json` (Spec 38) and `report.html`
(Spec 44 — the per-run location replaces Spec 44's
`.sverka/report.html` default) under `.sverka/runs/<runId>/`. The
CLI prints the HTML path — the file opens directly in a browser;
`sverka view` is the SARIF viewer (Specs 46/47), not the report
opener. `--report <path>` relocates the HTML report for that run
(same semantics as Spec 44 `--output`); `report.json` always
lands at the Spec 38 path.

## Error handling

- Share link corrupt, undecodable, or > 64 KB encoded → playground
  loads the default template + `warn` banner, never a blank page.
- `--watch` re-run while previous run in flight → debounce: cancel
  queued re-run, wait for current run, then re-run once.
- Watch-mode run failure → keep watching (a failing run is a
  result, not a crash); only a plan/synth error resets the watch.
- `toSverkaConfig()` on a file it can't parse → throws
  `PlaygroundError(TRANSPILE_FAILED)` listing the offending
  construct; never emits a half-converted file.
- `PlaygroundError` codes: `TRANSPILE_FAILED`, `DECODE_FAILED`,
  `PAYLOAD_TOO_LARGE` (soft at 32–64 KB — warn, still load; hard
  above 64 KB — default template).

## Test plan

1. `sverka run` on a repo with `sverka.config.ts`: exits 0, human
   output ends with `report:` line pointing at an existing file.
   On a repo with no config but a detectable script (e.g.
   `package.json` `test`), the same command succeeds via the
   implicit detected pipeline; on a repo with neither, exit 2
   pointing at `sverka init`.
2. `sverka run --format json` output parses as `sverka.run/v1`;
   a snapshot test pins the field set (Spec 48 contract).
3. `--watch`: touching a watched file triggers exactly one re-run
   (debounced); a second change during the run triggers one more.
4. `encodeShareLink` → `decodeShareLink` round-trip restores code
   and findings byte-identically.
5. Share link 32–64 KB encoded → warning surfaced, still loads;
   > 64 KB encoded → default template + `warn` banner.
6. `mountRunner` in a jsdom/iframe: runs the default template,
   produces findings, `onRun` fires once.
7. Gallery build: every `examples/*/` entry appears in the picker;
   loading one populates the editor without network access.
8. `toSverkaConfig()` on the default template emits a
   `sverka.config.ts` that `sverka validate` accepts.
9. Corrupt `#c=` fragment → default template + warn banner.
10. Docs embed: a docs page mounting `mountRunner` renders the
    runner with the example preloaded (astro build page check).

## Rollout gates

- Playground ships to sverka.dev unauthenticated; activation
  metric = share-link opens + `create-sverka` runs attributable to
  the playground CTA (UTM on the install instructions, not
  tracking pixels).
