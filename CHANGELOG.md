## 0.1.8 (2026-09-23)

### 🩹 Fixes

- replace backtracking step-ref regex with linear pattern ([#216](https://github.com/sverka-dev/sverka/pull/216))

### ❤️ Thank You

- Devin @devin-ai-integration[bot]
- Petr Plenkov @ThePlenkov
- ThePlenkov

## 0.1.7 (2026-09-23)

### 🩹 Fixes

- **cli:** generated workflows set persist-credentials: false ([#214](https://github.com/sverka-dev/sverka/pull/214))

### ❤️ Thank You

- Devin @devin-ai-integration[bot]
- Petr Plenkov @ThePlenkov

## 0.1.6 (2026-09-23)

### 🚀 Features

- **workflow:** make Pipeline's Project scope optional ([#212](https://github.com/sverka-dev/sverka/pull/212))

### ❤️ Thank You

- Devin @devin-ai-integration[bot]
- Petr Plenkov @ThePlenkov

## 0.1.5 (2026-09-23)

### 🩹 Fixes

- **arena:** drop published bin until the CLI is implemented ([#211](https://github.com/sverka-dev/sverka/pull/211))

### ❤️ Thank You

- Petr Plenkov @ThePlenkov

## 0.1.4 (2026-09-22)

### 🩹 Fixes

- **cli:** use module.registerHooks when available ([#207](https://github.com/sverka-dev/sverka/pull/207))

### ❤️ Thank You

- Petr Plenkov @ThePlenkov

## 0.1.3 (2026-09-22)

### 🚀 Features

- policy gate step + artifact import ordering fix ([#200](https://github.com/sverka-dev/sverka/pull/200))

### ❤️ Thank You

- Petr Plenkov @ThePlenkov
- ThePlenkov

## 0.1.2 (2026-09-21)

### 🚀 Features

- **compiler:** inject toolchain setup into generated GitHub workflows ([#196](https://github.com/sverka-dev/sverka/pull/196))

### 🩹 Fixes

- **cli:** report own package version for --version and MCP server ([#198](https://github.com/sverka-dev/sverka/pull/198))
- **release:** prefix publish dir with ./ to avoid git shorthand ([#194](https://github.com/sverka-dev/sverka/pull/194))

### ❤️ Thank You

- Petr Plenkov @ThePlenkov
- ThePlenkov

## 0.1.1 (2026-09-21)

### 🚀 Features

- Wave 0 — spec tree, monorepo scaffold, Gas City, website ([5e03d63](https://github.com/sverka-dev/sverka/commit/5e03d63))
- Wave 1 — core package ([7827892](https://github.com/sverka-dev/sverka/commit/7827892))
- Wave 2 — IR package (canonical plan schema and validation) ([cdee22f](https://github.com/sverka-dev/sverka/commit/cdee22f))
- Wave 1 — core package ([ac44528](https://github.com/sverka-dev/sverka/commit/ac44528))
- Wave 2 — IR package (canonical plan schema and validation) ([6394033](https://github.com/sverka-dev/sverka/commit/6394033))
- Wave 3 — runtime package (executor interfaces and scheduler) ([13a3d29](https://github.com/sverka-dev/sverka/commit/13a3d29))
- Wave 4 — runtime-host package (host process executor) ([7c7c9f9](https://github.com/sverka-dev/sverka/commit/7c7c9f9))
- Wave 5 — runtime-docker package (Docker executor) ([5038d7a](https://github.com/sverka-dev/sverka/commit/5038d7a))
- Wave 6 — planner package (discovery and plan synthesis) ([df244f8](https://github.com/sverka-dev/sverka/commit/df244f8))
- Wave 7 — findings package (normalization, fingerprints, baseline) ([86ad86c](https://github.com/sverka-dev/sverka/commit/86ad86c))
- Wave 8 — policy package (policy evaluation) ([2f89767](https://github.com/sverka-dev/sverka/commit/2f89767))
- Wave 9 — sdk package (public TypeScript API) ([5da05e5](https://github.com/sverka-dev/sverka/commit/5da05e5))
- Wave 10 — cli package (command-line interface) ([e6cf172](https://github.com/sverka-dev/sverka/commit/e6cf172))
- Wave 11 — checks package (check resolution and findings extraction) ([8b5da33](https://github.com/sverka-dev/sverka/commit/8b5da33))
- Wave 12 — compiler-github package (Plan IR to GitHub Actions YAML) ([2dc0c96](https://github.com/sverka-dev/sverka/commit/2dc0c96))
- Wave 13 — compiler-gitlab package (Plan IR to GitLab CI YAML) ([54d7784](https://github.com/sverka-dev/sverka/commit/54d7784))
- Wave 14 — website (sverka.dev Astro site with sitemap, SEO, 404) ([552f18f](https://github.com/sverka-dev/sverka/commit/552f18f))
- recover content from closed PRs #20 and #22 ([#20](https://github.com/sverka-dev/sverka/issues/20), [#22](https://github.com/sverka-dev/sverka/issues/22))
- add pre-alpha disclaimers and Cloudflare Pages deploy workflow ([77fb72f](https://github.com/sverka-dev/sverka/commit/77fb72f))
- PR stack resolution harness — formula, order, script ([ed5bf7d](https://github.com/sverka-dev/sverka/commit/ed5bf7d))
- add mayor nudge logic to PR stack resolve script ([39df5d7](https://github.com/sverka-dev/sverka/commit/39df5d7))
- port F-01 to F-16 core features from v0-n-docs to main ([#62](https://github.com/sverka-dev/sverka/pull/62))
- port F-17 to F-25 runtime features from v0-n-docs to main ([#63](https://github.com/sverka-dev/sverka/pull/63))
- port F-29 to F-49 advanced features from v0-n-docs to main ([#75](https://github.com/sverka-dev/sverka/pull/75))
- gc-watchdog Devin plugin with self-healing ([#78](https://github.com/sverka-dev/sverka/pull/78))
- port shell proxy API ($, shell) from v0-n-docs to main ([#77](https://github.com/sverka-dev/sverka/pull/77))
- v1 Wave 1 — CacheStore, RetryPolicy, RunEvent, GHA SHA pinning ([#122](https://github.com/sverka-dev/sverka/pull/122))
- v1 Wave 2 — MCP & AI Integration ([#123](https://github.com/sverka-dev/sverka/pull/123))
- v1 Wave 2 — Sverka MCP server ([#124](https://github.com/sverka-dev/sverka/pull/124))
- v1 Wave 3 — RunSnapshot storage + suspend/resume types ([#126](https://github.com/sverka-dev/sverka/pull/126))
- v1 Wave 3 — Saga compensations (Spec 30, ADR-013) ([#127](https://github.com/sverka-dev/sverka/pull/127))
- v1 Wave 4 — Interoperability Engines ([#128](https://github.com/sverka-dev/sverka/pull/128))
- v1 Wave 5 — DX & Polish ([#129](https://github.com/sverka-dev/sverka/pull/129))
- @sverka/arena — generic benchmark framework with CRUD dashboard ([#150](https://github.com/sverka-dev/sverka/pull/150))
- @sverka/reporter — renderer core, text output, findings/policy gate (Phase 1) ([#151](https://github.com/sverka-dev/sverka/pull/151))
- @sverka/sarif-viewer-tui — standalone Ink TUI for SARIF files (Wave 1, PR1) ([#152](https://github.com/sverka-dev/sverka/pull/152))
- @sverka/sarif-viewer-web — standalone HTML report generator for SARIF (Wave 1, PR2) ([#153](https://github.com/sverka-dev/sverka/pull/153))
- SARIF pipeline — serializeSarif + --format sarif/web + sverka view ([#155](https://github.com/sverka-dev/sverka/pull/155))
- @sverka/ui — local web dashboard for SARIF findings + sverka ui command ([#156](https://github.com/sverka-dev/sverka/pull/156))
- @sverka/playground — browser sandbox for building and running check pipelines ([#158](https://github.com/sverka-dev/sverka/pull/158))
- run shell steps from project root + dogfood SARIF findings ([#167](https://github.com/sverka-dev/sverka/pull/167))
- warn on unknown config props in sverka validate/run ([#168](https://github.com/sverka-dev/sverka/pull/168))
- make repo installable as a Devin plugin ([#185](https://github.com/sverka-dev/sverka/pull/185))
- dogfood sverka pipeline + bun audit fixes ([#188](https://github.com/sverka-dev/sverka/pull/188))
- OIDC trusted publishing release pipeline ([#190](https://github.com/sverka-dev/sverka/pull/190))
- **cli:** add sverka compile command for github/gitlab targets ([#35](https://github.com/sverka-dev/sverka/pull/35))
- **deploy:** switch website deploy to GitHub Pages ([c5b10b6](https://github.com/sverka-dev/sverka/commit/c5b10b6))
- **nx:** onboard @nx-devkit plugins — typescript preset, skill tooling, release ([#187](https://github.com/sverka-dev/sverka/pull/187))
- **nx-cloud:** setup nx cloud workspace ([c61acaa](https://github.com/sverka-dev/sverka/commit/c61acaa))
- **nx-cloud:** setup nx cloud workspace ([#58](https://github.com/sverka-dev/sverka/pull/58))
- **website:** migrate to Starlight docs site with engdocs and specs ([3e5306f](https://github.com/sverka-dev/sverka/commit/3e5306f))

### 🩹 Fixes

- address CodeRabbit review threads ([b92ba98](https://github.com/sverka-dev/sverka/commit/b92ba98))
- address code review findings in packages/ ([76f1f83](https://github.com/sverka-dev/sverka/commit/76f1f83))
- add legacy eslint engine name to .codacy.yml disable_rules ([1fcb720](https://github.com/sverka-dev/sverka/commit/1fcb720))
- add .eslintrc.json to disable es-x rules for Codacy ESLint 8 ([0f7210f](https://github.com/sverka-dev/sverka/commit/0f7210f))
- use exclude_paths instead of invalid disable_rules in .codacy.yml ([0ac1b58](https://github.com/sverka-dev/sverka/commit/0ac1b58))
- runtime safety and condition handling in planner ([e14bb06](https://github.com/sverka-dev/sverka/commit/e14bb06))
- make outcomes required, add RuntimeFinalization type, widen OperandValue ([5a1305c](https://github.com/sverka-dev/sverka/commit/5a1305c))
- escape delimiters in matrix child IDs and reject duplicate values ([ff14e45](https://github.com/sverka-dev/sverka/commit/ff14e45))
- resolve SonarCloud and Codacy complexity findings ([a09ab0a](https://github.com/sverka-dev/sverka/commit/a09ab0a))
- Add ESLint 9 flat config + fix per-package lint scripts (sv-ei2) ([d0393a3](https://github.com/sverka-dev/sverka/commit/d0393a3))
- Core ID assignment — SHA-256 content-addressed IDs per ADR-006 ([b2570e4](https://github.com/sverka-dev/sverka/commit/b2570e4))
- address Codacy review threads and typecheck after merge ([3b8690a](https://github.com/sverka-dev/sverka/commit/3b8690a))
- address Qodo review findings and thread issues ([c233d24](https://github.com/sverka-dev/sverka/commit/c233d24))
- address CodeRabbit review threads (security, CI, planner, compilers) ([1a119c4](https://github.com/sverka-dev/sverka/commit/1a119c4))
- address Amazon Q and Codacy review findings on PR #28 ([#28](https://github.com/sverka-dev/sverka/issues/28))
- address CodeRabbit and Qodo iteration-2 findings on code files ([e0e41ff](https://github.com/sverka-dev/sverka/commit/e0e41ff))
- address CodeRabbit and Qodo doc review findings on PR #28 ([#28](https://github.com/sverka-dev/sverka/issues/28))
- scope wisp/nudge filter to bead ID prefix in watchdog ([7e165a2](https://github.com/sverka-dev/sverka/commit/7e165a2))
- configure Codacy and SonarCloud to exclude scripts/ utility directory ([48eca56](https://github.com/sverka-dev/sverka/commit/48eca56))
- address CodeRabbit iteration-3 findings on PR #28 ([#28](https://github.com/sverka-dev/sverka/issues/28))
- address Codacy post-merge findings on PR #28 ([#28](https://github.com/sverka-dev/sverka/issues/28))
- use urllib.parse for URI normalization, anchor Suspended grep ([48186b5](https://github.com/sverka-dev/sverka/commit/48186b5))
- literal grep for harness.mayor, handle file:/ URI scheme ([0995018](https://github.com/sverka-dev/sverka/commit/0995018))
- address qodo post-merge findings on PR #28 ([#28](https://github.com/sverka-dev/sverka/issues/28))
- rebrand from 'AI-first' to 'code-first TypeScript pipeline engine' ([eb477d7](https://github.com/sverka-dev/sverka/commit/eb477d7))
- remove stale Nx Cloud org, ignore .worktrees from project graph ([fdd46b6](https://github.com/sverka-dev/sverka/commit/fdd46b6))
- restore green typecheck baseline (81 pre-existing errors → 0) ([#116](https://github.com/sverka-dev/sverka/pull/116))
- MCP server typecheck errors (exactOptionalPropertyTypes + noUncheckedIndexedAccess) ([#125](https://github.com/sverka-dev/sverka/pull/125))
- bump Bun to 1.4.0 in CI and deploy-website workflows ([#140](https://github.com/sverka-dev/sverka/pull/140))
- audit fixes — stdout/stderr in JSON, findings pipeline, dead code removal ([#166](https://github.com/sverka-dev/sverka/pull/166))
- e2e verify graph/plan/compile — declare @sverka/workflow at root, lower exportStdout for CI targets ([#177](https://github.com/sverka-dev/sverka/pull/177))
- publish readiness — arena manifest, lockstep release ([#189](https://github.com/sverka-dev/sverka/pull/189))
- **04-decorators:** align decorators with spec, remove @output, add method-step support ([8dec135](https://github.com/sverka-dev/sverka/commit/8dec135))
- **cdk-split:** address coderabbitai review threads ([0ea77ff](https://github.com/sverka-dev/sverka/commit/0ea77ff))
- **checks:** sanitize output.path in extractFindings to prevent path traversal ([9c3bc7c](https://github.com/sverka-dev/sverka/commit/9c3bc7c))
- **checks:** wrap readFile in try/catch and skip only ENOENT ([cad0d00](https://github.com/sverka-dev/sverka/commit/cad0d00))
- **checks:** address v0-j-checks review threads ([27853b9](https://github.com/sverka-dev/sverka/commit/27853b9))
- **checks,sdk:** resolve Codacy findings on PR #25\n\n- extractFindings: use async readFile and extract path validation into\n resolveSafeOutputPath helper.\n- sverka.ts: pass context directly instead of conditional spread. ([#25](https://github.com/sverka-dev/sverka/issues/25))
- **checks,sdk:** resolve wave-11 review threads ([a75fe0e](https://github.com/sverka-dev/sverka/commit/a75fe0e))
- **ci:** contents: write for nx fix-ci auto-apply ([8b87c26](https://github.com/sverka-dev/sverka/commit/8b87c26))
- **ci:** pin all third-party actions to commit SHAs ([fbea33c](https://github.com/sverka-dev/sverka/commit/fbea33c))
- **ci:** resolve SonarCloud findings + add dependabot ([1fdcaaf](https://github.com/sverka-dev/sverka/commit/1fdcaaf))
- **cli:** propagate non-ENOENT unlink errors in baseline clear ([#12](https://github.com/sverka-dev/sverka/pull/12))
- **cli:** address PR review — path resolution, outcomes serialization, version extraction ([cf4998f](https://github.com/sverka-dev/sverka/commit/cf4998f))
- **cli:** address remaining review — TOCTOU init, test skip bug, type narrowing, function order ([300bc50](https://github.com/sverka-dev/sverka/commit/300bc50))
- **cli:** resolve absolute baseline paths and close TOCTOU in clear ([5dfb9c4](https://github.com/sverka-dev/sverka/commit/5dfb9c4))
- **cli:** add 5s timeout to isBinaryAvailable spawnSync ([c911d8f](https://github.com/sverka-dev/sverka/commit/c911d8f))
- **cli:** resolve Codacy complexity and line-count findings ([9faa9a1](https://github.com/sverka-dev/sverka/commit/9faa9a1))
- **cli:** add vitest aliases for runtime packages ([bca9a41](https://github.com/sverka-dev/sverka/commit/bca9a41))
- **cli:** init config conflict check, workspace-aware dependency, entry validation, package.json error handling ([dffa6fc](https://github.com/sverka-dev/sverka/commit/dffa6fc))
- **cli:** prefer named project export over default in loadConfig ([6c4f364](https://github.com/sverka-dev/sverka/commit/6c4f364))
- **cli:** avoid file-existence race in ensureConstructsDependency and isLocalWorkspace ([09a2e21](https://github.com/sverka-dev/sverka/commit/09a2e21))
- **cli:** self-contained config loading and init --detect fixes ([#179](https://github.com/sverka-dev/sverka/pull/179))
- **cli:** unify check/init --detect detection paths ([#180](https://github.com/sverka-dev/sverka/pull/180))
- **cli:** actionable error when a @sverka/* dist is missing ([#181](https://github.com/sverka-dev/sverka/pull/181))
- **cli, runtime, sdk:** resolve CodeRabbit review threads for wave-10-cli ([3fe5312](https://github.com/sverka-dev/sverka/commit/3fe5312))
- **cli,sdk:** preserve all sdk re-exports by disabling tsdown tree-shaking ([4d33da4](https://github.com/sverka-dev/sverka/commit/4d33da4))
- **cli,ui,sarif-viewer-tui:** e2e fixes for report/view surfaces ([#178](https://github.com/sverka-dev/sverka/pull/178))
- **codacy:** replace broken disable_rules with engine exclude_paths ([446def1](https://github.com/sverka-dev/sverka/commit/446def1))
- **compiler-github:** address PR #14 review — toKebab, idToken, setup-bun, execute cmd, interface order ([#14](https://github.com/sverka-dev/sverka/issues/14))
- **compiler-github:** resolve CodeRabbit review threads for wave-12 ([095dc11](https://github.com/sverka-dev/sverka/commit/095dc11))
- **compiler-gitlab:** address PR #16 review — default image, execute cmd, empty rules ([#16](https://github.com/sverka-dev/sverka/issues/16))
- **compiler-gitlab:** remove invalid regex flag in test ([407ebbb](https://github.com/sverka-dev/sverka/commit/407ebbb))
- **compiler-gitlab:** align contract/docs with implementation\n\n- Default image is oven/bun:latest; document Bun requirement.\n- Remove stale positional .sverka/plan.json from docs and JSDoc.\n- Add type exports usage in public-api test.\n- Use a Bun-capable image in custom-config test. ([28414d8](https://github.com/sverka-dev/sverka/commit/28414d8))
- **conformance:** address review threads for v0-m-conformance ([3ce3905](https://github.com/sverka-dev/sverka/commit/3ce3905))
- **conformance:** use pipelineV0 instead of compat pipeline from SDK ([07edbe5](https://github.com/sverka-dev/sverka/commit/07edbe5))
- **conformance:** address coderabbitai review threads ([e60fc3b](https://github.com/sverka-dev/sverka/commit/e60fc3b))
- **constructs,core:** address PR #38 review threads ([#38](https://github.com/sverka-dev/sverka/issues/38))
- **core:** remove JSON.stringify from canonical serialization and matrix/env encoding ([bc9349d](https://github.com/sverka-dev/sverka/commit/bc9349d))
- **core:** align canonicalStringify with tests (Date, undefined, lone surrogates) and update runtime-modes expectations ([fe92e6b](https://github.com/sverka-dev/sverka/commit/fe92e6b))
- **core:** remove dead code in validateOutputCollisions, throw on missing artifact path ([06ee98d](https://github.com/sverka-dev/sverka/commit/06ee98d))
- **core:** restore old API as compat layer for downstream packages ([9c54133](https://github.com/sverka-dev/sverka/commit/9c54133))
- **core:** condition dependency tests and docs lint; validate StepRef conditions ([87a9b1c](https://github.com/sverka-dev/sverka/commit/87a9b1c))
- **core:** correct pipeline output mapping in synthesize after rebase ([bff0a0b](https://github.com/sverka-dev/sverka/commit/bff0a0b))
- **core,ir:** align with main wave implementation to resolve SAST/review findings\n\nReplace the older core and ir source in the decouple branch with the\ncanonical versions from the main wave stack. This resolves SonarCloud/Codacy\ncomplexity and correctness findings and fixes the codeant/CodeRabbit\nthreads targeting the old core/ir code. ([de87a63](https://github.com/sverka-dev/sverka/commit/de87a63))
- **core,ir:** address CodeRabbit review findings ([a9b7190](https://github.com/sverka-dev/sverka/commit/a9b7190))
- **core,ir:** address CodeRabbit review findings ([000b6b8](https://github.com/sverka-dev/sverka/commit/000b6b8))
- **core,runtime-docker:** reduce Codacy complexity/line-count findings ([11e2bad](https://github.com/sverka-dev/sverka/commit/11e2bad))
- **decorators:** allow number/boolean interpolation in planning methods ([2cf7ca5](https://github.com/sverka-dev/sverka/commit/2cf7ca5))
- **decorators:** address SonarCloud reliability and code smell issues ([a5f4d80](https://github.com/sverka-dev/sverka/commit/a5f4d80))
- **discover:** resolve workspace globs to real dirs ([#176](https://github.com/sverka-dev/sverka/pull/176))
- **docs,agents,config:** address CodeRabbit review threads on PR #19 ([#19](https://github.com/sverka-dev/sverka/issues/19))
- **engdocs:** address review threads in v0 redesign foundation ([b4e2825](https://github.com/sverka-dev/sverka/commit/b4e2825))
- **engine-native:** address review threads for v0-f-engine ([38589a6](https://github.com/sverka-dev/sverka/commit/38589a6))
- **engine-native,runtimes:** address PR #41 review threads ([#41](https://github.com/sverka-dev/sverka/issues/41))
- **findings:** resolve SonarCloud quality gate findings ([7e4cafa](https://github.com/sverka-dev/sverka/commit/7e4cafa))
- **findings:** resolve Codacy quality gate findings ([d858065](https://github.com/sverka-dev/sverka/commit/d858065))
- **foundation:** address PR #37 review threads ([#37](https://github.com/sverka-dev/sverka/issues/37))
- **github:** reject unknown graph refs and preserve diagnostic messages ([686f1c7](https://github.com/sverka-dev/sverka/commit/686f1c7))
- **github:** address SonarCloud reliability and code smell issues ([097613f](https://github.com/sverka-dev/sverka/commit/097613f))
- **github:** revert replaceAll to replace with global flag for Codacy ([4e79723](https://github.com/sverka-dev/sverka/commit/4e79723))
- **gitlab:** address review threads for PR #49 ([#49](https://github.com/sverka-dev/sverka/issues/49))
- **gitlab:** per-entry rules, import reachability, reserved keys, public API ([96b7b9a](https://github.com/sverka-dev/sverka/commit/96b7b9a))
- **ir:** address SonarCloud + codeant-ai review findings ([b0956d5](https://github.com/sverka-dev/sverka/commit/b0956d5))
- **ir:** reduce cyclomatic complexity and mitigate ReDoS flag ([de941e4](https://github.com/sverka-dev/sverka/commit/de941e4))
- **ir:** replace regex validation with manual string parsing ([78ee1d7](https://github.com/sverka-dev/sverka/commit/78ee1d7))
- **ir:** reduce isValidMemoryString cyclomatic complexity below 10 ([79176da](https://github.com/sverka-dev/sverka/commit/79176da))
- **ir:** address CodeRabbit review threads for PR #2 ([#2](https://github.com/sverka-dev/sverka/issues/2))
- **ir:** reduce validateTopLevel cyclomatic complexity and pin typescript-eslint ([e84641b](https://github.com/sverka-dev/sverka/commit/e84641b))
- **ir:** address CodeRabbit review threads — ADR wording, markdown lint, validation order, ISO 8601 ([39e8ebe](https://github.com/sverka-dev/sverka/commit/39e8ebe))
- **ir:** complete dependsOn validation contract and align spec ([cf29c59](https://github.com/sverka-dev/sverka/commit/cf29c59))
- **ir:** allow empty sourceContextHash for SDK manual plans ([66aac7a](https://github.com/sverka-dev/sverka/commit/66aac7a))
- **ir:** add compat layer for old Plan API used by downstream packages ([5e5a7d1](https://github.com/sverka-dev/sverka/commit/5e5a7d1))
- **ir:** address SonarCloud reliability and code smell issues ([f676007](https://github.com/sverka-dev/sverka/commit/f676007))
- **ir:** fix ISO 8601 validation regression in compat/validate.ts ([a0ba76d](https://github.com/sverka-dev/sverka/commit/a0ba76d))
- **ir:** address coderabbitai review threads ([a4a24b5](https://github.com/sverka-dev/sverka/commit/a4a24b5))
- **ir,core:** address PR #39 review threads ([#39](https://github.com/sverka-dev/sverka/issues/39))
- **ir,runtime:** resolve all SonarCloud SAST findings ([c0e94a8](https://github.com/sverka-dev/sverka/commit/c0e94a8))
- **ir,runtime:** resolve Codacy complexity and line-count findings ([237731e](https://github.com/sverka-dev/sverka/commit/237731e))
- **lock:** restore @sverka/ir workspace dependency in bun.lock ([23be76f](https://github.com/sverka-dev/sverka/commit/23be76f))
- **merge-stack:** verify lower-branch content with trial 3-way merge ([f2a4a90](https://github.com/sverka-dev/sverka/commit/f2a4a90))
- **merge-stack:** fail closed on fetch, validate merge-tree OID, keep unverified PRs open ([c93871c](https://github.com/sverka-dev/sverka/commit/c93871c))
- **merge-stack,watchdog:** support SHA-256, source markers, grep -F ([62d9481](https://github.com/sverka-dev/sverka/commit/62d9481))
- **merge-stack,watchdog:** source-markers, case-insensitive bead regex, robust gc parsing, fetch once ([4cefcc1](https://github.com/sverka-dev/sverka/commit/4cefcc1))
- **planner:** resolve Codacy complexity and SonarCloud findings ([c9b52b4](https://github.com/sverka-dev/sverka/commit/c9b52b4))
- **planner:** resolve remaining SonarCloud test-assertion and PATH-hotspot findings ([4fc3874](https://github.com/sverka-dev/sverka/commit/4fc3874))
- **planner:** revalidate resolved review threads ([71fb3c0](https://github.com/sverka-dev/sverka/commit/71fb3c0))
- **planner:** address review threads for v0-g-planner ([d3ae989](https://github.com/sverka-dev/sverka/commit/d3ae989))
- **planner:** scope detection to root subtree for nested init --detect ([#182](https://github.com/sverka-dev/sverka/pull/182))
- **planner,core,ir:** address v0-g-planner review threads ([5b6a62e](https://github.com/sverka-dev/sverka/commit/5b6a62e))
- **plugin:** clone nested CapabilityDetail, define connector diagnostic behavior ([277bfea](https://github.com/sverka-dev/sverka/commit/277bfea))
- **plugin:** reject arrays as capability manifests, document operation.import ([08e00d3](https://github.com/sverka-dev/sverka/commit/08e00d3))
- **policy:** validate failOn rule shape before accessing severity ([f80e05f](https://github.com/sverka-dev/sverka/commit/f80e05f))
- **policy:** reduce createPolicy cyclomatic complexity for Codacy ([aae5437](https://github.com/sverka-dev/sverka/commit/aae5437))
- **policy,core,docs:** resolve open CodeRabbit threads on #10 ([#10](https://github.com/sverka-dev/sverka/issues/10))
- **pr-stack-resolve:** fix shell lint issues in stack resolve script ([eeb34b9](https://github.com/sverka-dev/sverka/commit/eeb34b9))
- **pr-stack-resolve:** fix shellcheck disable directive format ([72dd255](https://github.com/sverka-dev/sverka/commit/72dd255))
- **release:** repair actions/setup-node pin — sha didn't resolve ([dd04ce2](https://github.com/sverka-dev/sverka/commit/dd04ce2))
- **release:** drop --yes flag ([#191](https://github.com/sverka-dev/sverka/pull/191))
- **release:** commit in version step, tag in changelog step ([#192](https://github.com/sverka-dev/sverka/pull/192))
- **release:** pass version positionally to changelog ([#193](https://github.com/sverka-dev/sverka/pull/193))
- **review:** address Codacy/Qodo feedback on watchdog, runbook, and tests ([497fbf0](https://github.com/sverka-dev/sverka/commit/497fbf0))
- **review:** bind runbook head branch per PR and harden watchdog tests ([15aeef3](https://github.com/sverka-dev/sverka/commit/15aeef3))
- **review:** harden deploy workflow and pre-alpha banner accessibility ([ddb6c12](https://github.com/sverka-dev/sverka/commit/ddb6c12))
- **review:** disable Bun cache and align banner text ([5c8e31d](https://github.com/sverka-dev/sverka/commit/5c8e31d))
- **review:** base-path root handling and 404 home link ([b9f8b85](https://github.com/sverka-dev/sverka/commit/b9f8b85))
- **review:** scope deployment permissions to the deploy job ([37013d7](https://github.com/sverka-dev/sverka/commit/37013d7))
- **review:** split build/deploy jobs and simplify base normalization ([a13c727](https://github.com/sverka-dev/sverka/commit/a13c727))
- **runtime:** address 6 codeant-ai review threads ([720fb1e](https://github.com/sverka-dev/sverka/commit/720fb1e))
- **runtime:** restore old runtime packages as compat layer ([b3342e2](https://github.com/sverka-dev/sverka/commit/b3342e2))
- **runtime:** export both old and new APIs from runtime-host and runtime-docker ([b1bd02f](https://github.com/sverka-dev/sverka/commit/b1bd02f))
- **runtime-docker:** extract validateRequest/runContainer/finalizeResult to reduce complexity ([818a725](https://github.com/sverka-dev/sverka/commit/818a725))
- **runtime-docker:** address resolved review threads on socket policy, cache paths, and artifacts ([f2e5bc8](https://github.com/sverka-dev/sverka/commit/f2e5bc8))
- **runtime-docker, core, ir:** address CodeRabbit review threads for wave-5 ([474c118](https://github.com/sverka-dev/sverka/commit/474c118))
- **runtime-host:** extract validateRequest/finalizeResult to reduce complexity; pin devDeps ([5908184](https://github.com/sverka-dev/sverka/commit/5908184))
- **runtime-host:** treat spawn failure as runtime error ([c0e424f](https://github.com/sverka-dev/sverka/commit/c0e424f))
- **sarif:** normalize all URIs and reject boolean coordinates ([af686af](https://github.com/sverka-dev/sverka/commit/af686af))
- **sdk:** resolve Codacy complexity and line-count findings ([bbc8e14](https://github.com/sverka-dev/sverka/commit/bbc8e14))
- **sdk:** extract resolveDefaults to reduce buildPlanOperation complexity ([850e084](https://github.com/sverka-dev/sverka/commit/850e084))
- **sdk:** type buildPlanOperation return as PlanOperation for exactOptionalPropertyTypes ([4d31305](https://github.com/sverka-dev/sverka/commit/4d31305))
- **sdk:** address CodeRabbit review threads on PR #11 ([#11](https://github.com/sverka-dev/sverka/issues/11))
- **sdk:** revalidate resolved review threads ([bfbd3a4](https://github.com/sverka-dev/sverka/commit/bfbd3a4))
- **sdk:** reduce resolveDefaults cyclomatic complexity for Codacy ([ac9c258](https://github.com/sverka-dev/sverka/commit/ac9c258))
- **sdk:** forward PATH to host executor ([c47f227](https://github.com/sverka-dev/sverka/commit/c47f227))
- **sdk:** address review findings for v0-c-sdk ([cdbe6b8](https://github.com/sverka-dev/sverka/commit/cdbe6b8))
- **sdk:** address review findings for v0-c-sdk (source changes) ([c80f2cc](https://github.com/sverka-dev/sverka/commit/c80f2cc))
- **sdk:** remaining v0-c-sdk review threads ([d3f2a05](https://github.com/sverka-dev/sverka/commit/d3f2a05))
- **sdk:** add compat layer for old SDK API used by CLI ([a1426aa](https://github.com/sverka-dev/sverka/commit/a1426aa))
- **sdk:** add runtime-host and runtime-docker to sdk deps ([96ac85f](https://github.com/sverka-dev/sverka/commit/96ac85f))
- **sdk:** address coderabbitai review threads ([d303dd5](https://github.com/sverka-dev/sverka/commit/d303dd5))
- **sdk:** make runtime imports lazy for waves that replace @sverka/runtime ([31ff11a](https://github.com/sverka-dev/sverka/commit/31ff11a))
- **sdk:** make runtime imports lazy in root sverka.ts ([8e441f3](https://github.com/sverka-dev/sverka/commit/8e441f3))
- **sonar:** scope workflow permissions to jobs ([9dc60bd](https://github.com/sverka-dev/sverka/commit/9dc60bd))
- **watchdog:** match wisp/nudge exclusions to complete bead IDs ([e853eb1](https://github.com/sverka-dev/sverka/commit/e853eb1))
- **watchdog:** harden regex, use grep -m1, and add regression tests ([826399f](https://github.com/sverka-dev/sverka/commit/826399f))
- **wave-11-checks:** resolve Qodo review threads on SDK auto-discovery and check resolver ([9ee33e2](https://github.com/sverka-dev/sverka/commit/9ee33e2))
- **wave-9-sdk:** provide explicit localeCompare compare function for sourceContextHash changedFiles sort ([143e517](https://github.com/sverka-dev/sverka/commit/143e517))
- **website:** add @sverka/sdk to quick start install instructions ([4c50bb3](https://github.com/sverka-dev/sverka/commit/4c50bb3))
- **website:** address review feedback in sync-docs.ts ([672262f](https://github.com/sverka-dev/sverka/commit/672262f))
- **website:** use relative links in splash page so BASE_PATH is respected ([9572605](https://github.com/sverka-dev/sverka/commit/9572605))
- **website:** sync-docs refactor, per-page editUrl, runbooks, mermaid selector, deploy paths ([dc70ff8](https://github.com/sverka-dev/sverka/commit/dc70ff8))
- **website:** add sync-docs tests, warn on unresolved links, exclude tests from astro check ([b0e303a](https://github.com/sverka-dev/sverka/commit/b0e303a))
- **website:** publish only user-facing docs, drop engineering/specs pages ([c71781e](https://github.com/sverka-dev/sverka/commit/c71781e))
- **website:** remove dead singleFiles loop to satisfy SonarCloud reliability gate ([f9b9a59](https://github.com/sverka-dev/sverka/commit/f9b9a59))
- **website:** run sync before asserting engineering/specs are absent in tests ([844bccd](https://github.com/sverka-dev/sverka/commit/844bccd))
- **website:** consistent sidebar labels and deduplicate page titles ([7d5cee5](https://github.com/sverka-dev/sverka/commit/7d5cee5))
- **website:** address SonarCloud reliability findings ([ddbb2cf](https://github.com/sverka-dev/sverka/commit/ddbb2cf))
- **website:** address review threads for sidebar and frontmatter ([13a13a3](https://github.com/sverka-dev/sverka/commit/13a13a3))
- **website:** harden sidebar generation and add order assertions ([1d2a7b7](https://github.com/sverka-dev/sverka/commit/1d2a7b7))
- **website:** migrate Starlight sidebar to v0.39+ format, fix broken policy link ([#113](https://github.com/sverka-dev/sverka/pull/113))
- **website:** switch deploy runner to ubuntu-latest ([#114](https://github.com/sverka-dev/sverka/pull/114))
- **website:** remove concurrency group to unblock stuck deploy ([#115](https://github.com/sverka-dev/sverka/pull/115))

### 🔥 Performance

- **cli:** lazy-import reporter and MCP SDK to cut startup ~60% ([#183](https://github.com/sverka-dev/sverka/pull/183))

### ❤️ Thank You

- Devin @devin-ai-integration[bot]
- Devin AI @devin-ai-integration[bot]
- Petr Plenkov @ThePlenkov
- ThePlenkov @ThePlenkov
