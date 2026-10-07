# Spec 55 — Remote Run Hub

**Status:** Proposed
**Source:** direction program sv-44n5 (strategy review, 2026-10)
**Package:** `@sverka/storage` (remote adapters), `@sverka/cli` (`--remote`, `sverka hub`), `@sverka/ui` (dashboard), new `@sverka/hub` (self-hosted server)
**Bead:** sv-44n5.3
**Blocks:** sv-44n5.5 (hosted engine workers consume the hub queue)
**Related:** Spec 19 (cachestore), Spec 31 (storage), Spec 32 (run queries), Spec 38 (observability/RunReport), Spec 50-findings-hub, Spec 21 (RunEvent)

## Overview

The nx-cloud model, deliberately scoped: **remote cache + run
history**, not hosted compute. Two cheap primitives the monorepo
already half-built, plus one thin server:

1. **Remote cache** — a `CacheStore` adapter backed by HTTP object
   storage. `sverka run` on a second machine (or CI) hits the same
   content-addressed cache keys the local file cache uses (Spec 19).
2. **Run history** — after each run, the engine's `RunReport`
   (Spec 38) + normalized findings are uploaded to the hub; a
   dashboard (reusing `@sverka/ui` and Spec 50 findings-hub
   rendering) shows run lists, trends, flaky steps, and policy
   verdict history.

Two deployment shapes:

- **Self-hosted (ships first).** `sverka hub serve` — a single
  binary/container + any S3-compatible bucket (or filesystem).
  Zero multi-tenancy: one token file, one project per hub.
  Sverka dogfoods it on this repo's CI.
- **Sverka-hosted (gated).** Same binary behind multi-tenant auth.
  Activated only when the self-hosted path proves demand
  (see "Adoption gate").

**Critical invariant:** the hub is a read/write-through cache and
a report sink — it is _never_ in the run's critical path. Every
remote failure degrades to local behaviour + a warn diagnostic.
A run MUST NOT fail because the hub is down.

## Goals

- `RemoteCacheStore implements CacheStore` (Spec 19 contract):
  `restore(req)` → `GET /v1/cache/{key}`; `store(req)` →
  `PUT /v1/cache/{key}` with the archived `paths` payload.
  Content-addressed by the same key derivation as the file cache —
  no second key scheme.
- `RemoteSnapshotStore implements SnapshotStore` (Spec 31):
  suspend/resume works across machines (a suspended run resumed
  on CI is the demo case).
- `sverka run --remote` (or `remote: true` in config) uploads
  `report.json` + findings + step-level timings to
  `POST /v1/runs` at run end. Upload is async and never blocks
  exit code.
- `sverka login --hub <url>` stores a token in
  `~/.config/sverka/credentials` (0600); `SVERKA_HUB_TOKEN` env var
  overrides for CI. `SVERKA_HUB_URL` env var overrides config.
- `sverka hub serve` — self-hosted: filesystem or S3 bucket +
  SQLite index. Single token from `SVERKA_HUB_ADMIN_TOKEN` or a
  `.sverka-hub/tokens` file.
- Dashboard (hub-served, static SPA from `@sverka/ui`):
  - run list (project, entry, status, duration, timestamp);
  - run detail (Spec 51 report renderer, embedded);
  - findings trend per check (Spec 50 findings-hub components);
  - flaky view: per-step success rate over last N runs.
- API is versioned `/v1/`, documented in
  `engdocs/user/hub/api.md`. JSON only.
- Offline/degraded: `restore` miss on network error → local cache;
  `store` failure → warn event; `POST /v1/runs` failure → warn
  line on stderr, exit code unchanged. Configurable timeout
  (default 3 s connect, 30 s body).

## Non-goals

- Hosted execution / remote workers — that is Spec 57, and it
  _consumes_ this hub's queue. Not here.
- Real-time event streaming (live run tail) — run upload is
  end-of-run; streaming is a follow-up if the dashboard needs it.
- Multi-tenant billing, orgs, SSO, RBAC — v1 self-hosted is
  single-token; the hosted variant adds tenancy later.
- SARIF ingestion from non-sverka tools — that is Spec 50
  findings-hub's scope; the hub stores sverka-native findings.
- General-purpose blob API — only cache + runs + snapshots.

## Interfaces

### Client (`@sverka/storage`)

