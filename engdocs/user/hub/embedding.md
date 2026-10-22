# Embedding the hub

The [hub API page](./api.md) covers running a hub via `sverka hub serve`
and talking to it over HTTP. This page covers the two embedding angles:
`@sverka/hub` as a library (host the server yourself, or reuse its store
and auth pieces), and `@sverka/ui`'s server-rendered pages — the HTML the
hub dashboard is made of.

## `startHubServer`

```ts
import { startHubServer } from "@sverka/hub";

const server = await startHubServer({
  dataDir: ".sverka-hub",
  port: 0, // 0 = ephemeral port (default 7357); host defaults to 0.0.0.0
});

console.log(server.url); // actual bound URL
await server.close();
```

Useful options beyond the CLI flags: `tokens` supplies the token list
directly (otherwise `<dataDir>/tokens` + `SVERKA_HUB_ADMIN_TOKEN` apply),
and `maxBlobBytes` / `maxJsonBytes` tune the body caps that turn into
`413`s (defaults 512 MiB / 32 MiB). `port: 0` plus the returned
`server.url` is the right shape for tests — no port collisions, no
guessing.

## The store, standalone

`createHubStore(dataDir)` is the persistence half — filesystem for blobs
and snapshots, SQLite (`hub.db`) for the run index — and works without
the HTTP server:

```ts
import { createHubStore } from "@sverka/hub";

const store = createHubStore(".sverka-hub");

const run = store.insertRun({
  project: "acme/app",
  entry: "ci",
  runId, // optional — minted when absent/invalid
  report, // parsed sverka.run/v1 report object
  findings, // Finding[] — counted into the index
});

for (const r of store.listRuns({ project: "acme/app", limit: 20 })) {
  /*…*/
}
store.getRun(run.runId);
store.flaky("acme/app", { n: 50 }); // per-step success rates
```

Cache blobs are content-addressed —
`cache/<project>/<sha256(key)>.blob` + a JSON meta — and snapshot files
are `snapshots/<project>/<runId>.json`. `isValidCacheKey` and
`isValidRunId` are the input guards the server applies before touching
the filesystem.

## Tokens, standalone

`parseTokensFile(text)` parses the `name:token:ro|rw` file format (with
`#` comments), and `resolveTokens` merges a tokens file with the
`SVERKA_HUB_ADMIN_TOKEN` env var — the same resolution the server does
when `HubServerOptions.tokens` is omitted.

## The dashboard pages (`@sverka/ui`)

The hub serves server-rendered HTML built on `@sverka/ui`'s `renderHub*`
functions — plain string renderers, no client JS:

| Function             | Page                                         |
| -------------------- | -------------------------------------------- |
| `renderHubIndex`     | `/` — projects index                         |
| `renderHubRunList`   | `/?project=<p>` — run list for a project     |
| `renderHubRunDetail` | `/runs/{project}/{runId}` — steps + findings |
| `renderHubFlaky`     | `/flaky/{project}` — flaky-step rates        |

Each takes `{ ...rows }` data (`HubRunRow`, `HubRunView`, `HubFlakyRow`)
and returns an HTML string. `renderDashboard` is the sibling function
behind `sverka ui` — the local dashboard that scans `.sverka/artifacts/`
for SARIF files (see [SARIF pipeline](../findings/sarif-pipeline.md)).
If you're building a custom run-history surface, compose these rather
than scraping the hub dashboard.

## The site surfaces (Spec 50)

Two related surfaces live on sverka.dev rather than in `@sverka/hub`:

- **Pipeline reports (Spec 50, shipped)** — `website/scripts/
gen-pipeline-data.ts` runs `sverka run --format html` against this repo
  and `examples/*/` during the site deploy and publishes the standalone
  reports under `/pipeline-reports/`. Always live data; a red pipeline
  renders too — the page never fails the deploy.
- **Findings hub (Spec 50, proposed)** — a hosted SARIF viewer that
  aggregates a GitHub repo's workflow-artifact SARIF, code-scanning
  alerts, and check-run annotations into one findings view, rendered
  in-browser with `@sverka/verification` normalization. Not built yet;
  the local equivalent today is [`sverka
view`/`sverka ui`](../findings/sarif-pipeline.md).

## See also

- [Remote run hub API](./api.md) — HTTP surface, tokens, `sverka run
--remote`, degradation behavior
- [SARIF pipeline](../findings/sarif-pipeline.md) — the local dashboard
  (`sverka ui`) and standalone viewers
- [Snapshot storage](../running/storage.md) — what the snapshots API
  stores
