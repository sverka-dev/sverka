# ADR-018 — Hosted Engine: Staged Path (Bootstrap → Self-Hosted Worker → Managed)

**Status:** Active (decision record — Stages B/C deferred on explicit gates)
**Date:** 2026-10-09
**Related:** Spec 57, Spec 55 (remote run hub), Spec 38 (RunReport), Spec 27
(agent steps), Spec 29 (suspend/resume), Specs 33–36 (superseded codegen
targets), ADR-016 (codegen targets), architecture spec §28 (Hosted Native
Engine)

## Context

Architecture spec §28 anticipated two hosted execution strategies:
target-native lowering (exists today — `sverka compile` emits per-step
GHA/GitLab jobs) and hosted engine mode (a bootstrap job that runs the
native engine inside provider compute).

Two pieces of evidence shape the decision:

- **Dead targets.** Specs 33–36 (Temporal, Dagger, Inngest, Drone code
  generators, ADR-016) were implemented and then removed. Translating the
  Definition Graph into foreign engine runtimes produced maintenance cost
  with zero users. Hosted execution must never mean "compile to someone
  else's runtime" again.
- **No queue exists.** Spec 55 ships the hub as a cache + report sink,
  deliberately _not_ a scheduler. Remote workers need a queue; a queue
  without demand is speculative infrastructure.

Sandbox primitives (`bwrap` step sandboxing, `unshareNet`, Spec 26 network
allowlists) already landed for local runs — groundwork a hosted worker
would reuse, but not a reason to build one.

## Decision

A staged path, with each stage gated on observable demand:

### Stage A — Bootstrap-job mode (now; documentation only)

A single CI job runs `sverka run` — the native engine executes the whole
Run Plan inside one provider job. This works today (agent steps included,
via in-job `AgentDriver`s) and is exercised by this repo's `self-run` job
in `.github/workflows/sverka.yml`. Stage A's deliverable is user
documentation (`engdocs/user/execution/hosted-bootstrap.md`), not code —
the trade-off versus per-step lowering is provider UI granularity.

### Stage B — Self-hosted worker (build when demanded)

A long-lived `sverka worker` polls a `RunQueue` on the Spec-55 hub:
`sverka run --submit` enqueues a serialized `RunPlan` + `WorkspaceRef`;
the worker claims, materializes the checkout, executes with the native
engine, and completes against the same `POST /v1/runs` sink Stage A
uses. Self-hosted means the user's worker, hub, and machines — Sverka
ships the binary, not the fleet.

The contract — `RunQueue`, `QueuedRun`, `WorkerCapabilities`,
`WorkspaceRef` — is committed to `@sverka/runtime` as **interfaces only**
(no implementation, no runtime dependency) so that when Stage B is
justified, the worker and the hub endpoint are designed against one
shape. `RunQueue.complete()` takes the report as
`Record<string, unknown>` plus the run's normalized findings — the
pieces Spec 55's `uploadRunReport` already accepts (`project`/`entry`
come from the claimed `QueuedRun`, not the worker). Spec 38's typed
`RunReport` model replaces the open records when it lands.

### Stage C — Managed workers (the SaaS compute plane)

Sverka-operated workers behind a multi-tenant hub. **Gate: Spec 55's
adoption gate (≥ 10 external projects on self-hosted hubs) PLUS explicit
requests.** Paid compute requires untrusted-code isolation that is
bwrap-grade per tenant; Stage B workers are single-tenant by definition,
so per-tenant sandboxing is a Stage C problem.

## Non-goals (the dead ends, recorded)

- **No foreign-engine codegen.** Temporal/Dagger/Inngest/Drone targets
  were deleted; hosted execution means _the sverka engine running
  remotely_, never translating graphs into another runtime's model.
- **No always-on control plane before Stage B.** The hub (Spec 55) is a
  cache + report sink. The queue is added when demanded, not anticipated.
- **No free-tier or pricing design** before the queue exists.
- **No multi-tenant isolation work** — Stage C only, and Stage C is
  gated.

## Demand signals (when Stage B becomes justified)

| Signal               | Where it shows                  | Threshold              |
| -------------------- | ------------------------------- | ---------------------- |
| Self-hosted hubs     | Spec 55 telemetry ping (opt-in) | ≥ 10 external projects |
| Remote cache sharing | `/v1/cache` cross-machine hits  | sustained, multi-org   |
| `--submit` requests  | issue tracker / direct asks     | any paying-grade ask   |

If none materialize, Stage B never ships and this record is the outcome —
correct, not a failure.

## Consequences

- `@sverka/runtime` exports four new type-only symbols (`RunQueue`,
  `QueuedRun`, `WorkerCapabilities`, `WorkspaceRef`). Public surface
  grows by interfaces with no backing code — documented as such.
- New user docs page `engdocs/user/execution/hosted-bootstrap.md`
  teaches the bootstrap job as a supported execution mode today.
- `sverka run --submit`, `sverka worker`, and the `/v1/runs/queue` hub
  endpoint remain unbuilt; their shape is pinned here so a future
  implementer doesn't re-derive (or re-litigate) it.
- Future spec-38 work owns the canonical `RunReport` type; this ADR's
  queue sketch deliberately does not claim that name.
