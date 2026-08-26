# Feature: Background execution

**ID:** F-49
**Category:** execution
**Milestone:** M2
**Status:** Proposed
**Parent epic:** sv-4wh9

## Summary

Background execution runs a service or process that persists beyond the step's lifetime — useful for starting a local server, database, or mock service that subsequent steps interact with. Neither GitHub Actions nor GitLab CI have a native keyword for this. Sverka's native engine can support it; provider targets would emulate it.

## Provider matrix

| Aspect | GitHub Actions | GitLab CI | Sverka (proposed) |
|--------|---------------|-----------|-------------------|
| Construct | (none — `&` in shell) | (none — `&` in shell) | `background` on operation |
| Semantics | n/a | n/a | Start process, don't wait for completion |
| Value type | n/a | n/a | `background: boolean` |
| Limitations | no native support | no native support | provider: emulated via shell `&` |
| Provider gap | no native keyword | no native keyword | — |

## GitHub Actions

No native keyword. Workaround via shell backgrounding:

```yaml
steps:
  - name: Start server
    run: |
      npm start &
      echo $! > server.pid
      sleep 5  # wait for startup
  - name: Run tests
    run: |
      curl http://localhost:3000/health
      npm test
  - name: Stop server
    run: kill $(cat server.pid)
```

## GitLab CI

Same approach — shell backgrounding with `&`:

```yaml
start_server:
  script:
    - npm start &
    - sleep 5

test:
  needs: [start_server]
  script:
    - curl http://localhost:3000/health
    - npm test
```

## Sverka proposal

### Portable model

Add optional `background?: boolean` to shell operations. When true, the operation starts the process and returns immediately without waiting for completion. The process ID is stored for later cleanup.

```ts
interface ShellOperation {
  readonly kind: "shell";
  readonly command: string;
  readonly args?: readonly string[];
  readonly background?: boolean;
}
```

### Authoring API

```ts
task("start-server", {
  run: [
    sh`npm start` |> { background: true },
    sh`sleep 5`,  // wait for startup
  ],
}),

task("test", {
  run: sh`npm test`,
}).dependsOn("start-server"),
```

### Lowering

- **GitHub target:** `background: true` → append `&` to the run command. Store PID in a file for cleanup. Background processes are scoped to the job — they are killed when the job's runner terminates. Emit info diagnostic: "Background execution is emulated via shell `&` on GitHub. Processes are terminated when the job ends."
- **GitLab target:** `background: true` → append `&` to the script entry. Same emulation as GitHub. Processes are scoped to the job and terminated when the job ends.
- **Native engine:** spawn the process with `detached: true`, don't await. Store the child process handle. Background processes are scoped to the pipeline run — they are killed when the pipeline completes (success or failure). Cleanup is automatic: the engine tracks all background PIDs and sends SIGTERM (then SIGKILL after 2s grace) on pipeline exit. Cross-job persistence is best-effort and not guaranteed.

### Capability manifest

```ts
// githubCapabilities:
"execution.background": "emulated",  // shell &
// gitlabCapabilities:
"execution.background": "emulated",  // shell &
// nativeCapabilities:
"execution.background": "native",
```

### Portability & divergence

No provider has native background execution support. Both use shell `&` as a workaround. Sverka formalizes this as a `background` flag and handles process lifecycle in the native engine. The provider lowering is a simple `&` append.

## Non-goals

- Process supervision and restart on crash.
- Health checking and readiness probes.
- Port management and conflict detection.
- Process group management.

## Dependencies

- **Depends on:** F-09 (shell operations).
- **Blocks:** none.

## Open questions

- Should background processes be automatically killed when the pipeline completes?
- Should Sverka provide a `stopProcess()` operation for cleanup?
- Should the native engine track background process resource usage?
- Should `background` support a `timeout` for auto-termination?

## References

- GitHub: https://docs.github.com/en/actions/using-workflows/workflow-syntax-for-github-actions#jobsjob_idstepsrun
- GitLab: https://docs.gitlab.com/ee/ci/yaml/#script
- Architecture spec: §25, §32 (deferred)
