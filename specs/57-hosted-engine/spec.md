# Spec 57 — Hosted Engine

**Status:** Proposed (deferred — decision record + staged path only)
**Source:** direction program sv-44n5 (strategy review, 2026-10); architecture spec §28 (Hosted Native Engine)
**Package:** `@sverka/runtime` (worker contract), `@sverka/hub` (run queue — Spec 55), `engdocs/architecture/` (ADR)
**Bead:** sv-44n5.5
**Depends on:** sv-44n5.3 (Spec 55 Remote Run Hub — queue transport + demand signal)
**Related:** Spec 10 (engine-native), Spec 28 (mcp-server), Spec 29 (suspend/resume), Spec 31 (storage), Specs 33–36 (delegated codegen targets — **superseded**), ADR-012, §28 architecture spec

## Overview

This spec is a **decision record, not a build plan**. It pins the
path to hosted execution so that demand — if it arrives — has a
designed landing spot, and so that nobody re-opens the dead ends.

Context the decision must respect:

- Architecture spec §28 anticipated two hosted strategies:
  target-native lowering (exists today: GHA/GitLab) and hosted
  engine mode (a bootstrap job running the Sverka engine).
- Specs 33–36 (Temporal, Dagger, Inngest, Drone codegen targets)
  were implemented and then **removed as dead targets**. The
  lesson: compiling the Definition Graph into foreign engine
  runtimes produced maintenance cost without users. This spec
  explicitly does NOT revive that path.
- Sandbox primitives already landed for other reasons
  (`bwrap` step sandboxing, `unshareNet` network isolation,
  Spec 26 network allowlists) — they are the groundwork a hosted
  worker would need, not a reason to build one.
- Spec 55's adoption gate is the demand signal: if external
  projects run self-hosted hubs, remote execution is the next
  question they will ask.

## Staged path

### Stage A — Bootstrap-job mode (already works; document it)

Compiled GHA/GitLab workflows can run `sverka execute` inside a
single job — the "hosted engine mode" of §28 strategy 2, using
the provider's compute. Agent steps run `emulated` this way today
(Spec 27). Work item: **documentation only** — an
`engdocs/user/execution/hosted-bootstrap.md` page showing the
trade-off (one provider job running the engine's feature set —
suspend/resume excluded: `Engine.resume()` throws
`RESUME_NOT_IMPLEMENTED` today and the bootstrap job wires no
snapshot store — with less provider UI granularity) versus
per-step native lowering.

### Stage B — Self-hosted worker (build when demanded)

A long-lived `sverka worker` process polling a `RunQueue` on the
Spec-55 hub:

```ts
export interface RunQueue {
  claim(
    workerId: string,
    capabilities: WorkerCapabilities,
  ): Promise<QueuedRun | undefined>;
  heartbeat(runId: string): Promise<void>;
  complete(
    runId: string,
    report: RunReport,
    findings: readonly Finding[],
  ): Promise<void>;
  fail(runId: string, error: string): Promise<void>;
}

export interface QueuedRun {
  readonly runId: string;
  readonly project: string;
  readonly runPlan: RunPlan; // serialized, spec 06/32
  readonly workspaceRef: WorkspaceRef; // git ref or tarball URL
}

export interface WorkerCapabilities {
  readonly runtimes: readonly ("host" | "container")[];
  readonly network: "none" | "allowlist";
  readonly maxSteps?: number;
}
```

Submission side: `sverka run --submit` serializes the RunPlan +
workspace ref to `POST /v1/runs/queue` (an addition to the Spec 55
API, versioned when built). A worker claims it, materializes the
workspace, executes with the native engine, and uploads report +
findings — the SAME `POST /v1/runs` envelope
(`{project, entry, report, findings}`, Spec 55) Stage A already
uses; `project`/`entry` come from the claimed `QueuedRun`. No
new observability surface.

Self-hosted means: the user's worker, the user's hub, the user's
machines. Sverka ships the binary, not the fleet.

### Stage C — Managed workers (the actual SaaS compute plane)

Sverka-operated workers behind the multi-tenant hub. **Gate:
spec 55's adoption gate PLUS explicit requests** — a queue a
customer pays for requires untrusted-code isolation that is
bwrap-grade per-tenant (single-tenant workers first, like
Buildkite agents). This stage is out of scope until both
conditions hold; the spec records the interface so Stage B
doesn't paint Stage C into a corner.

## Explicit non-goals (the dead ends)

- **No foreign-engine codegen.** Temporal/Dagger/Inngest/Drone
  targets were deleted; hosted execution means _the sverka engine
  running remotely_, never translating graphs into someone
  else's runtime model again.
- **No always-on control plane before Stage B.** The hub (55) is
  a cache+report sink, not a scheduler. Adding a queue is Stage
  B, gated on demand, not anticipation.
- **No free tier design.** Pricing is meaningless before the
  queue exists; revisit at Stage C.
- **No multi-tenant isolation work.** Stage B workers are
  single-tenant by definition; per-tenant sandboxing is a Stage
  C problem and Stage C is gated.

## What "demand" looks like (observable gates)

| Signal               | Where it shows                  | Threshold                |
| -------------------- | ------------------------------- | ------------------------ |
| Self-hosted hubs     | spec 55 telemetry ping (opt-in) | ≥ 10 external projects   |
| Remote cache sharing | `/v1/cache` cross-machine hits  | sustained, multiple orgs |
| `--submit` requests  | issue tracker / direct asks     | any paying-grade ask     |

If none materialize, Stage B never ships and this spec remains
the design record — which is the correct outcome, not a failure.

## Test plan (Stage A only — B/C defined, not built)

1. Docs page exists and compiles an example: a `.gitlab-ci.yml`
   and a `.github/workflows/*.yml` that run `sverka execute` in
   one job, rendered from a real `sverka synth` output.
2. The bootstrap example runs end-to-end in this repo's own CI
   (dogfood: a pipeline that executes the native engine inside a
   single job).
3. `RunQueue`/`QueuedRun`/`WorkerCapabilities` types are defined
   in `@sverka/runtime` as interfaces only — no implementation,
   no runtime dependency. Type-level test asserts the shapes.
4. ADR drafted at `engdocs/architecture/adr/` recording: staged
   path, dead-target lesson (33–36), gates, and the non-goals
   above. The ADR is the deliverable; the interfaces are sketches
   to keep Stage B options open.
