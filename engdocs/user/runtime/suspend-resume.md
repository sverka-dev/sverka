# Suspend and resume

> **Work in progress.** Suspend/resume is implemented in the native engine.
> Snapshot persistence adapters (SQLite, Postgres) are planned. APIs may
> change.

A step can **suspend** a run: pause execution, persist a snapshot, and wait
for external input. A later **resume** call reloads the snapshot, injects
the resume data as the suspended step's output, and continues scheduling
downstream steps.

## When to use suspend

- **Human-in-the-loop approvals** — suspend before a deploy step, wait for
  manual approval, resume with the decision.
- **External service callbacks** — suspend after triggering a build, wait
  for the build system to call back with results.
- **Interactive AI workflows** — suspend an agent step, present output to a
  user, resume with their feedback.

## How it works

1. A step with a `suspend` operation runs its pre-suspend operations
   normally. `suspend` must be the **last operation** in the step.
2. The engine persists a `RunSnapshot` (completed steps, their scalar
   outputs, the suspended step id, resume schema) to a `SnapshotStore`.
3. The run enters `suspended` status. The `run-suspended` event is emitted.
4. External caller invokes `Engine.resume()` with resume data.
5. The engine reloads the snapshot, injects the resume data as the
   suspended step's output, marks the step as succeeded, and continues
   scheduling downstream steps.

## Declaring a suspend step

### Construct API

```ts
import { Project, Pipeline, SuspendStep, Entry } from "@sverka/cdk";

const proj = new Project("approval");
const p = new Pipeline(proj, "deploy-with-approval");

new SuspendStep(p, "await-approval", {
  resumeSchema: { required: ["approved", "approver"] },
});

new ShellStep(p, "deploy", {
  command: "kubectl apply -f deploy.yaml",
  dependsOn: ["await-approval"],
});

new Entry(p, "on-push", { trigger: { kind: "push" }, roots: ["deploy"] });
```

### SDK builder

```ts
import { sverka } from "@sverka/sdk";

const p = sverka.pipeline("deploy-with-approval");

sverka.suspend("await-approval", {
  resumeSchema: { required: ["approved", "approver"] },
});

sverka.step("deploy")
  .sh("kubectl apply -f deploy.yaml")
  .dependsOn("await-approval");
```

## Resuming a run

```ts
import { createEngine } from "@sverka/runtime";
import { InMemorySnapshotStore } from "@sverka/runtime";

const store = new InMemorySnapshotStore();
const engine = createEngine({ snapshotStore: store });

// Start the run — it will suspend at the await-approval step
const iter = engine.run({ plan, snapshotStore: store, workspace: "./ws" });
for await (const event of iter) {
  if (event.type === "run-suspended") {
    console.log("Run suspended, waiting for resume...");
  }
}

// Later: resume with external data
const resumeIter = engine.resume({
  runId: "run-123",
  data: { approved: "true", approver: "alice" },
  snapshotStore: store,
});
for await (const event of resumeIter) {
  console.log(event.type);
}
```

## Events

| Event | When |
|-------|------|
| `step-suspended` | A step has suspended — snapshot is being persisted |
| `run-suspended` | The run is now suspended, waiting for resume |
| `run-resumed` | The run has been resumed from a snapshot |

## Snapshot stores

| Store | Status | Use case |
|-------|--------|----------|
| `InMemorySnapshotStore` | Implemented | Tests, ephemeral runs |
| SQLite adapter | Planned | Local persistent runs |
| Postgres adapter | Planned | Distributed runs |

## Limitations (v1)

- **One suspended step per run.** Concurrent suspend is not supported —
  in-flight steps are awaited before the snapshot is persisted.
- **No mid-step checkpointing.** `suspend` must be the last operation in a
  step. Pre-suspend operations run normally; their outputs are captured.
- **CI targets are emulated.** The compiled workflow runs `sverka execute`,
  which uses the native engine for suspend/resume at runtime.
