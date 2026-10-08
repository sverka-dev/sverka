# Remote Run Hub API

The remote run hub (Spec 55) provides two things, in the nx-cloud model:
a **shared remote cache** and **run history** (reports + findings). The
self-hosted shape ships first — a single binary plus a data directory —
so the model is dogfooded before any hosted plane is considered.

```text
sverka run --remote
       │
       ├──→ GET/PUT /v1/cache/{project}/{key}     (tar.zst blobs)
       ├──→ PUT    /v1/snapshots/{project}/{runId} (suspend/resume)
       └──→ POST   /v1/runs                        (report + findings)
                     │
                     ▼
              sverka hub serve
                     │
       ┌─────────────┼──────────────┐
       ▼             ▼              ▼
   cache blobs    hub.db        tokens file
   (filesystem)   (sqlite)      (ro|rw)
                     │
                     ▼
              dashboard at /
       (run list · run detail · flaky steps)
```

## Running a hub

```sh
sverka hub serve --port 7357 --data ./.sverka-hub
```

On first start with no tokens configured, the server generates an admin
token, appends it to `<dataDir>/tokens`, and prints it once:

```text
sverka hub: generated admin token svk_xxxxxxxx
  saved to /path/.sverka-hub/tokens
```

### Tokens

`<dataDir>/tokens` holds one `name:token:ro|rw` per line (`#` comments
allowed). `rw` tokens may write; `ro` tokens may only read.

```text
ci:svk_aaa…:rw
dashboard-viewer:svk_bbb…:ro
```

`SVERKA_HUB_ADMIN_TOKEN` adds an `rw` token without editing the file.

### Storage layout

```text
.sverka-hub/
  hub.db                 # SQLite run index
  tokens                 # name:token:ro|rw
  cache/<project>/       # <sha256(key)>.blob + .json meta
  snapshots/<project>/   # <runId>.json
```

## Client configuration

```sh
sverka login --hub http://hub.internal:7357 --token svk_…
```

`login` writes `~/.config/sverka/credentials` (JSON map of hub URL →
token, mode `0600`). Env vars win over the file:

- `SVERKA_HUB_URL` — hub base URL
- `SVERKA_HUB_TOKEN` — bearer token

Per-repo settings live in `.sverka/hub.json`:

```json
{
  "remote": {
    "url": "http://hub.internal:7357",
    "project": "acme/app",
    "cache": true,
    "upload": true,
    "enabled": false
  }
}
```

`project` defaults to the git `origin` slug (`owner/repo`), then the
directory basename. `enabled: true` makes `sverka run` remote without
the `--remote` flag.

## CLI

```text
sverka login --hub <url> --token <t>    # store credentials (0600)
sverka run --remote                     # remote cache + report upload
sverka hub serve --port 7357 --data ./.sverka-hub
sverka runs --remote                    # list runs stored on the hub
sverka runs                             # list local .sverka/runs reports
```

## HTTP API (`/v1/`)

All API responses are JSON. Auth is `Authorization: Bearer <token>`;
the dashboard also accepts `?token=` (promoted to a cookie).

| Method   | Path                               | Description                                                                      |
| -------- | ---------------------------------- | -------------------------------------------------------------------------------- |
| `GET`    | `/v1/ping`                         | health check (unauthenticated)                                                   |
| `PUT`    | `/v1/cache/{project}/{key}`        | store a cache blob (`tar.zst` body)                                              |
| `GET`    | `/v1/cache/{project}/{key}`        | fetch a blob — exact key, else newest prefix match (header `x-sverka-cache-key`) |
| `POST`   | `/v1/runs`                         | upload `{ project, entry, runId?, report, findings }` → `201 { runId, url }`     |
| `GET`    | `/v1/runs?project=&limit=&before=` | run summaries, newest first                                                      |
| `GET`    | `/v1/runs/{runId}`                 | full run: report + findings                                                      |
| `PUT`    | `/v1/snapshots/{project}/{runId}`  | store a run snapshot                                                             |
| `GET`    | `/v1/snapshots/{project}/{runId}`  | fetch a snapshot (`404` on miss)                                                 |
| `DELETE` | `/v1/snapshots/{project}/{runId}`  | delete a snapshot                                                                |
| `GET`    | `/v1/flaky/{project}?n=&steps=`    | per-step success rates over the last `n` runs                                    |

Errors are JSON `{ code, message }` — `400` malformed key/body, `401`
missing/invalid token, `403` read-only token on a write, `404` unknown
run/blob, `413` payload over the size cap (default 512 MiB blobs,
32 MiB JSON).

## Degradation

Remote failures never fail a run. A cache miss, timeout, or refused
connection degrades to local behaviour with a `remote.cache-unreachable`
or `remote.upload-failed` warning on stderr. A `401/403` response warns
once naming `sverka login`, then the run treats the hub as down for the
rest of the run.

Timeouts: 3 s connect, 30 s body transfer (per request).

## Dashboard

The hub serves a server-rendered dashboard (built on `@sverka/ui`):

- `/` — projects index; `/?project=<p>` — run list for a project
- `/runs/{project}/{runId}` — run detail (steps table + embedded
  findings report)
- `/flaky/{project}` — flaky-step rates over the last N runs

Open it with `http://<host>:<port>/?token=<t>` once; the token moves
into an `HttpOnly` cookie for subsequent navigation.
