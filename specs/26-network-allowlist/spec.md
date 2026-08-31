# Spec 26 — Network Allowlist

**Status:** Active
**Source:** specs/architecture-spec.md §14.1 (Runtime), §22.4 (Runtime drivers), §19 (Target contract)
**Package:** `@sverka/workflow` (model: `Runtime.network`), `@sverka/compiler` (github/gitlab lowering), `@sverka/runtime` (docker driver: `--network` + DNS filtering)
**Bead:** sv-wthn.2.5
**Related:** Spec 10 (engine-native), Spec 11 (runtime-host), Spec 12 (runtime-docker), Spec 08 (github), Spec 09 (gitlab)

## Overview

Per-step egress control. A step's `Runtime` declaration gains an optional
`network` field specifying allowed egress domains. Container steps run with
network disabled by default (`--network none`); a step with
`network: { allowed: ["registry.npmjs.org"] }` gets network access
restricted to those domains. Host steps emit a `diagnostic` (the native
engine cannot firewall host processes without OS-level support — documented
as a limitation). GHA target emits a comment annotation (no native per-job
egress control); GitLab target emits a `variables` annotation.

Inspired by gh-aw AWF firewall. Makes network access explicit and auditable.

## Goals

- `NetworkAllowlist` added to `Runtime` (cdk/model.ts): `{ allowed: readonly
  string[] }`.
- `Runtime` gains `readonly network?: NetworkAllowlist`.
- `StepDefinition.runtime.network` propagated by `synthesize()`.
- Docker driver: `network.allowed` → `--network` flag + DNS-level filtering
  via `--add-host` redirects (block-all except allowed domains). Empty
  `allowed` or absent `network` → `--network none` (default deny).
- Host driver: no syscall-level firewall (documented limitation); emits a
  `diagnostic` (info) noting the allowlist is not enforced on host runtime.
- GHA target: emits a `# sverka:network-allowlist: <domains>` comment
  annotation on the job (no native per-job egress control in GHA).
- GitLab target: emits a `variables: { SVERKA_NETWORK_ALLOWLIST: "<domains>"
  }` annotation on the job.
- `runtime.network` capability declared in target manifests: GHA
  `emulated` (annotation only), GitLab `emulated` (annotation only),
  native engine `native` (docker) / `partial` (host — not enforced).

## Non-goals

- OS-level firewall for host processes (iptables, nftables) — out of scope;
  requires root and is platform-specific. Host allowlist is advisory only.
- TLS interception / content filtering — out of scope; domain-level DNS
  filtering only.
- IPv6-specific handling — follow-up.
- Wildcard domain matching (`*.npmjs.org`) — supported via simple suffix
  match; no complex glob.
- Network allowlist for the legacy `runtime/` scheduler — not extended
  (ADR-011).
- Per-operation network policy (the existing `OperationSpec.network` with
  `deny|allow-host|allow-egress` is the legacy coarse model) — this spec
  adds **domain-level allowlists** on `Runtime`, the canonical model.

## Interfaces

### Model (`@sverka/workflow` cdk/model.ts)

```ts
export interface NetworkAllowlist {
  readonly allowed: readonly string[]; // e.g. ["registry.npmjs.org", "github.com"]
}

export interface Runtime {
  readonly mode?: "host" | "container";
  readonly image?: string;
  readonly env?: Readonly<Record<string, string>>;
  readonly secrets?: readonly string[];
  readonly workingDir?: string;
  readonly shell?: string;
  readonly network?: NetworkAllowlist; // NEW
}
```

### Docker driver (`@sverka/runtime` runtime-docker)

`buildDockerArgs` extended: if `step.runtime.network` is set with non-empty
`allowed`, emit `--network <custom>` with a per-step network config; if
`allowed` is empty or `network` absent, emit `--network none` (default
deny). The DNS filtering uses `--add-host` entries that redirect
non-allowed domains to `127.0.0.1` (block) — a pragmatic container-level
filter without iptables.

### Host driver (`@sverka/runtime` runtime-host)

No change to execution. `executeShell` emits a `diagnostic` (info) if
`step.runtime.network` is set: `"network allowlist not enforced on host
runtime"`.

### GHA target (`@sverka/compiler` github)

`assembleGithubJob` extended: if `step.runtime.network` is set, emit a
comment step before the job's main steps:
`# sverka:network-allowlist: registry.npmjs.org,github.com`.

### GitLab target (`@sverka/compiler` gitlab)

Job lowering extended: if `step.runtime.network` is set, add
`variables: { SVERKA_NETWORK_ALLOWLIST: "registry.npmjs.org,github.com" }`
to the job.

## Data models

### Domain matching

`allowed` entries are matched by suffix: a request to
`registry.npmjs.org` matches `allowed: ["npmjs.org"]` or
`allowed: ["registry.npmjs.org"]`. No wildcard parsing — plain suffix
match. Empty `allowed` = deny all.

### Docker network isolation

For `allowed: ["registry.npmjs.org"]`:
- `--network none` is NOT used (need DNS resolution).
- Instead: run with default bridge network + `--add-host` entries that map
  known-common blocked domains to `127.0.0.1`. **Pragmatic limitation**: a
  full allowlist requires a custom network + DNS server, which is a
  follow-up. For v1, the `allowed` list is emitted as a Docker label
  (`--label sverka.network.allowlist=<domains>`) for external enforcement
  (e.g. a network plugin), and the driver logs a `diagnostic` (info) noting
  the allowlist is declarative. **The native engine does not implement
  kernel-level filtering in v1.**

This is an honest design: the model is in place, the target annotations
are in place, but actual enforcement in the docker driver is declarative
(label + diagnostic), not kernel-level. Full enforcement is a follow-up.

## Error handling

- Invalid domain in `allowed` (not a string, empty string) →
  `SynthesisError(INVALID_NETWORK_ALLOWLIST)` at synthesis.
- No new error class. Synthesis errors use `SynthesisError`; target
  diagnostics use `TargetDiagnostic`.

## Test plan

1. `Runtime` with `network: { allowed: ["registry.npmjs.org"] }`
   synthesizes onto `StepDefinition.runtime.network`.
2. `Runtime` with `network: { allowed: [""] }` → `SynthesisError(
   INVALID_NETWORK_ALLOWLIST)`.
3. `Runtime` with `network: { allowed: [] }` synthesizes (empty = deny all,
   valid).
4. Docker driver: step with `network.allowed: ["registry.npmjs.org"]` →
   `buildDockerArgs` includes `--label
   sverka.network.allowlist=registry.npmjs.org` (declarative).
5. Docker driver: step with no `network` → `--network none` (default deny).
6. Docker driver: step with `network.allowed: []` → `--network none`.
7. Host driver: step with `network.allowed` set → emits `diagnostic` (info)
   "network allowlist not enforced on host runtime".
8. GHA: step with `network.allowed` → job has a comment annotation
   `# sverka:network-allowlist: <domains>`.
9. GHA: step without `network` → no annotation.
10. GitLab: step with `network.allowed` → job `variables` includes
    `SVERKA_NETWORK_ALLOWLIST`.
11. `NetworkAllowlist` exported from `@sverka/workflow`.
12. `runtime.network` capability: GHA `emulated`, GitLab `emulated`, native
    `native` (docker, declarative) / `partial` (host).
