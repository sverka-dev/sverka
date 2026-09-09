# Quality Gate UI — Mega Plan

## Vision

Sverka runs any combination of checks (lint, typecheck, test, sonar, codescene,
codacy, custom) locally, shows live progress with spinners and colored status,
renders the step DAG, aggregates findings from all checkers, applies a policy
gate, and produces a shareable HTML report — all without touching CI.

Three renderers share one event stream:

```
engine.run() → AsyncIterable<RunEvent>
                    │
          ┌─────────┼──────────┐
          │         │          │
      TextRenderer  InkRenderer  HtmlRenderer
      (CI/pipe)     (TUI)        (static file → future web)
```

## Packages

New package: `@sverka/reporter` — renderer abstractions, event reducer,
findings collector, all three renderers. Depends on `@sverka/runtime` (events,
types) and `@sverka/verification` (findings, policy). No dependency on CLI —
CLI imports from reporter.

```
packages/reporter/
  src/
    types.ts           # Renderer interface, UIState, FindingRow
    reducer.ts         # RunEvent[] → UIState (pure)
    findings-collector.ts  # artifacts/*.sarif → Finding[] (uses verification)
    policy-gate.ts     # Finding[] + Policy → Verdict (uses verification)
    renderers/
      text.ts           # non-interactive stdout (vitest-style)
      ink.ts            # interactive TUI (ink + react)
      html.ts           # static self-contained HTML file
    dag/
      layout.ts        # DefinitionGraph → DAG nodes + edges (pure)
      mermaid.ts        # DAG → mermaid flowchart string (for HTML)
      tree.ts           # DAG → tree-of-strings (for TUI)
    index.ts           # public exports
  __tests__/
    reducer.test.ts
    findings-collector.test.ts
    policy-gate.test.ts
    dag-layout.test.ts
    text-renderer.test.ts
    html-renderer.test.ts
    ink-renderer.test.ts
```

## Phases

### Phase 1: Renderer core + Text (MVP-1)

**Goal:** `sverka run --format text` shows vitest-style output with findings
and policy verdict.

**Scope:**
- `Renderer` interface: `onEvent(RunEvent): void`, `onFindings(Finding[]): void`,
  `onVerdict(Verdict): void`, `flush(): void`
- `EventReducer` — pure function: accumulates RunEvents into UIState
  (step statuses, durations, errors, diagnostic messages)
- `FindingsCollector` — reads SARIF from `.sverka/artifacts/<stepId>/`,
  normalizes via `@sverka/verification.normalizeSarif`, merges into single
  Finding[] with source step attribution
- `PolicyGate` — wraps `evaluatePolicy` + `filterOnlyNew`, returns verdict +
  exit code
- `TextRenderer` — vitest-style: one line per step with ✓/✗/●/○ + duration,
  findings summary, policy verdict at end
- Wire into `sverka run`: after engine completes, collect findings, evaluate
  policy, pass to renderer
- `--format text|json` flag (text is new, json is existing)

**Files:** ~350 lines impl + ~200 lines tests
**Deps:** none new (uses existing @sverka/runtime + @sverka/verification)

### Phase 2: HTML report (MVP-2)

**Goal:** `sverka run --format html --output report.html` produces a
self-contained HTML file with ReactFlow DAG, findings table, per-step logs.

**Scope:**
- `DagLayout` — pure: DefinitionGraph → { nodes: DagNode[], edges: DagEdge[] }
  with topological positions
- `HtmlRenderer` — generates self-contained HTML:
  - Inline ReactFlow (UMD build, ~200KB) for interactive DAG
  - Inline mermaid as fallback for non-JS
  - Findings table: filter by severity/source/checkId, sort, search
  - Per-step logs in collapsible `<details>` sections
  - Policy verdict banner (pass/fail)
  - Dark theme, responsive
- `--format html` flag + `--output <path>` (default: `.sverka/report.html`)
- HTML template is a function: (UIState, Finding[], Verdict, DagLayout) => string
  - Separates data from presentation (enables future web server)
- ReactFlow loaded from CDN with inline fallback (or bundled)

**Files:** ~500 lines impl + ~200 lines tests
**Deps:** reactflow (dev only — UMD bundle inlined at build time, not a runtime dep)

### Phase 3: Ink TUI (MVP-3)

**Goal:** `sverka run --tui` (default when TTY) shows live interactive TUI.

