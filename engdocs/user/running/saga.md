# Saga compensations

> **Work in progress.** Saga compensations are implemented in the native
> engine. CI targets emulate via `sverka execute`. APIs may change.

When a run ends in `failure`, the engine automatically runs **compensation
operations** for succeeded steps that declared one, in reverse completion
order. A compensation undoes a step's side effects — rollback a deploy,
delete a created resource, send a cancellation notice.

Inspired by the Temporal saga pattern, but deliberately simpler: no
compensation transactions, no forward recovery, no per-branch scoping —
just ordered rollback of completed work.

## Declaring a compensation

```ts
import { Project, Pipeline, ShellStep, Entry } from "@sverka/workflow";

const proj = new Project("myproj");
const p = new Pipeline(proj, "ci");

new ShellStep(p, "deploy", {
  command: "kubectl apply -f deploy.yaml",
  compensation: { kind: "shell", command: "kubectl rollout undo deployment/my-app" },
});

new ShellStep(p, "notify", {
  command: "curl -X POST $WEBHOOK_URL",
  dependsOn: ["deploy"],
});

new Entry(p, "on-push", { trigger: { kind: "push" }, roots: ["notify"] });
```

## How it works

1. The engine tracks the order steps **succeed** during a run.
2. If the run ends in `failure` (not `cancelled`), the engine walks the
   completion list **backwards** and executes each step's compensation.
3. Compensations run **serially** via the step's own runtime driver in the
   step's workspace.
4. A failed compensation emits a `warn` diagnostic but does **not** block
   subsequent compensations — best-effort rollback.
5. If `cancel()` fires during the compensation phase, remaining
   compensations are skipped (the abort signal is checked before each
   compensation).

## Events

| Event | When |
|-------|------|
| `step-compensating` | A compensation is about to run (carries `command`) |
| `step-compensated` | A compensation finished (carries `status: "succeeded" \| "failed"` and `durationMs`) |

## Limitations (v1)

- **Shell only.** Compensation operations must be `kind: "shell"`. Other
  kinds raise a synthesis error.
- **No retries.** A compensation runs once. If it needs retry, the command
  itself implements it.
- **No cancellation compensation.** Cancelled runs do not trigger
  compensations — cancellation is intentional.
- **No branch scoping.** v1 compensates ALL succeeded steps with a declared
  compensation, in reverse completion order.
- **CI targets are emulated.** The compiled workflow runs `sverka execute`,
  which uses the native engine for compensation at runtime. Native
  `if: failure()` lowering is a follow-up.
