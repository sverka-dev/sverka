# v1 Wave 2 Plan — Network Allowlist

**Spec:** 26-network-allowlist
**Bead:** sv-wthn.2.5
**Packages:** `@sverka/workflow` (model), `@sverka/compiler` (github/gitlab annotations), `@sverka/runtime` (docker driver label, host diagnostic)
**Date:** 2026-08-31
**Base branch:** `v1-w2-mcp-ai` (stacks on Wave 1)

## Scope

Add `NetworkAllowlist` (`{ allowed: string[] }`) to `Runtime`. Synthesis
propagates + validates. Docker driver emits declarative label + `--network
none` for deny-all. Host driver emits advisory diagnostic. GHA/GitLab
targets emit annotations. **Honest design**: model + annotations are
enforced; kernel-level filtering is declarative (follow-up).

## Files

| File | Action |
|---|---|
| `packages/workflow/src/cdk/model.ts` | **Edit** — add `NetworkAllowlist` interface; add `network?: NetworkAllowlist` to `Runtime`. |
| `packages/workflow/src/cdk/index.ts` | **Edit** — export `NetworkAllowlist`. |
| `packages/workflow/src/core/graph.ts` | **Edit** — re-export `NetworkAllowlist`. |
| `packages/workflow/src/core/synthesize.ts` | **Edit** — `Runtime` already propagated; verify `network` flows through (it's part of `Runtime`, no extra field needed). |
| `packages/workflow/src/core/validate.ts` | **Edit** — validate `allowed` entries are non-empty strings (`INVALID_NETWORK_ALLOWLIST`). |
| `packages/workflow/src/core/errors.ts` | **Edit** — add `INVALID_NETWORK_ALLOWLIST` to `SynthesisErrorCode`. |
| `packages/runtime/src/runtime-docker/docker-executor.ts` | **Edit** — `buildDockerArgs`: if `network.allowed` non-empty → `--label sverka.network.allowlist=<domains>`; if empty/absent → `--network none`. |
| `packages/runtime/src/runtime-host/host-executor.ts` | **Edit** — emit `diagnostic` (info) if `network.allowed` set on host runtime. |
| `packages/compiler/src/github/lower.ts` | **Edit** — emit comment annotation for `network.allowed`. |
| `packages/compiler/src/github/capabilities.ts` | **Edit** — add `runtime.network: emulated`. |
| `packages/compiler/src/gitlab/lower.ts` | **Edit** — emit `SVERKA_NETWORK_ALLOWLIST` variable. |
| `packages/compiler/src/gitlab/capabilities.ts` | **Edit** — add `runtime.network: emulated`. |
| `packages/workflow/src/cdk/__tests__/*.test.ts` | **Edit** — model/validate tests (items 1–3). |
| `packages/runtime/src/runtime-docker/__tests__/network.test.ts` | **New** — docker driver tests (items 4–6). |
| `packages/runtime/src/runtime-host/__tests__/network.test.ts` | **New** — host diagnostic test (item 7). |
| `packages/compiler/src/github/__tests__/network.test.ts` | **New** — GHA annotation tests (items 8–9). |
| `packages/compiler/src/gitlab/__tests__/network.test.ts` | **New** — GitLab variable test (item 10). |

## TDD steps

1. Add `NetworkAllowlist` to cdk/model.ts + `network?` on `Runtime` +
   export. Write model test item 11 (export assertion).
2. Write items 1, 3 (synthesize propagation, empty allowed valid). Verify
   `Runtime` flows through existing synthesize (no extra wiring — `network`
   is part of `Runtime` which is already copied).
3. Add `INVALID_NETWORK_ALLOWLIST` to `SynthesisErrorCode` + validation.
   Write item 2 (empty string rejected).
4. Write docker driver tests items 4–6 (label for allowed, `--network none`
   for absent/empty). Extend `buildDockerArgs`.
5. Write host driver test item 7 (diagnostic emitted). Add check in
   `host-executor.ts`.
6. Write GHA tests items 8–9 (annotation present/absent). Implement in
   `lower.ts`.
7. Write GitLab test item 10 (`SVERKA_NETWORK_ALLOWLIST` variable).
   Implement in `lower.ts`.
8. Add `runtime.network` capability to github/gitlab manifests.
9. Run gates: `bun run test`, `bun run typecheck`, `bun run lint`,
    `bun run build`. All green.

## Honest design note

The docker driver emits a **declarative label** (`--label
sverka.network.allowlist=<domains>`) and a diagnostic, NOT kernel-level
DNS filtering. Full enforcement (custom DNS server, iptables, network
plugin) is a follow-up. The model, target annotations, and validation are
real and enforced; the runtime enforcement is declarative. This is
documented in the spec (§Overview, §Data models) to avoid over-claiming.

## Commit hygiene

Stage ONLY `packages/workflow/src/**` (model, index, graph, validate,
errors, tests) + `packages/runtime/src/runtime-docker/**` +
`packages/runtime/src/runtime-host/**` + `packages/compiler/src/{github,gitlab}/**`
+ tests + `specs/26-network-allowlist/spec.md` + this plan + `bun.lock` (if
deps change — none expected). EXCLUDE city.toml, agents/, .devin/, .gc/,
.beads/, formulas/, engdocs/adr/.
