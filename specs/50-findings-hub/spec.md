# Spec 50 — Findings Hub (hosted SARIF viewer for GitHub repos)

**Status:** Proposed
**Parent:** uses spec 47 (`@sverka/sarif-viewer-web`) for rendering,
spec 15 (`@sverka/verification`) for `normalizeSarif`.

## Overview

A fully static site (deployed at sverka.dev or viewer.sverka.dev) that
aggregates **all findings of a GitHub repository into one view** — closing
the gap GitHub leaves between three scattered surfaces:

- **Workflow artifacts** — `*.sarif` files inside run artifact zips
  (what sverka itself emits via `outputs: { type: "artifact" }`)
- **Code scanning alerts** — everything uploaded via `codeql-action` /
  SARIF upload (zizmor, CodeQL, Scorecard, third-party tools)
- **Check-run annotations** — inline annotations emitted by actions

GitHub's Security tab shows only the second source, and only as an alert
table — not a per-commit/per-run picture. The hub renders the union.

This is a **funnel surface**, not a standalone product: it gives users
value before they install anything and demos the same findings pipeline
sverka runs locally. Dogfooding target #1 is sverka-dev/sverka itself
(eslint.sarif artifact + zizmor/CodeQL/Scorecard in code scanning).

## Goals

- Pure static site — **no backend, no database**. All data fetched from
  the GitHub REST API directly in the browser.
- Two auth modes:
  - **Anonymous** — public repos only (repo metadata + public code
    scanning alerts; ~60 req/hr rate limit shown in UI).
  - **Device Flow login** — GitHub OAuth Device Flow works without a
    client secret: `POST /login/device/code` → user verifies at
    github.com/login/device → poll `POST /login/oauth/access_token` with
    the app's public `client_id`. Unlocks private repos (with
    `security_events` read) and 5000 req/hr.
  - Token lives in `localStorage` only — "your token never leaves the
    browser" is a stated privacy feature.
- Repo picker → run picker → unified findings view:
  - Severity breakdown + tool/source breakdown (which tool produced what)
  - Cross-run trend ("findings over last N runs")
  - Filtering by severity/tool/file; finding detail panel
- Shareable views: SARIF can also be pasted/dropped directly, or carried
  in the URL hash (compressed) — no GitHub needed at all.
- Rendering reuses `generateSarifHtml`-level normalization
  (`@sverka/verification`) but runs **in-browser** — a SPA on top of the
  existing website Astro build (or a separate static bundle); NOT a new
  published package for v0.

## Data sources (GitHub REST)

| Source | Endpoint | Auth |
| --- | --- | --- |
| Run artifacts | `GET /repos/{o}/{r}/actions/runs/{run}/artifacts` → download zip → `*.sarif` | token required |
| Code scanning | `GET /repos/{o}/{r}/code-scanning/alerts` | token (public repos: any token) |
| Annotations | `GET /repos/{o}/{r}/check-runs/{id}/annotations` | token |

Artifact zips are unzipped in-browser (fflate). Artifact retention is
90 days — surface a "gone" state for expired runs.

## Non-goals

- No backend, no accounts, no stored history (v0). Server-side
  aggregation is explicitly deferred — revisit only if the static version
  proves pull.
- No new npm package in v0 — code lives under `website/` (or a sibling
  app dir) and ships as a static bundle.
- No editing/triage actions (dismiss alerts etc.) — read-only view.
- GitLab support — deferred; the API surface differs (job artifacts,
  security dashboard) and doubles scope.

## Risks

- **Narrow data funnel**: most repos upload SARIF via codeql-action
  rather than emitting artifact files → code scanning is the primary
  source, artifacts secondary. Positioning is "all findings, one view",
  not "artifact viewer".
- **Competes with native Security tab** — must beat it on aggregation +
  cross-run history, not on single-alert display.
- Rate limits in anonymous mode; token UX friction in private mode.

## Test plan

- Unit: SARIF-in-zip extraction, alert→Finding normalization, URL-hash
  encode/decode round-trip.
- E2E (manual, on sverka-dev/sverka): open repo → pick latest run →
  eslint.sarif artifact + code scanning alerts rendered in one table.
- E2E anonymous: public repo without login renders code scanning alerts.
- Privacy check: no token or finding content sent anywhere but
  api.github.com.
