# GitLab CI compiler

The `@sverka/compiler-gitlab` package compiles a Plan to a GitLab CI YAML
string. Source: `packages/compiler-gitlab/src/compile.ts`.

## Usage

```ts
import { compileGitlabCi } from "@sverka/compiler-gitlab";
import type { Plan } from "@sverka/ir";

const yaml = compileGitlabCi(plan, {
  image: "oven/bun:latest",
  sverkaVersion: "latest",
  rules: [
    { if: '$CI_PIPELINE_SOURCE == "push"' },
    { if: '$CI_PIPELINE_SOURCE == "merge_request_event"' },
  ],
});
```

## Config

All fields optional. Defaults apply when omitted.

| Field            | Type              | Default          | Description                    |
|------------------|-------------------|------------------|--------------------------------|
| `image`          | `string`          | `"oven/bun:latest"` | Base image for the job     |
| `sverkaVersion`  | `string`          | `"latest"`       | Sverka version to install      |
| `rules`          | `GitlabRule[]`    | push + merge_request | When the pipeline runs    |

### Rules

| Field   | Type                                          | Description                          |
|---------|-----------------------------------------------|--------------------------------------|
| `if`    | `string`                                      | GitLab CI condition expression       |
| `when`  | `"on_success" \| "never" \| "always" \| "manual"` | When to run the job            |

Empty rule objects (`{}`) are filtered out before serialization to avoid
producing invalid GitLab CI YAML.

## Output

The generated pipeline has a single `verify` stage with one `sverka` job:

1. Uses the specified image (default: `oven/bun:latest`, which includes Bun).
2. Installs Sverka globally via `before_script`.
3. Runs `sverka execute` as the script.
4. Uploads `.sverka/output/` as an artifact (always, even on failure).

### Credential mapping

GitLab CI/CD variables defined in project settings are auto-injected into
jobs as `$VAR` — no explicit `env:` mapping is needed in the YAML, unlike
GitHub Actions which requires explicit `env:` entries to expose secrets.

### Example output

```yaml
stages:
  - verify
sverka:
  stage: verify
  image: oven/bun:latest
  rules:
    - if: $CI_PIPELINE_SOURCE == "push"
    - if: $CI_PIPELINE_SOURCE == "merge_request_event"
  before_script:
    - bun install -g sverka@latest
  script:
    - sverka execute
  artifacts:
    when: always
    paths:
      - .sverka/output/
```