```ts
export interface RemoteStoreConfig {
  readonly url: string; // hub base URL
  readonly token: string; // Bearer token
  readonly timeoutMs?: number; // default 3000 connect / 30000 body
  readonly project: string; // namespace, e.g. "sverka-dev/sverka"
}

export function createRemoteCacheStore(c: RemoteStoreConfig): CacheStore;
export function createRemoteSnapshotStore(c: RemoteStoreConfig): SnapshotStore;
export function uploadRunReport(
  c: RemoteStoreConfig,
  report: RunReport,
  findings: readonly Finding[],
): Promise<void>;
```

### Hub API (`@sverka/hub`, `/v1/`)

```text
PUT    /v1/cache/{project}/{key}          body: tar.zst blob
GET    /v1/cache/{project}/{key}          → 200 blob | 404
POST   /v1/runs                           body: RunReport + findings
GET    /v1/runs?project=&limit=&before=   → RunSummary[]
GET    /v1/runs/{runId}                   → RunReport + findings
PUT    /v1/snapshots/{project}/{runId}    body: RunSnapshot
GET    /v1/snapshots/{project}/{runId}    → RunSnapshot | 404
GET    /v1/flaky/{project}?steps=&n=      → { stepId, successRate, runs }[]
```

Auth: `Authorization: Bearer <token>`; self-hosted has a single
read/write token plus optional read-only tokens
(`tokens` file: `name:token:ro|rw`).

### CLI

```text
sverka login --hub <url> --token <t>     # writes credentials file
sverka run --remote                      # remote cache + upload
sverka hub serve --port 7357 --data ./.sverka-hub
sverka runs --remote                     # list remote runs
```

Config (`sverka.config.ts` or `.sverka/hub.json`):

```ts
remote: {
  url: "https://hub.internal.example",
  project: "sverka-dev/sverka",   // default: git remote slug
  cache: true,                    // default true when remote set
  upload: true,                   // default true when remote set
}
```

## Data models

- Cache blob: `tar.zst` of the step's declared `paths`, identical
  payload to the file cache entry (Spec 19) — one format, two
  backends.
- `RunSummary`: `{ runId, project, entry, status, startedAt,
durationMs, findingCounts, policyVerdict? }` — index rows for
  the list view; `POST /v1/runs` returns `{ runId, url }`.
- Flaky aggregation is computed server-side over stored reports —
  no client-side scan.

## Error handling

- All client errors degrade to local + warn diagnostics
  (`remote.cache-unreachable`, `remote.upload-failed`), never
  thrown to the run. The engine already treats `CacheStore`
  failures as non-fatal (Spec 19 contract).
- `401/403` → warn once naming `sverka login`, then behave as
  hub-down for the rest of the run.
- Hub-side: oversize blob (> configurable 512 MB) → `413`;
  malformed key (non `[a-z0-9-]`/length) → `400`; unknown runId →
  `404`.
- `HubError` (new, `@sverka/storage`): wraps fetch failures;
  `override readonly cause`; code `REMOTE_UNAVAILABLE |
REMOTE_REJECTED`. Never escapes the engine boundary.

## Test plan

1. `RemoteCacheStore` against a fixture hub: `store` then
   `restore` round-trip yields identical files (hash compare).
2. Restore on hub 404 → `undefined` (miss), no throw.
3. Restore on network timeout → `undefined` + warn event, run
   continues (engine-level test).
4. `sverka run --remote` with hub down: run exits with the check
   verdict, stderr contains `remote.upload-failed`, exit code
   unchanged.
5. `sverka hub serve` + second checkout: cache populated on
   machine A is a hit on machine B (integration test, tmp dirs).
6. `POST /v1/runs` → `GET /v1/runs/{id}` returns the report with
   findings intact (SARIF round-trip through Spec 15 normalize).
7. Flaky endpoint: 10 stored runs with a step failing 3× →
   `successRate ≈ 0.7` for that step.
8. Token scoping: `ro` token can GET but gets `403` on PUT/POST.
9. `sverka login` writes `~/.config/sverka/credentials` mode 0600;
   `SVERKA_HUB_TOKEN` env takes precedence.
10. Dashboard: `GET /` serves the SPA; run detail renders a stored
    report (snapshot test on built assets).
11. Snapshot store: suspend on machine A → resume on machine B
    against shared hub (Spec 29 semantics preserved).

## Adoption gate

The sverka-hosted multi-tenant plane activates when **≥ 10
external projects run against self-hosted hubs** (counted via
opt-in telemetry ping `GET /v1/ping` — documented, off by default
in self-hosted builds). Below that, the hosted path is a config
value, not a service. Rationale: remote cache is the cheapest
possible demand signal for hosted compute — if nobody shares a
cache, nobody rents runners.
