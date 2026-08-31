---
name: modern-stack
description: Enforce the latest supported version for each dependency, CI action, and runtime, respecting the current major line. Ground decisions in live registry data, not training data.
---

# modern-stack

Default to the latest supported release of every dependency, tool, and CI action, but stay within the project's current major version line unless a major upgrade is explicitly requested. Training data and memory are stale by definition; verify against the registry or upstream releases before committing a version.

## When to use

- Starting a new project or adding dependencies.
- Writing or reviewing CI/CD workflows.
- Upgrading an existing repo.
- A generated answer contains a pinned version older than the current latest supported for that line.

## Workflow

1. **Detect the stack and current major line.** Read the project manifest:
   - `package.json` → Node/TypeScript/npm versions and `engines`.
   - `pyproject.toml` / `requirements.txt` → Python
   - `Cargo.toml` → Rust
   - `go.mod` → Go
2. **Find the current major version.** For npm packages, inspect `devDependencies`, `dependencies`, and `peerDependencies` (e.g., `typescript: ^<major>.<minor>.<patch>` → major `<major>`). For Node, read `engines.node`.
3. **Resolve the latest supported version for that major line.**
   - npm packages: `npm view <pkg> versions --json` and pick the highest **stable** version that matches the current major line (skip `alpha`, `beta`, `rc`, `dev`, `next`, and other prerelease tags). Example: `npm view <pkg> versions --json | jq --arg m "<major>" '[.[] | select(test("^\\($m)\\.[0-9]+\\.[0-9]+$"))] | last'`.
   - Node.js: fetch `https://nodejs.org/dist/index.json`. The current LTS is the highest `version` where `lts` is not `false`:
     ```sh
     NODE_LTS=$(curl -sL https://nodejs.org/dist/index.json |
       jq -r 'map(select(.lts != false)) | sort_by(.version | sub("^v";"") | split(".") | map(tonumber)) | last | .version')
     NODE_LTS=${NODE_LTS#v}
     echo "$NODE_LTS"
     ```
     If `jq` is unavailable, use Node (requires Node 18+):
     ```sh
     node -e "fetch('https://nodejs.org/dist/index.json').then(r=>r.json()).then(d=>{const l=[...d].filter(x=>x.lts).sort((a,b)=>{const av=a.version.slice(1).split('.').map(Number), bv=b.version.slice(1).split('.').map(Number); for(let i=0;i<3;i++){const d=(bv[i]||0)-(av[i]||0); if(d) return d} return 0})[0]; console.log(l.version.slice(1))})"
     ```
   - GitHub Actions: prefer `gh api repos/<owner>/<repo>/releases/latest --jq .tag_name` or fetch `https://api.github.com/repos/<owner>/<repo>/releases/latest`. If the action has tags but no Releases, fall back to `gh api repos/<owner>/<repo>/tags --jq '.[0].name'` and pick the latest stable tag.
4. **Node.js LTS is the minimum.** Set `engines.node` to `>=<current-lts-version>` (use the exact current LTS version, not just the major, so pre-LTS releases of that major are excluded). If an existing `engines.node` is below the current LTS, update it and run tests. In CI use `node-version: lts/*` with `check-latest: true`.
5. **Greenfield vs brownfield.**
   - **New projects:** Recommend the latest stable major line for each core dependency (e.g., current Node LTS, latest stable TypeScript, tsdown).
   - **Existing projects:** Stay on the latest stable patch/minor of the installed major line. Do **not** force a major upgrade without explicit user approval, except for Node.js when the current `engines.node` is below LTS. Before upgrading TypeScript, verify the project's toolchain (`typescript-eslint`, `vue-tsc`, `svelte-check`, `astro check`, `ts-jest`, `ts-morph`) supports the new major.
6. **Pin exact versions.** Install the resolved version with an exact save so `package.json` does not float: `npm install -D --save-exact <pkg>@<latest-supported>` (or `npm install -D <pkg>@<latest-supported>` and then `npm pkg set devDependencies.<pkg>=<latest-supported>`). Record the resolved version in the lockfile. Avoid floating ranges (`*`, `latest`, `>=`) in committed manifests.
7. **Verify CI action tags.** Prefer major-version tags only when they track the latest release. If unsure, use the full release tag from step 3 and document why.
8. **Cite sources.** Every version decision must include a citation:
   - `npm view <pkg> version` / `npm view <pkg> versions` output, or
   - `https://www.npmjs.com/package/<pkg>` page, or
   - `https://nodejs.org/dist/index.json`, or
   - `https://github.com/<owner>/<repo>/releases/tag/<tag>`.
9. **Verify the upgrade before committing.** Run the repository's validation commands (e.g., `npm run typecheck`, `npm run build`, `npm run test`, `npm ls`) after changing any dependency version. If a peer-dependency or toolchain compatibility error appears, roll back to the latest compatible stable version.
10. **Prefer native defaults when they fit the line.** For Node/TypeScript, prefer native type stripping with `erasableSyntaxOnly: true`, the installed `tsc`, and `tsdown` rather than legacy `ts-node`, `tsup`, or hand-rolled `cjs`/`.mjs` outputs. For non-erasable syntax, use `tsx` and set `erasableSyntaxOnly: false`.

## Anti-patterns

- Copying an old `package.json` or `tsconfig.json` from memory.
- Hardcoding a numeric Node version in CI or `engines.node` without verifying the current LTS.
- Forcing a major upgrade of TypeScript, Node, or any core dependency onto a pinned project without asking (except Node below LTS).
- Adding `ts-node`, `babel`, or `eslint` without first checking if the installed modern stack already covers the need.
- Emitting `.cjs`/`.mjs` source files; source should be `.ts` and emitted artifacts generated only by the build tool.

## References

- npm registry lookup: `npm view <pkg> version` — https://docs.npmjs.com/cli/commands/npm-view
- npm versions list: `npm view <pkg> versions` — https://docs.npmjs.com/cli/commands/npm-view
- Node.js releases and LTS: https://nodejs.org/dist/index.json, https://nodejs.org/en/about/previous-releases
- Node.js TypeScript support: https://nodejs.org/api/typescript.html
- TypeScript documentation: https://www.typescriptlang.org/docs/
- tsdown docs: https://tsdown.dev
