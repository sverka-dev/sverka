<!-- cspell:ignore wnhd -->

# sv-wnhd — docs sweep: engdocs/user pages for undocumented packages

## Problem

Document-first (sv-t7ss) requires an engdocs page in the same PR for
user-facing work. Several shipped packages predate that rule and have no
`engdocs/user/` coverage: `@sverka/playground` (Spec 53),
`@sverka/reporter` (Specs 43–45, 51), `@sverka/ui`, `@sverka/benchmark`
(Specs 41, 42-dashboard), `create-sverka`, `@sverka/plugin-mcp` (Spec 23),
`@sverka/verification` (Specs 14–16), and `@sverka/hub` beyond the HTTP API
page (Specs 50, 55). `@sverka/sarif-viewer-tui` and
`@sverka/sarif-viewer-web` (Specs 46–47) are only mentioned inside
`findings/sarif-pipeline.md`.

## Design

Pages follow the existing `engdocs/user/` taxonomy — `use-cases/` for
product surfaces, `reference/` for package-level API references, `hub/`
for the remote-hub area. Every code example is verified against the
package's `src/index.ts` exports, not written from the spec alone (specs
53/44 predate the shipped surface — e.g. the HTML report now uses dagre +
static SVG per Spec 51, not ReactFlow).

Placement decisions:

- `@sverka/playground` → `use-cases/playground.md` (new): browser model,
  share links, embed API, `toSverkaConfig`, honest-copy boundary.
- `@sverka/benchmark` → `use-cases/benchmark.md` (new): the two-agent A/B
  harness + `sverka.dev/benchmark` dashboard; defers to `use-cases/arena.md`
  for the full `@sverka/arena` framework.
- `@sverka/reporter` → `reference/reporter.md` (new): Renderer contract,
  UIState reducer, findings collector, policy gate, text/HTML/Ink
  renderers, CLI wiring.
- `@sverka/verification` → `reference/verification.md` (new): the
  consolidated checks+findings+policy package, export map, import-path
  guidance (`@sverka/verification` vs `@sverka/sdk` re-exports). The three
  existing pages (checks/findings/policy) get their stale `Source:` paths
  fixed — they cite deleted `packages/checks|findings|policy` directories.
- `@sverka/hub` → `hub/embedding.md` (new): programmatic embedding API
  (`startHubServer`, `createHubStore`, token helpers) + the `@sverka/ui`
  hub page renderers + Spec 50 site surfaces (pipeline reports shipped;
  hosted findings hub still proposed).
- `@sverka/ui` → covered where it is used: `findings/sarif-pipeline.md`
  (`sverka ui`) and `hub/embedding.md` (`renderHub*` pages); no separate
  page — its only other export is `renderDashboard`, documented in the
  embedding page.
- `create-sverka` → a section in `getting-started/install.md`; the whole
  package is `bun create sverka [dir]` → `sverka init` argument
  translation — a standalone page would be padding.
- `@sverka/plugin-mcp` → expand the "Sverka as MCP client" section of
  `agent-integration/mcp.md` (error codes, `MCPClientPool`, lazy connect /
  `dispose`, transports) rather than fragment one page into two.
- SARIF viewers (Specs 46–47) → **decided: no separate pages.** They are
  already documented end-to-end in `findings/sarif-pipeline.md`; the page
  gains the standalone `npx @sverka/sarif-viewer-*` entrypoints and the
  embeddable `SarifTuiApp` component, which were the only gaps.

Drive-by fixes in scope: `running/cli.md` says "14 commands" but the CLI
has 19 — the missing five (`hub`, `login`, `runs`, `agent`, `apply`) get
short entries pointing at their detailed pages. The root `README.md`
index is updated for every new page.

## Plan

- [ ] `use-cases/playground.md`
- [ ] `use-cases/benchmark.md`
- [ ] `reference/reporter.md`
- [ ] `reference/verification.md`
- [ ] `hub/embedding.md`
- [ ] Expand `agent-integration/mcp.md` (MCP client section)
- [ ] `getting-started/install.md`: `bun create sverka` section
- [ ] `findings/sarif-pipeline.md`: standalone viewer CLIs + `SarifTuiApp`
- [ ] Fix stale `Source:` paths in `reference/checks.md`,
      `findings.md`, `policy.md`
- [ ] `running/cli.md`: 14 → 19 commands (add hub/login/runs/agent/apply)
- [ ] Update `engdocs/user/README.md` index
- [ ] `bun run docs:sync` (website) + prettier/cspell/markdownlint clean