**Scope:**
- `InkRenderer` — ink + react:
  - Step tree with live status (✓ green, ✗ red, ● yellow spinner, ○ gray)
  - Findings list with filter bar: [all] [high] [medium] [low] [new] [error]
  - j/k scroll, / search, f filter, d toggle details, q quit
  - DAG as tree view (not visual graph — that's HTML only)
  - Policy verdict footer
  - Respects terminal resize
- Auto-detect TTY: if stdout is TTY and no --format flag, use ink; else text
- `--no-tui` flag to force text mode
- Ink components: StepTree, FindingsList, FilterBar, VerdictFooter

**Files:** ~600 lines impl + ~200 lines tests
**Deps:** ink (^5.0.0), react (^18.0.0) — runtime deps of @sverka/reporter
         (only loaded when TUI mode is active; tree-shakeable for HTML/text)

### Phase 4: Web server (FUTURE — not in this wave)

**Goal:** `sverka serve` — HTTP server with live run streaming.

**Scope (deferred):**
- Hono/Express server
- WebSocket for live RunEvent streaming
- REST API: POST /run, GET /run/:id, GET /run/:id/state
- Serve HTML template + JSON state separately
- Workspace registration, pipeline browsing, interactive check execution
- This phase is tracked as a follow-up bead, NOT in this wave

## RunEvent extensions

Current events lack stdout/stderr capture. For TUI + HTML we need:

**Option A (chosen):** Engine writes logs to `.sverka/workspace/<stepId>/step.log`
and `step-failed` event carries optional `logPath`. TUI/HTML read on demand.
No new event types, no streaming noise.

```typescript
| { readonly type: "step-failed"; readonly stepId: string;
   readonly error: string; readonly durationMs: number;
   readonly logPath?: string }  // NEW optional field
```

This is backward-compatible (optional field, existing consumers ignore it).

## CLI integration

```
sverka run [--format text|json|html] [--output <path>] [--tui|--no-tui]
           [--config <path>] [--entry <id>] [--executor host|docker]
           [--evaluate]  # collect findings + run policy after execution
```

- `--evaluate` (new): after run completes, collect SARIF artifacts, run
  findings normalization + policy evaluation, pass to renderer
- `--format html` implies `--evaluate`
- `--tui` (new): force ink renderer (default when TTY)
- `--no-tui`: force text renderer
- Exit codes: 0 success, 1 policy fail, 2 usage, 3 runtime error (unchanged)

## Spec tree

- `specs/43-reporter/spec.md` — renderer interface, event reducer, findings
  collector, policy gate
- `specs/44-html-report/spec.md` — HTML report format, DAG layout, ReactFlow
- `specs/45-tui/spec.md` — ink TUI, keybindings, components

## Dependencies

| Package | Dep | Type | Justification |
|---------|-----|------|---------------|
| @sverka/reporter | @sverka/runtime | workspace | RunEvent, DefinitionGraph types |
| @sverka/reporter | @sverka/verification | workspace | normalizeSarif, evaluatePolicy |
| @sverka/reporter | ink ^5.0.0 | runtime | TUI renderer (tree-shakeable) |
| @sverka/reporter | react ^18.0.0 | runtime | ink peer dep |
| @sverka/reporter | reactflow ^11.0.0 | dev | UMD bundle inlined at build time |

ink + react are ~45KB gzipped together. reactflow UMD is ~200KB inlined into
HTML template at build time, not a runtime dep of the package.

## Acceptance criteria

1. `sverka run --format text` shows step-by-step progress with ✓/✗ + durations
2. `sverka run --evaluate --format text` shows findings summary + policy verdict
3. `sverka run --format html --output report.html` produces openable HTML with
   interactive DAG, findings table, policy verdict
4. `sverka run --tui` (or default in TTY) shows live ink TUI with spinners,
   colored status, filterable findings, DAG tree
5. All renderers consume the same `AsyncIterable<RunEvent>` stream
6. FindingsCollector reads SARIF from `.sverka/artifacts/` and attributes to steps
7. PolicyGate wraps existing evaluatePolicy + filterOnlyNew
8. HTML report is self-contained (no external files, no server needed)
9. TUI degrades gracefully to text when not a TTY
10. No `any` types, strict TypeScript, custom error classes

## Wave structure

3 stacked PRs:
- PR 1 (base: main): `@sverka/reporter` package — types, reducer, findings
  collector, policy gate, text renderer, CLI wiring. Spec 43.
- PR 2 (base: PR 1): HTML renderer + DAG layout + ReactFlow. Spec 44.
- PR 3 (base: PR 2): Ink TUI renderer. Spec 45.

Branch: `feat/quality-gate-ui` off main.
