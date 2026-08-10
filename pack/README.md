# sverka-gc-pack

Reusable Gas City pack for spec-driven, test-first monorepo projects.

## What's in the pack

| Directory | Contents |
| --------- | -------- |
| `agents/mayor/` | Always-on orchestrator: plans waves, dispatches work, gates quality, drills failures |
| `agents/architect/` | On-demand designer: specs, implementation plans, interface definitions |
| `agents/builder/` | On-demand implementer: TDD-strict, drill-first, surgical diffs |
| `agents/reviewer/` | On-demand gatekeeper: paranoid, spec-strict, runs all checks fresh |
| `formulas/wave.toml` | Wave formula: design → implement → review → finalize |
| `formulas/address-review.toml` | PR review formula: /act loop to address all GitHub review threads |
| `formulas/bootstrap-sdd.toml` | Bootstrap formula: spec tree → engdocs → monorepo → README → website → review |
| `template-fragments/review-policy.md` | Template for project `REVIEW.md` |
| `template-fragments/security-policy.md` | Template for project `SECURITY.md` |
| `template-fragments/conventions.md` | Template for project `AGENTS.md` |
| `skills/sverka-wave/` | Agent skill: wave planning and execution cycle |
| `skills/sverka-review/` | Agent skill: two-axis review and gate commands |
| `skills/sverka-drill/` | Agent skill: failure investigation and root cause isolation |
| `docs/agent-guide.md` | Documentation for agents running under this harness |

## CLI Skill (separate)

The `skills/sverka/` directory at the project root contains a publishable
CLI skill for the `sverka` CLI tool. Install it via `npx skills`:

```bash
npx skills add sverka-dev/sverka --skill sverka
```

This provides `/sverka <command>` (scan, doctor, plan, execute, validate,
baseline, init, inspect) in any coding agent.

## Usage

### 1. Import the pack

In your project's `pack.toml`:

```toml
[pack]
name = "my-project"
schema = 2

[imports.bd]
source = "https://github.com/gastownhall/gascity/tree/main/examples/bd"
version = "sha:..."

[imports.core]
source = "https://github.com/gastownhall/gascity/tree/main/internal/bootstrap/packs/core"
version = "sha:..."

[imports.harness]
source = "./pack"
```

If the pack lives in a separate repo:

```toml
[imports.harness]
source = "https://github.com/yourorg/sverka-gc-pack/tree/main"
version = "sha:..."
```

### 2. Inject project context

The agent prompts are universal — they don't know your project name, tech
stack, or wave plan. Inject project context via `append_fragments` patches:

```toml
# pack.toml (continued)

[[patches.agent]]
name = "harness.mayor"
append_fragments = ["project-context.md"]

[[patches.agent]]
name = "harness.architect"
append_fragments = ["project-context.md"]

[[patches.agent]]
name = "harness.builder"
append_fragments = ["project-context.md"]

[[patches.agent]]
name = "harness.reviewer"
append_fragments = ["project-context.md"]
```

Then create `template-fragments/project-context.md` in your project root:

```markdown
## Project

MyProject is a <description>.

## Tech stack

<language, runtime, package manager, build, test, lint>

## Wave plan

- Wave 0: ...
- Wave 1: ...
- Wave 2: ...
```

This content is appended to each agent's rendered prompt.

### 3. Declare named sessions

```toml
# pack.toml (continued)

[[named_session]]
template = "harness.mayor"
mode = "always"

[[named_session]]
template = "harness.architect"
mode = "on_demand"

[[named_session]]
template = "harness.builder"
mode = "on_demand"

[[named_session]]
template = "harness.reviewer"
mode = "on_demand"
```

### 4. Create project docs

Copy templates from the pack to your project root and adapt:

```bash
cp pack/template-fragments/review-policy.md REVIEW.md
cp pack/template-fragments/security-policy.md SECURITY.md
cp pack/template-fragments/conventions.md AGENTS.md
```

Then fill in the project-specific sections.

### 5. Dispatch work

```bash
# Bootstrap a new project
gc sling harness.mayor bootstrap-sdd --formula

# Run a wave
gc sling harness.mayor wave --formula

# Address PR review
gc sling harness.builder address-review --formula
```

## Agent qualified names

Imported under binding `harness`, the agents are:

- `harness.mayor`
- `harness.architect`
- `harness.builder`
- `harness.reviewer`

Use these qualified names in patches, sling targets, and session peeks.

## Customizing

### Override an agent prompt

Define a local agent with the same name in your project's `agents/` directory.
Local definitions win over imported ones.

### Add a project-specific formula

Put a `.toml` file in your project's `formulas/` directory. Local formulas
override imported formulas with the same name.

### Patch an agent

```toml
[[patches.agent]]
name = "harness.mayor"
provider = "codex"
idle_timeout = "2h"
```

## What the pack does NOT include

- Project specs (`specs/`) — project-owned
- Engineering docs (`engdocs/`) — project-owned
- Project conventions (`AGENTS.md`) — project-owned
- Review policy (`REVIEW.md`) — project-owned
- Security policy (`SECURITY.md`) — project-owned
- Plans/backlog — project-owned
- Actual code — project-owned

The pack provides the **harness** (roles + workflow). The project provides
the **content** (specs + code + docs).
